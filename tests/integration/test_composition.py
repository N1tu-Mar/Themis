"""Agent turns over the real tools adapter behind the Cedar gate (no network, no AWS)."""
import json
import sys
from types import SimpleNamespace

import harness
from merchant_intel import DynamoProfileStore, MerchantIntel
from orchestrator.main import _reply, load_directory
from orchestrator.workflow import MemoryReportStore
from router import ToolAdapter

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
    escalation_args = next(args for tool, args in comp.gateway.calls if tool == "escalate_case")
    assert review.summary == escalation_args["summary"]
    assert review.evidenceRefs == escalation_args["evidenceRefs"]
    assert comp.reports.get(r.case_id)["humanReviewEvents"][0]["reason"] == "POLICY_REQUIRE_HUMAN_REVIEW"


def test_recurring_case_with_block_request_hits_every_gate():
    comp = harness.Composition()
    r = run(comp, "customer_demo_001", "9.99 from ASTDIGITAL", "yes I don't recognize it and please block future payments")
    assert r.status == "RESOLVED" and {"propose_payment_block", "propose_dispute_creation"} <= set(tools(comp))


def test_scenario_b_cancellation_persists_without_card_fraud_actions():
    comp = harness.Composition()
    r = run(comp, "customer_demo_001", "9.99 from ASTDIGITAL", "yes, I canceled it last month")
    case = comp.store.get_case(r.case_id)
    assert (r.status, str(case.status), str(case.claimType)) == (
        "RESOLVED", "RESOLVED", "RECURRING_PAYMENT_AFTER_CANCELLATION")
    called = set(tools(comp))
    assert "propose_dispute_creation" in called
    assert not {"propose_card_replacement", "propose_provisional_credit", "propose_payment_block"} & called
    assert any("cancellation" in item.lower() for item in comp.reports.get(r.case_id)["missingEvidence"])


def test_scenario_c_recognized_merchant_outcome_persists_through_real_adapter():
    comp = harness.Composition()
    r = run(comp, "customer_demo_001", "19.99 from ASTDIGITAL", "yes, I recognize it")
    case = comp.store.get_case(r.case_id)
    assert (r.status, str(case.status), str(case.outcome)) == (
        "RESOLVED", "RESOLVED", "CUSTOMER_RECOGNIZED_MERCHANT")
    assert comp.reports.get(r.case_id)["outcome"] == "CUSTOMER_RECOGNIZED_MERCHANT"
    update = [args for tool, args in comp.gateway.calls if tool == "update_case" and "outcome" in args]
    assert len(update) == 1
    assert update[0]["caseId"] == r.case_id and update[0]["status"] == "RESOLVED"
    assert update[0]["outcome"] == "CUSTOMER_RECOGNIZED_MERCHANT" and update[0]["idempotencyKey"]


class _FakeDynamo:
    def __init__(self):
        self.items = {}

    def get_item(self, *, Key, **_):
        item = self.items.get(Key["merchantId"]["S"])
        return {"Item": item} if item else {}

    def put_item(self, *, Item, ConditionExpression=None, ExpressionAttributeValues=None, **_):
        key, current = Item["merchantId"]["S"], self.items.get(Item["merchantId"]["S"])
        allowed = (current is None if ConditionExpression == "attribute_not_exists(merchantId)" else
                   current is None or current.get("rev") == (ExpressionAttributeValues or {}).get(":r")
                   if ConditionExpression == "attribute_not_exists(#r) OR #r = :r" else
                   current is None or current.get("target") == (ExpressionAttributeValues or {}).get(":t"))
        if not allowed:
            exc = Exception("conditional")
            exc.response = {"Error": {"Code": "ConditionalCheckFailedException"}}
            raise exc
        self.items[key] = Item

    def scan(self, *, ExpressionAttributeValues, **_):
        prefix = ExpressionAttributeValues[":p"]["S"]
        return {"Items": [item for key, item in self.items.items() if key.startswith(prefix)]}


class _CountingResearcher:
    def __init__(self):
        self.calls = []

    def research(self, merchant_id, canonical_name):
        self.calls.append((merchant_id, canonical_name))
        return {"sourceSummary": "should not run on a fresh cache entry"}


def test_scenario_e_durable_profile_cache_is_reused_by_a_new_adapter_instance():
    dynamo, researcher = _FakeDynamo(), _CountingResearcher()
    first_intel = MerchantIntel(DynamoProfileStore(dynamo, "ThemisMerchants"), researcher=researcher)
    first_intel.load_profiles(json.loads((ROOT / "fixtures/merchants/demo-profiles.json").read_text(encoding="utf-8")))
    comp = harness.Composition()
    first = ToolAdapter(comp.store, first_intel, MemoryReportStore(), lambda _: {"messageId": "m1"})
    merchant_id = first.call("resolve_merchant", {"descriptor": "ASTDIGITAL"})["merchantId"]
    assert first.call("get_merchant_profile", {"merchantId": merchant_id})["cache"]["status"] == "hit"

    second_intel = MerchantIntel(DynamoProfileStore(dynamo, "ThemisMerchants"), researcher=researcher)
    second = ToolAdapter(comp.store, second_intel, MemoryReportStore(), lambda _: {"messageId": "m2"})
    profile = second.call("get_merchant_profile", {"merchantId": merchant_id})
    assert profile["cache"]["status"] == "hit" and profile["cache"]["researchPerformed"] is False
    assert profile["requiresCustomerVerification"] is True and researcher.calls == []


def test_duplicate_policy_escalation_creates_exactly_one_review_request():
    comp = harness.Composition()
    transaction_id = comp.adapter.call("search_transactions", {"customerId": "customer_demo_001", "limit": 1})["transactions"][0]["id"]
    case_id = comp.adapter.call("create_case", {"customerId": "customer_demo_001", "claimType": "UNRECOGNIZED_MERCHANT",
                                                  "transactionIds": [transaction_id], "idempotencyKey": "dup:create"})["case"]["caseId"]
    for status in ("INTAKE", "TRANSACTION_MATCHING", "AWAITING_TRANSACTION_CONFIRMATION", "CLASSIFYING_DISPUTE"):
        assert comp.adapter.call("update_case", {"caseId": case_id, "status": status,
                                                  "idempotencyKey": f"dup:{status}"})["status"] == "ok"
    decision = comp.adapter.call("propose_provisional_credit", {"caseId": case_id, "amount": 5000,
                                                                  "confidence": 1, "claimType": "UNRECOGNIZED_MERCHANT",
                                                                  "idempotencyKey": "dup:policy"})
    assert decision["decision"]["outcome"] == "REQUIRE_HUMAN_REVIEW"
    for key in ("dup:escalate:1", "dup:escalate:2"):
        assert comp.adapter.call("escalate_case", {"caseId": case_id, "reason": "POLICY_REQUIRE_HUMAN_REVIEW",
                                                    "summary": "Policy requires a specialist.", "evidenceRefs": [],
                                                    "idempotencyKey": key})["status"] == "ok"
    assert len(comp.store.human_review_requests_for_case(case_id)) == 1


def test_notification_failure_after_completion_does_not_change_case_or_report():
    comp = harness.Composition(messenger=lambda _: {"status": "FAILED", "error": "SES unavailable"})
    r = run(comp, "customer_demo_001", "19.99 from ASTDIGITAL", "yes I don't recognize it")
    before = comp.store.get_case(r.case_id).to_dict()
    report = comp.reports.get(r.case_id)
    result = comp.adapter.call("send_case_email", {"caseId": r.case_id, "idempotencyKey": "notify:failed"})
    assert result["status"] == "error" and result["error"]["code"] == "DELIVERY_FAILED"
    assert comp.store.get_case(r.case_id).to_dict() == before
    assert comp.reports.get(r.case_id) == report
    assert comp.store.human_review_requests_for_case(r.case_id) == []


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
