"""DynamoDB-backed `BankToolsStorage` over an injected low-level client.

`client` is anything shaped like `boto3.client("dynamodb")` (typed AttributeValue
items); this module never imports boto3 or opens a connection, so tests pass a fake.

Layout (matches infra/stacks/data-stack.ts; infra has no customer/evidence/policy tables,
so those share the existing tables via key prefixes -- see .handoffs/bank-tools/):
- Transactions: pk transactionId; GSI byCustomer (customerId, occurredAt).
- Cases: pk caseId = case row (GSI byCustomer); "E#<evidenceId>" = evidence row {doc}.
- Merchants: pk merchantId; "M#id" merchant, "P#id" profile, "A#<normalized alias>" alias->id,
  "C#id" customer. Each row is {merchantId, doc} (alias rows: {merchantId, target}).
- Audit: pk caseId, sk eventId; "audit_*" audit events, "policy_*" decisions, "review_*"
  human-review requests. Each row is {caseId, eventId, doc}.
- Idempotency: pk idempotencyKey = "<tool>#<key>", TTL attribute expiresAt.

ponytail: no cross-item transactions -- a crash mid-tool leaves partial writes and the key
stays IN_PROGRESS until its lease expires, after which a retry re-runs the tool. replace_case
is last-writer-wins. Upgrade to TransactWriteItems / a version attribute if that matters.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any, Mapping

from .errors import ConflictError, NotFoundError
from .models import (
    ActionType, AuditRecord, AuditResult, Case, Evidence, HumanReviewRequest, Merchant,
    MerchantProfile, PolicyDecision, PolicyOutcome, Transaction, now_iso,
)
from .store import (
    CLAIM_LEASE_SECONDS, CLAIMED, IN_PROGRESS, MISMATCH, REPLAY, IdempotencyClaim, _parse_ts,
    build_audit_record, new_id, normalize_descriptor,
)

IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 3600


@dataclass(frozen=True, slots=True)
class Tables:
    transactions: str
    cases: str
    merchants: str
    audit: str
    idempotency: str

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "Tables":
        env = os.environ if environ is None else environ
        return cls(
            transactions=env["TRANSACTIONS_TABLE"], cases=env["CASES_TABLE"], merchants=env["MERCHANTS_TABLE"],
            audit=env["AUDIT_TABLE"], idempotency=env["IDEMPOTENCY_TABLE"],
        )


def to_attr(value: Any) -> dict[str, Any]:
    if value is None:
        return {"NULL": True}
    if isinstance(value, bool):
        return {"BOOL": value}
    if isinstance(value, (int, float)):
        return {"N": repr(value)}
    if isinstance(value, str):
        return {"S": value}
    if isinstance(value, (list, tuple)):
        return {"L": [to_attr(v) for v in value]}
    if isinstance(value, dict):
        return {"M": {k: to_attr(v) for k, v in value.items()}}
    raise TypeError(f"cannot serialize {type(value).__name__}")


def from_attr(attr: dict[str, Any]) -> Any:
    (kind, value), = attr.items()
    if kind == "NULL":
        return None
    if kind == "N":
        return float(value) if any(c in value for c in ".eEn") else int(value)
    if kind == "L":
        return [from_attr(v) for v in value]
    if kind == "M":
        return {k: from_attr(v) for k, v in value.items()}
    return value  # S, BOOL


def _item(**fields: Any) -> dict[str, Any]:
    return {k: to_attr(v) for k, v in fields.items()}


def _plain(item: dict[str, Any]) -> dict[str, Any]:
    return {k: from_attr(v) for k, v in item.items()}


def _conditional_failed(exc: Exception) -> bool:
    return getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"


class DynamoBankToolsStore:
    def __init__(self, client: Any, tables: Tables) -> None:
        self._c = client
        self._t = tables

    # -- low-level helpers --------------------------------------------------
    def _get(self, table: str, **key: str) -> dict[str, Any] | None:
        resp = self._c.get_item(TableName=table, Key=_item(**key), ConsistentRead=True)
        return _plain(resp["Item"]) if resp.get("Item") else None

    def _put(self, table: str, item: dict[str, Any], condition: str | None = None, values: dict[str, Any] | None = None) -> None:
        extra: dict[str, Any] = {"ConditionExpression": condition} if condition else {}
        if values:
            extra["ExpressionAttributeValues"] = _item(**values)
        if condition and "#s" in condition:
            extra["ExpressionAttributeNames"] = {"#s": "status"}
        self._c.put_item(TableName=table, Item=_item(**item), **extra)

    def _query(self, table: str, condition: str, values: dict[str, Any], index: str | None = None) -> list[dict[str, Any]]:
        args: dict[str, Any] = {
            "TableName": table, "KeyConditionExpression": condition,
            "ExpressionAttributeValues": _item(**values),
        }
        if index:
            args["IndexName"] = index
        rows: list[dict[str, Any]] = []
        while True:
            resp = self._c.query(**args)
            rows += [_plain(i) for i in resp.get("Items", [])]
            if not resp.get("LastEvaluatedKey"):
                return rows
            args["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    def _doc(self, table: str, **key: str) -> dict[str, Any] | None:
        row = self._get(table, **key)
        return row["doc"] if row else None

    # -- seeding ---------------------------------------------------------------
    def add_transaction(self, txn: Transaction) -> None:
        self._put(self._t.transactions, txn.to_dict())

    def add_customer(self, customer: dict[str, Any]) -> None:
        self._put(self._t.merchants, {"merchantId": f"C#{customer['customerId']}", "doc": customer})

    def add_merchant(self, merchant: Merchant) -> None:
        self._put(self._t.merchants, {"merchantId": f"M#{merchant.merchantId}", "doc": merchant.to_dict()})
        for alias in [merchant.canonicalName, *merchant.aliases]:
            self._put(self._t.merchants, {
                "merchantId": f"A#{normalize_descriptor(alias)}", "target": merchant.merchantId,
            })

    def add_merchant_profile(self, profile: MerchantProfile) -> None:
        self._put(self._t.merchants, {"merchantId": f"P#{profile.merchantId}", "doc": profile.to_dict()})

    def add_case(self, case: Case) -> None:
        self._put(self._t.cases, case.to_dict())

    def add_evidence(self, evidence: Evidence) -> None:
        self._put(self._t.cases, {"caseId": f"E#{evidence.evidenceId}", "doc": evidence.to_dict()})

    # -- idempotency -------------------------------------------------------------
    def claim_idempotency(
        self, tool: str, key: str, fingerprint: str, lease_seconds: int = CLAIM_LEASE_SECONDS,
    ) -> IdempotencyClaim:
        slot, now = f"{tool}#{key}", int(time.time())
        for _ in range(3):  # a TTL sweep can delete the row between the failed put and the read
            try:
                self._put(self._t.idempotency, {
                    "idempotencyKey": slot, "fingerprint": fingerprint, "status": "IN_PROGRESS",
                    "leaseExpiresAt": now + lease_seconds, "expiresAt": now + IDEMPOTENCY_TTL_SECONDS,
                }, condition="attribute_not_exists(idempotencyKey) OR "
                             "(#s = :inprog AND leaseExpiresAt < :now AND fingerprint = :fp)",
                    values={":inprog": "IN_PROGRESS", ":now": now, ":fp": fingerprint})
                return IdempotencyClaim(CLAIMED)
            except Exception as exc:
                if not _conditional_failed(exc):
                    raise
            row = self._get(self._t.idempotency, idempotencyKey=slot)
            if row is None:
                continue
            if row["fingerprint"] != fingerprint:
                return IdempotencyClaim(MISMATCH)
            if row["status"] == "COMPLETE":
                return IdempotencyClaim(REPLAY, json.loads(row["result"]))
            return IdempotencyClaim(IN_PROGRESS)
        return IdempotencyClaim(IN_PROGRESS)

    def release_idempotency(self, tool: str, key: str) -> None:
        try:
            self._c.delete_item(
                TableName=self._t.idempotency, Key=_item(idempotencyKey=f"{tool}#{key}"),
                ConditionExpression="#s = :inprog", ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues=_item(**{":inprog": "IN_PROGRESS"}),
            )
        except Exception as exc:
            if not _conditional_failed(exc):
                raise

    def idempotent_result(self, tool: str, key: str | None) -> dict[str, Any] | None:
        if not key:
            return None
        row = self._get(self._t.idempotency, idempotencyKey=f"{tool}#{key}")
        return json.loads(row["result"]) if row and row["status"] == "COMPLETE" else None

    def remember_result(self, tool: str, key: str | None, result: dict[str, Any]) -> None:
        if key:
            self._c.update_item(
                TableName=self._t.idempotency, Key=_item(idempotencyKey=f"{tool}#{key}"),
                UpdateExpression="SET #s = :done, #r = :result, expiresAt = :ttl",
                ExpressionAttributeValues=_item(**{
                    ":done": "COMPLETE", ":result": json.dumps(result),
                    ":ttl": int(time.time()) + IDEMPOTENCY_TTL_SECONDS,
                }), ExpressionAttributeNames={"#s": "status", "#r": "result"},
            )

    # -- transactions / customers ---------------------------------------------------
    def get_transaction(self, transaction_id: str) -> Transaction:
        row = self._get(self._t.transactions, transactionId=transaction_id)
        if row is None:
            raise NotFoundError(f"transaction not found: {transaction_id}")
        return Transaction.from_dict(row)

    def transactions_for_customer(
        self, customer_id: str, *, since: str | None = None, until: str | None = None,
    ) -> list[Transaction]:
        rows = self._query(
            self._t.transactions, "customerId = :c", {":c": customer_id}, index="byCustomer",
        )
        txns = sorted((Transaction.from_dict(r) for r in rows), key=lambda t: _parse_ts(t.occurredAt))
        if since:
            txns = [t for t in txns if _parse_ts(t.occurredAt) >= _parse_ts(since)]
        if until:
            txns = [t for t in txns if _parse_ts(t.occurredAt) <= _parse_ts(until)]
        return txns

    def get_customer(self, customer_id: str) -> dict[str, Any]:
        doc = self._doc(self._t.merchants, merchantId=f"C#{customer_id}")
        if doc is None:
            raise NotFoundError(f"customer not found: {customer_id}")
        return doc

    # -- merchants -----------------------------------------------------------------------
    def resolve_merchant_id(self, descriptor: str) -> str | None:
        row = self._get(self._t.merchants, merchantId=f"A#{normalize_descriptor(descriptor)}")
        return row["target"] if row else None

    def get_merchant(self, merchant_id: str) -> Merchant:
        doc = self._doc(self._t.merchants, merchantId=f"M#{merchant_id}")
        if doc is None:
            raise NotFoundError(f"merchant not found: {merchant_id}")
        return Merchant.from_dict(doc)

    def get_merchant_profile(self, merchant_id: str) -> MerchantProfile:
        doc = self._doc(self._t.merchants, merchantId=f"P#{merchant_id}")
        if doc is None:
            raise NotFoundError(f"merchant profile not found: {merchant_id}")
        return MerchantProfile.from_dict(doc)

    # -- cases / evidence ---------------------------------------------------------------------
    def get_case(self, case_id: str) -> Case:
        row = self._get(self._t.cases, caseId=case_id)
        if row is None:
            raise NotFoundError(f"case not found: {case_id}")
        return Case.from_dict(row)

    def cases_for_customer(self, customer_id: str) -> list[Case]:
        # GSI reads are eventually consistent: a case created a moment ago may not be listed yet.
        rows = self._query(self._t.cases, "customerId = :c", {":c": customer_id}, index="byCustomer")
        return sorted((Case.from_dict(r) for r in rows), key=lambda c: c.createdAt)

    def create_case(self, case: Case) -> Case:
        try:
            self._put(self._t.cases, case.to_dict(), condition="attribute_not_exists(caseId)")
        except Exception as exc:
            if _conditional_failed(exc):
                raise ConflictError(f"case already exists: {case.caseId}") from exc
            raise
        return case

    def replace_case(self, case: Case) -> None:
        try:
            self._put(self._t.cases, case.to_dict(), condition="attribute_exists(caseId)")
        except Exception as exc:
            if _conditional_failed(exc):
                raise NotFoundError(f"case not found: {case.caseId}") from exc
            raise

    def get_evidence(self, evidence_id: str) -> Evidence:
        doc = self._doc(self._t.cases, caseId=f"E#{evidence_id}")
        if doc is None:
            raise NotFoundError(f"evidence not found: {evidence_id}")
        return Evidence.from_dict(doc)

    def evidence_for_case(self, case_id: str) -> list[Evidence]:
        return [self.get_evidence(eid) for eid in self.get_case(case_id).evidenceIds]

    # -- policy decisions / human review / audit ------------------------------------------------------
    def _put_audit_row(self, case_id: str, prefix: str, doc: dict[str, Any], sk: str | None = None) -> None:
        self._put(
            self._t.audit, {"caseId": case_id, "eventId": sk or new_id(prefix), "doc": doc},
            condition="attribute_not_exists(eventId)",
        )

    def _audit_rows(self, case_id: str, prefix: str) -> list[dict[str, Any]]:
        rows = self._query(
            self._t.audit, "caseId = :c AND begins_with(eventId, :p)", {":c": case_id, ":p": prefix},
        )
        return [r["doc"] for r in rows]

    def add_policy_decision(self, decision: PolicyDecision) -> None:
        self._put_audit_row(decision.caseId, "policy", decision.to_dict(), sk=decision.decisionId)

    def policy_decisions_for_case(self, case_id: str) -> list[PolicyDecision]:
        docs = sorted(self._audit_rows(case_id, "policy_"), key=lambda d: d["decidedAt"])
        return [PolicyDecision.from_dict(d) for d in docs]

    def add_human_review_request(self, request: HumanReviewRequest) -> None:
        self._put_audit_row(request.caseId, "review", request.to_dict())

    def human_review_requests_for_case(self, case_id: str) -> list[HumanReviewRequest]:
        return [HumanReviewRequest.from_dict(d) for d in self._audit_rows(case_id, "review_")]

    def record_audit(
        self, *, case_id: str, action: str, tool: str, result: AuditResult | str = AuditResult.SUCCESS,
        policy_name: str | None = None, policy_outcome: PolicyOutcome | None = None,
        proposed_action: ActionType | None = None, input_amount: float | None = None,
        human_approval_required: bool | None = None,
    ) -> AuditRecord:
        record = build_audit_record(
            case_id=case_id, action=action, tool=tool, result=result, policy_name=policy_name,
            policy_outcome=policy_outcome, proposed_action=proposed_action, input_amount=input_amount,
            human_approval_required=human_approval_required,
        )
        self._put_audit_row(case_id, "audit", record.to_dict(), sk=record.eventId)
        return record

    def audit_for_case(self, case_id: str) -> list[AuditRecord]:
        docs = sorted(self._audit_rows(case_id, "audit_"), key=lambda d: d["timestamp"])
        return [AuditRecord.from_dict(d) for d in docs]
