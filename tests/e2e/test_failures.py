"""Failure injection: every failure must fail closed (no unapproved action, no lost or duplicated write, no false claim)."""
from datetime import UTC, datetime

import pytest
from world import Config, CountingResearcher, World, harness, reconcile_case
from orchestrator.engine import RETRY_MSG  # noqa: E402  (world wires sys.path)
from orchestrator.local import ScriptedModel  # noqa: E402

C = "customer_demo_001"
TURNS = ("9.99 from ASTERIA", "yes I don't recognize it")


def world(**kw):
    return World(config=Config(structured_tools=True), **kw)


def cases(w, customer=C):
    return len(w.store.cases_for_customer(customer))


# -- Bedrock ---------------------------------------------------------------------------------------------------------

def test_bedrock_failure_creates_nothing_then_conversation_continues():
    w = world(model=ScriptedModel(RuntimeError("bedrock throttled"), {"hints": {"descriptor": "Asteria", "amount": 10}},
                                  {"selection": "all", "recognizes_merchant": False}))
    before = cases(w)
    r = w.chat(C, "hi")
    assert r.text == RETRY_MSG and r.case_id is None and cases(w) == before and w.gateway.calls == []
    assert w.chat(C, "9.99 from Asteria").status == "AWAITING_TRANSACTION_CONFIRMATION"
    final = w.chat(C, "yes")
    assert final.status == "RESOLVED" and cases(w) == before + 1
    reconcile_case(w, final.case_id)


# -- tools -----------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("tool", ["save_evidence", "update_case", "get_merchant_profile", "search_transactions"])
def test_single_transient_tool_failure_is_absorbed(tool):
    w = world()
    before = cases(w)
    w.gateway.fail(tool, 1)
    r = w.chat(C, *TURNS)
    assert r.status == "RESOLVED" and cases(w) == before + 1
    reconcile_case(w, r.case_id)


def test_persistent_create_case_failure_leaves_no_case_and_asks_to_retry():
    w = world()
    w.gateway.fail("create_case", 99)
    before = cases(w)
    r = w.chat(C, *TURNS)
    assert r.text == RETRY_MSG and r.case_id is None and cases(w) == before
    assert not any(t.startswith("propose_") for t in w.tools())


@pytest.mark.parametrize("kind", ["error", "raise"])
def test_policy_gateway_failure_never_allows_an_action(kind):
    w = world()
    w.gateway.fail("propose_dispute_creation", 99, kind)
    r = w.chat(C, *TURNS)
    assert r.status == "NEEDS_HUMAN_REVIEW" and w.store.get_case(r.case_id).requiresHumanReview
    assert w.store.policy_decisions_for_case(r.case_id) == []
    assert len(w.store.human_review_requests_for_case(r.case_id)) == 1


def test_stale_profile_with_failed_research_degrades_but_case_survives():
    w = world(researcher=CountingResearcher(fail=True))
    w.clock.t = datetime(2026, 9, 26, tzinfo=UTC)
    r = w.chat(C, *TURNS)
    assert r.status in ("RESOLVED", "NEEDS_HUMAN_REVIEW") and r.case_id
    assert w.researcher.calls, "research was attempted"
    assert w.adapter.call("get_merchant_profile", {"merchantId": "merchant_demo_001"})["cache"]["stale"] is True


# -- policy denial ----------------------------------------------------------------------------------------------------

def test_cedar_limit_denial_escalates_and_reconciles():
    w = world(permits=harness.cedar_permits(credit_limit=5))  # bank policy would allow the $19.99 credit; Cedar does not
    r = w.chat(C, "19.99 from ASTDIGITAL", "yes I don't recognize it")
    assert r.status == "NEEDS_HUMAN_REVIEW"
    t = w.tools()
    assert t.index("propose_provisional_credit") < t.index("escalate_case") < t.index("generate_case_report")
    assert w.reports.get(r.case_id)["actionsTaken"] == ["CREATE_DISPUTE"]  # dispute allowed; the credit never granted
    reconcile_case(w, r.case_id)


def test_missing_cedar_permit_denies_by_default():
    permits = {k: v for k, v in harness.cedar_permits().items() if k != "propose_dispute_creation"}
    w = world(permits=permits)
    r = w.chat(C, *TURNS)
    assert r.status == "NEEDS_HUMAN_REVIEW" and w.store.policy_decisions_for_case(r.case_id) == []
    assert "escalate_case" in w.tools()


# -- messaging / SES -------------------------------------------------------------------------------------------------

def open_case(w):
    return w.chat(C, *TURNS).case_id


@pytest.mark.parametrize("tool, args", [("send_customer_message", {"channel": "SMS", "text": "hello"}), ("send_case_email", {})])
def test_delivery_failure_never_touches_the_case(tool, args):
    """SMS and SES share the messenger seam. The failure surfaces; case, evidence and report are untouched; no duplicate send."""
    w = world()
    case_id = open_case(w)
    case_before = w.store.get_case(case_id).to_dict()
    report_before = w.reports.get(case_id)
    w.messenger.fail = {tool}
    payload = {"caseId": case_id, "idempotencyKey": "k-notify", **args}
    with pytest.raises(RuntimeError):
        w.adapter.call(tool, payload)
    # same key while the outcome is unknown: blocked, never a second send
    assert w.adapter.call(tool, payload)["error"]["code"] == "IDEMPOTENCY_IN_PROGRESS"
    assert w.messenger.sent == []
    assert w.store.get_case(case_id).to_dict() == case_before and w.reports.get(case_id) == report_before
    # a fresh key after recovery sends exactly once, and replays
    w.messenger.fail = set()
    fresh = {**payload, "idempotencyKey": "k-notify-2"}
    first = w.adapter.call(tool, fresh)
    assert first["status"] == "ok" and w.adapter.call(tool, fresh) == first and len(w.messenger.sent) == 1
    reconcile_case(w, case_id)


def test_ses_rejection_is_reported_as_delivery_failed_and_leaves_the_case_alone():
    w = world()
    case_id = open_case(w)
    before, report = w.store.get_case(case_id).to_dict(), w.reports.get(case_id)
    w.messenger.soft_fail = {"send_case_email"}
    r = w.adapter.call("send_case_email", {"caseId": case_id, "idempotencyKey": "k-ses"})
    assert r["error"]["code"] == "DELIVERY_FAILED" and r["caseStatus"] == "RESOLVED" and w.messenger.sent == []
    assert w.store.get_case(case_id).to_dict() == before and w.reports.get(case_id) == report
    w.messenger.soft_fail = set()  # nothing committed, so the same key may be retried and sends once
    assert w.adapter.call("send_case_email", {"caseId": case_id, "idempotencyKey": "k-ses"})["status"] == "ok"
    assert len(w.messenger.sent) == 1


def test_email_before_report_is_refused_not_faked():
    w = world()
    case_id = w.adapter.call("create_case", {"customerId": C, "claimType": "INSUFFICIENT_INFORMATION", "transactionIds": ["txn_demo_0001"],
                                             "idempotencyKey": "k"})["case"]["caseId"]
    assert w.adapter.call("send_case_email", {"caseId": case_id, "idempotencyKey": "e"})["error"]["code"] == "NOT_FOUND"
    assert w.messenger.sent == []


# -- partial completion ----------------------------------------------------------------------------------------------

def test_report_failure_after_case_work_keeps_the_case_and_its_evidence():
    w = world()
    w.gateway.fail("generate_case_report", 99, "raise")
    r = w.chat(C, *TURNS)
    case = w.store.get_case(r.case_id)
    assert r.case_id and case.evidenceIds and w.store.audit_for_case(r.case_id)  # nothing rolled back
    assert [str(d.outcome) for d in w.store.policy_decisions_for_case(r.case_id)] == ["ALLOW"]


def test_report_failure_is_never_reported_as_success():
    w = world()
    w.gateway.fail("generate_case_report", 99, "raise")
    r = w.chat(C, *TURNS)
    assert w.reports.get(r.case_id) is not None or r.status == "NEEDS_HUMAN_REVIEW"
    assert w.reports.get(r.case_id) is not None or "prepared a report" not in r.text


def test_stale_profile_refresh_returns_the_refreshed_profile_on_first_call():
    w = world()
    w.clock.t = datetime(2026, 9, 26, tzinfo=UTC)
    r = w.adapter.call("get_merchant_profile", {"merchantId": "merchant_demo_001"})
    assert r["status"] == "ok" and r["cache"]["researchPerformed"] is True and w.researcher.calls == ["merchant_demo_001"]
