"""In-memory system of record for bank tools.

No external services are invoked (prompt.md #28 assigns DynamoDB/S3 to
infra; this in-memory store stands in for that until infra provisions it).
Build one with `BankToolsStore()` and seed it with the `add_*` methods, or
use the `store` pytest fixture in tests/conftest.py.

Indices are sized for the modest synthetic dataset (~50 customers, 1-2k
transactions, ~40 merchants): per-customer transaction lists are kept sorted
by occurredAt so date-range lookups are O(log n + k) via bisect instead of a
full scan, and merchant alias resolution is an O(1) dict lookup built once at
seed time.
"""
from __future__ import annotations

import bisect
import re
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from .errors import ConflictError, NotFoundError
from .models import (
    ActionType, AuditRecord, AuditResult, Case, Evidence, HumanReviewRequest, Merchant,
    MerchantProfile, PolicyDecision, PolicyOutcome, Transaction, now_iso,
)

_ALIAS_NORMALIZE_RE = re.compile(r"[^A-Z0-9]")


def normalize_descriptor(descriptor: str) -> str:
    """Uppercase and strip punctuation so 'Asteria.io' / 'ASTERIA*PREMIUM' compare evenly."""
    return _ALIAS_NORMALIZE_RE.sub("", descriptor.upper())


def _parse_ts(value: str) -> datetime:
    """Parse an ISO timestamp, treating an offset-less value as UTC (occurredAt always carries one)."""
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class BankToolsStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._transactions: dict[str, Transaction] = {}
        self._by_customer: dict[str, list[Transaction]] = {}
        self._customers: dict[str, dict[str, Any]] = {}
        self._merchants: dict[str, Merchant] = {}
        self._merchant_profiles: dict[str, MerchantProfile] = {}
        self._alias_index: dict[str, str] = {}
        self._cases: dict[str, Case] = {}
        self._cases_by_customer: dict[str, list[str]] = {}
        self._evidence: dict[str, Evidence] = {}
        self._policy_decisions: dict[str, list[PolicyDecision]] = {}
        self._human_review_requests: dict[str, list[HumanReviewRequest]] = {}
        self._audit_by_case: dict[str, list[AuditRecord]] = {}
        self._idempotency: dict[tuple[str, str], dict[str, Any]] = {}

    # -- seeding --------------------------------------------------------
    def add_transaction(self, txn: Transaction) -> None:
        self._transactions[txn.transactionId] = txn
        bucket = self._by_customer.setdefault(txn.customerId, [])
        bisect.insort(bucket, txn, key=lambda t: t.occurredAt)

    def add_customer(self, customer: dict[str, Any]) -> None:
        self._customers[customer["customerId"]] = customer

    def add_merchant(self, merchant: Merchant) -> None:
        self._merchants[merchant.merchantId] = merchant
        self._index_alias(merchant.canonicalName, merchant.merchantId)
        for alias in merchant.aliases:
            self._index_alias(alias, merchant.merchantId)

    def add_merchant_profile(self, profile: MerchantProfile) -> None:
        self._merchant_profiles[profile.merchantId] = profile

    def add_case(self, case: Case) -> None:
        self._cases[case.caseId] = case
        self._cases_by_customer.setdefault(case.customerId, []).append(case.caseId)

    def add_evidence(self, evidence: Evidence) -> None:
        self._evidence[evidence.evidenceId] = evidence

    def _index_alias(self, descriptor: str, merchant_id: str) -> None:
        self._alias_index[normalize_descriptor(descriptor)] = merchant_id

    # -- idempotency ------------------------------------------------------
    def idempotent_result(self, tool: str, key: str | None) -> dict[str, Any] | None:
        if not key:
            return None
        return self._idempotency.get((tool, key))

    def remember_result(self, tool: str, key: str | None, result: dict[str, Any]) -> None:
        if key:
            self._idempotency[(tool, key)] = result

    # -- transactions -----------------------------------------------------
    def get_transaction(self, transaction_id: str) -> Transaction:
        txn = self._transactions.get(transaction_id)
        if txn is None:
            raise NotFoundError(f"transaction not found: {transaction_id}")
        return txn

    def transactions_for_customer(
        self, customer_id: str, *, since: str | None = None, until: str | None = None,
    ) -> list[Transaction]:
        bucket = self._by_customer.get(customer_id, [])
        if since is None and until is None:
            return list(bucket)
        lo = bisect.bisect_left(bucket, _parse_ts(since), key=lambda t: _parse_ts(t.occurredAt)) if since else 0
        hi = (
            bisect.bisect_right(bucket, _parse_ts(until), key=lambda t: _parse_ts(t.occurredAt))
            if until else len(bucket)
        )
        return bucket[lo:hi]

    # -- customers --------------------------------------------------------
    def get_customer(self, customer_id: str) -> dict[str, Any]:
        customer = self._customers.get(customer_id)
        if customer is None:
            raise NotFoundError(f"customer not found: {customer_id}")
        return customer

    # -- merchants ----------------------------------------------------------
    def resolve_merchant_id(self, descriptor: str) -> str | None:
        return self._alias_index.get(normalize_descriptor(descriptor))

    def get_merchant(self, merchant_id: str) -> Merchant:
        merchant = self._merchants.get(merchant_id)
        if merchant is None:
            raise NotFoundError(f"merchant not found: {merchant_id}")
        return merchant

    def get_merchant_profile(self, merchant_id: str) -> MerchantProfile:
        profile = self._merchant_profiles.get(merchant_id)
        if profile is None:
            raise NotFoundError(f"merchant profile not found: {merchant_id}")
        return profile

    # -- cases --------------------------------------------------------------
    def get_case(self, case_id: str) -> Case:
        case = self._cases.get(case_id)
        if case is None:
            raise NotFoundError(f"case not found: {case_id}")
        return case

    def cases_for_customer(self, customer_id: str) -> list[Case]:
        return [self._cases[cid] for cid in self._cases_by_customer.get(customer_id, [])]

    def replace_case(self, case: Case) -> None:
        if case.caseId not in self._cases:
            raise NotFoundError(f"case not found: {case.caseId}")
        self._cases[case.caseId] = case

    def create_case_locked(self, factory) -> Case:
        """Run `factory()` under the store lock and register the resulting case."""
        with self._lock:
            case = factory()
            if case.caseId in self._cases:
                raise ConflictError(f"case already exists: {case.caseId}")
            self.add_case(case)
            return case

    # -- evidence -------------------------------------------------------------
    def get_evidence(self, evidence_id: str) -> Evidence:
        evidence = self._evidence.get(evidence_id)
        if evidence is None:
            raise NotFoundError(f"evidence not found: {evidence_id}")
        return evidence

    def evidence_for_case(self, case_id: str) -> list[Evidence]:
        case = self.get_case(case_id)
        return [self._evidence[eid] for eid in case.evidenceIds if eid in self._evidence]

    # -- policy decisions / human review --------------------------------------
    def add_policy_decision(self, decision: PolicyDecision) -> None:
        self._policy_decisions.setdefault(decision.caseId, []).append(decision)

    def policy_decisions_for_case(self, case_id: str) -> list[PolicyDecision]:
        return list(self._policy_decisions.get(case_id, []))

    def add_human_review_request(self, request: HumanReviewRequest) -> None:
        self._human_review_requests.setdefault(request.caseId, []).append(request)

    def human_review_requests_for_case(self, case_id: str) -> list[HumanReviewRequest]:
        return list(self._human_review_requests.get(case_id, []))

    # -- audit ------------------------------------------------------------------
    def record_audit(
        self, *, case_id: str, action: str, tool: str, result: AuditResult | str = AuditResult.SUCCESS,
        policy_name: str | None = None, policy_outcome: PolicyOutcome | None = None,
        proposed_action: ActionType | None = None, input_amount: float | None = None,
        human_approval_required: bool | None = None,
    ) -> AuditRecord:
        """caseId is required by packages/contracts AuditEventSchema; only call this with a real case."""
        record = AuditRecord(
            eventId=new_id("audit"), caseId=case_id, timestamp=now_iso(), action=action, tool=tool,
            result=AuditResult(result), policyName=policy_name, policyOutcome=policy_outcome,
            proposedAction=proposed_action, inputAmount=input_amount,
            humanApprovalRequired=human_approval_required,
        )
        self._audit_by_case.setdefault(case_id, []).append(record)
        return record

    def audit_for_case(self, case_id: str) -> list[AuditRecord]:
        return list(self._audit_by_case.get(case_id, []))
