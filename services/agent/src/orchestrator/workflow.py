"""Case workflow services behind the Gateway's generate_case_report and escalate_case tools.

Runs inside the tools-adapter Lambda (not the Runtime) on top of the bank-tools system of record, so the
report is rebuilt from stored case state, never from anything the model asserts. Idempotency and argument
validation come from bank_tools.dispatch (these functions are registered as extra Specs).
"""
from __future__ import annotations

import json
from typing import Any, Protocol

from bank_tools import tools
from bank_tools.models import CaseStatus, HumanReviewRequest, now_iso
from bank_tools.store import BankToolsStorage


class ReportStore(Protocol):
    def put(self, case_id: str, report: dict[str, Any]) -> None: ...
    def get(self, case_id: str) -> dict[str, Any] | None: ...


class MemoryReportStore:
    def __init__(self) -> None:
        self.reports: dict[str, dict[str, Any]] = {}

    def put(self, case_id: str, report: dict[str, Any]) -> None:
        self.reports[case_id] = report

    def get(self, case_id: str) -> dict[str, Any] | None:
        return self.reports.get(case_id)


class S3ReportStore:
    """reports/<caseId>.json in the artifacts bucket (`client` is boto3.client("s3"))."""
    def __init__(self, client: Any, bucket: str) -> None:
        self.client, self.bucket = client, bucket

    def put(self, case_id: str, report: dict[str, Any]) -> None:
        self.client.put_object(Bucket=self.bucket, Key=f"reports/{case_id}.json", Body=json.dumps(report).encode(),
                               ContentType="application/json")

    def get(self, case_id: str) -> dict[str, Any] | None:
        try:
            return json.loads(self.client.get_object(Bucket=self.bucket, Key=f"reports/{case_id}.json")["Body"].read())
        except self.client.exceptions.NoSuchKey:
            return None


def build_report(store: BankToolsStorage, case_id: str) -> dict[str, Any]:
    """CaseReport (packages/contracts) from stored state only."""
    case = store.get_case(case_id)
    evidence = [store.get_evidence(e).to_dict() for e in case.evidenceIds]
    decisions = [d.to_dict() for d in store.policy_decisions_for_case(case_id)]  # type: ignore[attr-defined]
    reviews = [r.to_dict() for r in store.human_review_requests_for_case(case_id)]  # type: ignore[attr-defined]
    audit = store.audit_for_case(case_id)
    claims = [e["claim"] for e in evidence if e["category"] == "CUSTOMER_CLAIMS"]
    missing = [e["claim"] for e in evidence if e["category"] == "MISSING_EVIDENCE"]
    contradictory = [e["evidenceId"] for e in evidence if e["category"] == "CONTRADICTORY_EVIDENCE"]
    resolution = None if case.confidence is None else {
        "caseId": case_id, "classification": str(case.claimType), "confidence": case.confidence,
        "supportingEvidence": [e["evidenceId"] for e in evidence if e["category"] not in ("CONTRADICTORY_EVIDENCE", "MISSING_EVIDENCE")],
        "contradictoryEvidence": contradictory, "missingEvidence": missing,
        "recommendedActions": [str(a) for a in case.recommendedActions], "requiresHumanReview": case.requiresHumanReview,
    }
    report: dict[str, Any] = {
        "caseId": case_id,
        "customerComplaintSummary": claims[0] if claims else f"Customer disputed {len(case.transactionIds)} transaction(s).",
        "transactions": [store.get_transaction(t).to_dict() for t in case.transactionIds],
        "totalDisputedAmount": case.totalDisputedAmount, "currency": case.currency,
        "merchant": store.get_merchant(case.merchantId).to_dict() if case.merchantId else None,
        "classification": str(case.claimType),
        "timeline": [{"timestamp": a.timestamp, "summary": f"{a.action} ({a.tool}): {a.result}"} for a in audit]
                    or [{"timestamp": case.createdAt, "summary": "Case created."}],
        "customerStatements": claims, "evidence": evidence, "missingEvidence": missing, "resolution": resolution,
        "actionsTaken": [d["action"] for d in decisions if d["outcome"] == "ALLOW"],
        "policyDecisions": decisions, "humanReviewEvents": reviews,
        "generatedAt": now_iso(), "auditRefs": [a.eventId for a in audit],
    }
    if case.outcome is not None:
        report["outcome"] = str(case.outcome)
    return report


def generate_case_report(store: BankToolsStorage, reports: ReportStore, *, case_id: str) -> dict[str, Any]:
    report = build_report(store, case_id)
    reports.put(case_id, report)
    store.record_audit(case_id=case_id, action="GENERATE_CASE_REPORT", tool="generate_case_report")
    return {"status": "ok", "reportId": f"report_{case_id}", "caseId": case_id, "generatedAt": report["generatedAt"],
            "transactionCount": len(report["transactions"])}


def escalate_case(
    store: BankToolsStorage, *, case_id: str, reason: str, summary: str | None = None,
    evidence_refs: list[str] | None = None,
) -> dict[str, Any]:
    """Move the case to NEEDS_HUMAN_REVIEW and queue at most one review request per case + reason.

    `reason` is a code, or the legacy "CODE: summary [evidence: ids]" when `summary` is not passed. A POLICY_* code
    reuses the review a propose_* tool already queued (POLICY_REQUIRES_REVIEW:<action>) instead of adding a second.
    Evidence refs are limited to evidence actually stored on the case; none given means all of it.
    """
    case = store.get_case(case_id)
    changed = case.status is not CaseStatus.NEEDS_HUMAN_REVIEW
    if changed:
        r = tools.update_case(store, case_id=case_id, patch={"status": str(CaseStatus.NEEDS_HUMAN_REVIEW), "requiresHumanReview": True},
                              idempotency_key=f"escalate:{case_id}")
        if r["status"] != "ok":
            return r
    code, _, legacy = reason.partition(": ")
    existing = [r.reason for r in store.human_review_requests_for_case(case_id)]
    duplicate = code in existing or (code.startswith("POLICY_") and any(e.startswith("POLICY_") for e in existing))
    if not duplicate:
        refs = ([e for e in evidence_refs if e in case.evidenceIds]
                if evidence_refs is not None else list(case.evidenceIds))
        store.add_human_review_request(HumanReviewRequest(
            caseId=case_id, reason=code, summary=summary or legacy or reason,
            recommendedNextStep="Review the case evidence and decide the next step.", evidenceRefs=refs))
    if changed or not duplicate:
        store.record_audit(case_id=case_id, action="ESCALATE_CASE", tool="escalate_case", human_approval_required=True)
    return {"status": "ok", "caseId": case_id, "queued": True, "duplicate": duplicate}
