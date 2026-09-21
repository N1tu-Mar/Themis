"""Workflow hardening: escalation idempotency, stored-state policy inputs, Scenarios B/C/E, structured tools, suggestions."""
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
for p in ("services/bank-tools/src", "services/merchant-intel/src", "infra/lambda/tools-adapter"):
    sys.path.insert(0, str(ROOT / p))

from bank_tools import tools as bank  # noqa: E402
from bank_tools.fixtures import load_demo_store  # noqa: E402
from merchant_intel import InMemoryProfileStore, MerchantIntel  # noqa: E402
from router import ToolAdapter  # noqa: E402

from orchestrator import workflow  # noqa: E402
from orchestrator.config import Config  # noqa: E402
from orchestrator.engine import Orchestrator  # noqa: E402
from orchestrator.local import HeuristicModel, InMemoryMemory, LocalGateway, StubResearch  # noqa: E402
from orchestrator.main import _reply  # noqa: E402
from test_agent_scenarios import ASTERIA, CONFIRM_DENY, TODAY, make, tools  # noqa: E402

REVIEW_PATH = ["INTAKE", "TRANSACTION_MATCHING", "AWAITING_TRANSACTION_CONFIRMATION", "CLASSIFYING_DISPUTE"]


class RealGateway:
    """The real bank-tools store behind the tools adapter, plus the fields Infra is asked to add (outcome, summary, evidenceRefs).
    `before[tool](args)` may tamper with the store or the arguments to simulate a misbehaving caller."""
    def __init__(self, before=None):
        self.store = load_demo_store(ROOT)
        intel = MerchantIntel(InMemoryProfileStore())
        intel.load_profiles(json.loads((ROOT / "fixtures/merchants/demo-profiles.json").read_text(encoding="utf-8")))
        self.adapter = ToolAdapter(self.store, intel, workflow.MemoryReportStore(), lambda r: {"messageId": "m"})
        self.before, self.calls = before or {}, []

    def call(self, tool, arguments):
        self.calls.append((tool, dict(arguments)))
        if tool in self.before:
            arguments = self.before[tool](dict(arguments)) or arguments
        return self.adapter.call(tool, arguments)

    def agent(self):
        return Orchestrator(model=HeuristicModel(), gateway=self, memory=InMemoryMemory(), research=StubResearch(),
                            config=Config(structured_tools=True), today=lambda: TODAY)

    def reviews(self, case_id):
        return self.store.human_review_requests_for_case(case_id)

    def audit(self, case_id, tool):
        return [a for a in self.store.audit_for_case(case_id) if a.tool == tool]


def run(gw, customer, *messages):
    agent = gw.agent()
    for m in messages:
        r = agent.handle_turn("conv", customer, m)
    return r


def open_case(gw, status_path=REVIEW_PATH):
    txn = gw.adapter.call("search_transactions", {"customerId": "customer_demo_001", "limit": 1})["transactions"][0]["id"]
    case_id = gw.adapter.call("create_case", {"customerId": "customer_demo_001", "claimType": "UNRECOGNIZED_MERCHANT",
                                              "transactionIds": [txn], "idempotencyKey": "c"})["case"]["caseId"]
    for s in status_path:
        assert gw.adapter.call("update_case", {"caseId": case_id, "status": s, "idempotencyKey": f"s:{s}"})["status"] == "ok"
    return case_id


# -- duplicate escalation -----------------------------------------------------------

def test_policy_review_then_escalate_case_leaves_one_review_request():
    gw = RealGateway()
    case_id = open_case(gw)
    assert gw.adapter.call("propose_provisional_credit", {"caseId": case_id, "amount": 5000, "confidence": 1, "claimType": "X",
                                                          "idempotencyKey": "p"})["decision"]["outcome"] == "REQUIRE_HUMAN_REVIEW"
    for key in ("e1", "e2"):   # a fresh key must not create a second request either
        assert gw.adapter.call("escalate_case", {"caseId": case_id, "reason": "POLICY_REQUIRE_HUMAN_REVIEW", "summary": "s", "idempotencyKey": key})["status"] == "ok"
    (review,) = gw.reviews(case_id)
    assert review.reason.startswith("POLICY_REQUIRES_REVIEW")
    assert len(gw.audit(case_id, "propose_provisional_credit")) == 1 and len(gw.audit(case_id, "escalate_case")) == 1
    assert str(gw.store.get_case(case_id).status) == "NEEDS_HUMAN_REVIEW"


def test_policy_deny_then_escalate_case_leaves_one_review_request_and_replay_is_a_noop():
    gw = RealGateway()
    case_id = open_case(gw)
    assert gw.adapter.call("propose_payment_block", {"caseId": case_id, "customerRequested": False, "idempotencyKey": "p"})["decision"]["outcome"] == "DENY"
    args = {"caseId": case_id, "reason": "POLICY_DENY", "summary": "block denied", "evidenceRefs": ["ev_invented"], "idempotencyKey": "e"}
    for _ in range(2):
        assert gw.adapter.call("escalate_case", args)["status"] == "ok"
    gw.adapter.call("escalate_case", {**args, "idempotencyKey": "other"})
    (review,) = gw.reviews(case_id)
    assert (review.reason, review.summary, review.evidenceRefs) == ("POLICY_DENY", "block denied", [])   # invented refs dropped
    assert len(gw.audit(case_id, "escalate_case")) == 1


def test_full_flow_policy_require_review_and_deny_each_make_one_review_and_one_escalation_audit():
    # credit: stored confidence drops after the agent's own check, so bank policy (which reads the stored case) asks for review
    for tool, before in (
        ("propose_provisional_credit", None),
        ("propose_payment_block", lambda a: {**a, "customerRequested": False}),
    ):
        hooks = {tool: before} if before else {}
        gw = RealGateway(hooks)
        if not before:   # lower the stored confidence just before the credit is proposed
            gw.before[tool] = lambda a: gw.store.replace_case(_with(gw.store.get_case(a["caseId"]), confidence=0.1))
        msg = "yes I don't recognize it" + (" and please block future payments" if tool == "propose_payment_block" else "")
        r = run(gw, "customer_demo_001", "19.99 from ASTDIGITAL" if before is None else "9.99 from ASTDIGITAL", msg)
        assert r.status == "NEEDS_HUMAN_REVIEW", tool
        assert len(gw.reviews(r.case_id)) == 1, tool
        assert len(gw.audit(r.case_id, "escalate_case")) == 1 and len(gw.audit(r.case_id, tool)) == 1, tool


def _with(case, **kw):
    from dataclasses import replace
    return replace(case, **kw)


# -- stored state, not model/agent claims, feeds policy ------------------------------------

def test_stored_case_mismatch_escalates_before_any_policy_call():
    gw = RealGateway({"get_case": lambda a: gw.store.replace_case(_with(gw.store.get_case(a["caseId"]), claimType="DUPLICATE_TRANSACTION"))})
    r = run(gw, "customer_demo_001", "19.99 from ASTDIGITAL", "yes I don't recognize it")
    assert r.status == "NEEDS_HUMAN_REVIEW"
    assert not any(t.startswith("propose_") for t, _ in gw.calls)
    (review,) = gw.reviews(r.case_id)
    assert review.reason == "CASE_STATE_MISMATCH"


# -- Scenario C through the real update path --------------------------------------------------

def test_scenario_c_outcome_is_persisted_by_bank_tools():
    gw = RealGateway()
    r = run(gw, "customer_demo_001", "19.99 from ASTDIGITAL", "yes I recognize it")
    case = gw.store.get_case(r.case_id)
    assert (r.status, str(case.status), str(case.outcome)) == ("RESOLVED", "RESOLVED", "CUSTOMER_RECOGNIZED_MERCHANT")
    assert not any(t.startswith("propose_") for t, _ in gw.calls) and gw.reviews(r.case_id) == []


def test_outcome_is_accepted_by_the_integrated_gateway_schema():
    gw = RealGateway()
    case_id = open_case(gw)
    plain = ToolAdapter(gw.store, MerchantIntel(InMemoryProfileStore()), workflow.MemoryReportStore(), lambda r: {})
    r = plain.call("update_case", {"caseId": case_id, "status": "RESOLVED", "outcome": "CUSTOMER_RECOGNIZED_MERCHANT", "idempotencyKey": "o"})
    assert r["status"] == "ok"
    assert str(gw.store.get_case(case_id).outcome) == "CUSTOMER_RECOGNIZED_MERCHANT"


# -- structured tool fields -----------------------------------------------------------------------

def test_escalate_case_gets_summary_and_evidence_refs_only_when_enabled():
    for structured in (True, False):
        gw = LocalGateway.demo(TODAY, outcomes={"propose_dispute_creation": "DENY"})
        agent, _, _, _, _ = make(ASTERIA, CONFIRM_DENY, gateway=gw, structured_tools=structured)
        agent.handle_turn("s", "customer_demo_001", "a")
        agent.handle_turn("s", "customer_demo_001", "b")
        (args,) = gw.names("escalate_case")
        if structured:
            assert args["reason"] == "POLICY_DENY" and "summary" in args and isinstance(args["evidenceRefs"], list)
        else:
            assert args["reason"].startswith("POLICY_DENY: ") and "summary" not in args and "evidenceRefs" not in args


# -- Scenario B -------------------------------------------------------------------------------------------

def test_scenario_b_cancellation_disputes_without_card_fraud_actions():
    agent, _, gw, mem, _ = make(ASTERIA, {"selection": "all", "canceled": True, "recognizes_merchant": True})
    agent.handle_turn("b", "customer_demo_001", "a")
    r = agent.handle_turn("b", "customer_demo_001", "I canceled last month")
    st = mem.load("b")
    assert r.status == "RESOLVED" and "cancellation" in r.text and "haven't blocked" in r.text
    assert st["classification"] == "RECURRING_PAYMENT_AFTER_CANCELLATION"
    assert gw.cases["case_local_1"]["claimType"] == "RECURRING_PAYMENT_AFTER_CANCELLATION"
    assert st["proposal"]["recommendedActions"] == ["CREATE_DISPUTE", "REQUEST_MERCHANT_EVIDENCE"]
    assert "merchant_cancellation_confirmation" in st["proposal"]["missingEvidence"]
    assert tools(gw).count("propose_dispute_creation") == 1
    assert not {"propose_provisional_credit", "propose_payment_block", "propose_card_replacement"} & set(tools(gw))


def test_scenario_b_blocks_future_payments_only_when_explicitly_requested():
    agent, _, gw, _, _ = make(ASTERIA, {"selection": "all", "canceled": True, "requested_block": True})
    agent.handle_turn("b", "customer_demo_001", "a")
    agent.handle_turn("b", "customer_demo_001", "cancelled, please stop future payments")
    assert gw.names("propose_payment_block")[0]["customerRequested"] is True


# -- Scenario E -------------------------------------------------------------------------------------------

def test_scenario_e_known_merchant_skips_research_and_verifies_customer_history():
    agent, _, gw, mem, research = make(ASTERIA, CONFIRM_DENY)
    agent.handle_turn("e", "customer_demo_001", "a")
    r = agent.handle_turn("e", "customer_demo_001", "b")
    st = mem.load("e")
    types = [e["type"] for e in st["evidence"]]
    assert research.calls == [] and {"INSTITUTIONAL_MEMORY", "CUSTOMER_MERCHANT_VERIFICATION"} <= set(types)
    memory = next(e for e in st["evidence"] if e["type"] == "INSTITUTIONAL_MEMORY")
    assert "12 prior bank cases" in memory["claim"] and "UNRECOGNIZED_RECURRING_SPIKE" in memory["claim"]
    assert memory["evidenceId"] in st["proposal"]["supportingEvidence"]
    assert gw.names("find_related_transactions")[0]["transactionId"] in st["confirmed_ids"]
    assert "1 other charge" in r.text   # the unreported $19.99 charge is raised proactively


# -- suggestions ---------------------------------------------------------------------------------------------

def test_suggestions_at_confirmation_claim_question_and_terminal_replies():
    agent, _, _, _, _ = make(ASTERIA, {"selection": "all"}, {"recognizes_merchant": False})
    r1 = agent.handle_turn("g", "customer_demo_001", "a")
    assert [s["postback"] for s in r1.suggestions] == ["Yes, confirm all", "I want to choose specific charges", "None of these"]
    assert all(set(s) == {"label", "postback"} for s in r1.suggestions)
    r2 = agent.handle_turn("g", "customer_demo_001", "b")
    assert r2.status == "AWAITING_CUSTOMER_INFORMATION" and len(r2.suggestions) == 3
    r3 = agent.handle_turn("g", "customer_demo_001", "c")
    assert r3.status == "RESOLVED" and r3.suggestions == []


def test_postbacks_round_trip_through_the_heuristic_model_and_reply_payload():
    m = HeuristicModel()
    assert m.analyze("", {}, "Yes, confirm all", "fast")["selection"] == "all"
    assert m.analyze("", {}, "None of these", "fast")["selection"] == "none"
    assert m.analyze("", {}, "I canceled this subscription", "fast")["canceled"] is True
    assert m.analyze("", {}, "I don't recognize this merchant", "fast")["recognizes_merchant"] is False
    agent, _, _, _, _ = make(ASTERIA, {"selection": "all", "canceled": True})
    msg = {"conversationId": "x", "customerId": "customer_demo_001", "message": "m"}
    assert _reply(agent, msg)["suggestions"][0]["label"]
    assert "suggestions" not in _reply(agent, msg)   # resolved: terminal payload carries none
