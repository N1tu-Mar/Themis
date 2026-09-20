"""Agent turns over the real tools adapter behind the Cedar gate (no network, no AWS)."""
import json
import sys
from types import SimpleNamespace

import harness
from orchestrator.main import _reply, load_directory

ROOT = harness.ROOT


def run(comp, customer, *messages):
    for m in messages:
        reply = comp.agent.handle_turn("conv", customer, m)
    return reply


def tools(comp):
    return [t for t, _ in comp.gateway.calls]


def test_policy_allowed_case_resolves_with_report():
    comp = harness.Composition()
    r = run(comp, "customer_demo_001", "19.99 from ASTDIGITAL", "yes I don't recognize it")
    case = comp.store.get_case(r.case_id)
    assert (r.status, str(case.status)) == ("RESOLVED", "RESOLVED")
    assert [d.outcome.value for d in comp.store.policy_decisions_for_case(r.case_id)] == ["ALLOW", "ALLOW"]
    report = comp.reports.get(r.case_id)
    assert report["classification"] == "UNRECOGNIZED_MERCHANT" and report["merchant"]["merchantId"] == "merchant_demo_001"
    assert "escalate_case" not in tools(comp) and comp.store.human_review_requests_for_case(r.case_id) == []


def test_cedar_denial_leads_to_escalate_case():
    comp = harness.Composition(harness.cedar_permits(credit_limit=5))  # Cedar denies the $19.99 credit; bank policy alone would allow
    r = run(comp, "customer_demo_001", "19.99 from ASTDIGITAL", "yes I don't recognize it")
    assert r.status == "NEEDS_HUMAN_REVIEW"
    assert tools(comp).index("propose_provisional_credit") < tools(comp).index("escalate_case") < tools(comp).index("generate_case_report")
    assert str(comp.store.get_case(r.case_id).status) == "NEEDS_HUMAN_REVIEW" and comp.store.get_case(r.case_id).requiresHumanReview
    (review,) = comp.store.human_review_requests_for_case(r.case_id)
    assert review.reason == "POLICY_REQUIRE_HUMAN_REVIEW"
    assert comp.reports.get(r.case_id)["humanReviewEvents"][0]["reason"] == "POLICY_REQUIRE_HUMAN_REVIEW"


def test_recurring_case_with_block_request_hits_every_gate():
    comp = harness.Composition()
    r = run(comp, "customer_demo_001", "9.99 from ASTDIGITAL", "yes I don't recognize it and please block future payments")
    assert r.status == "RESOLVED" and {"propose_payment_block", "propose_dispute_creation"} <= set(tools(comp))


def test_inbound_message_payload_maps_sender_to_customer():
    comp, directory = harness.Composition(), load_directory(str(ROOT / "fixtures/customers/demo.json"))
    msg = {"channel": "SMS", "customerExternalId": "+15555550100", "messageId": "m1", "text": "9.99 from ASTDIGITAL", "postback": None,
           "receivedAt": "2026-09-20T14:00:00Z"}
    assert _reply(comp.agent, msg, directory)["status"] == "AWAITING_TRANSACTION_CONFIRMATION"
    unknown = _reply(comp.agent, {**msg, "customerExternalId": "+15555559999"}, directory)
    assert unknown["status"] == "UNVERIFIED" and unknown["caseId"] is None


def test_gateway_lambda_event_parsing():
    sys.path.insert(0, str(ROOT / "infra/lambda/tools-adapter"))
    from handler import parse_event
    ctx = SimpleNamespace(client_context=SimpleNamespace(custom={"bedrockAgentCoreToolName": "themis-tools___get_case"}))
    assert parse_event({"caseId": "c1"}, ctx) == ("get_case", {"caseId": "c1"})
    assert parse_event({"toolName": "get_case", "input": {"caseId": "c1"}}, SimpleNamespace(client_context=None)) == ("get_case", {"caseId": "c1"})
