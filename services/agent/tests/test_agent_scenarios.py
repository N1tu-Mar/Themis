import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

from orchestrator.config import Config
from orchestrator.engine import RETRY_MSG, Orchestrator
from orchestrator.local import InMemoryMemory, LocalGateway, ScriptedModel, StubResearch

TODAY = date(2026, 9, 20)
PROPOSE = ("propose_dispute_creation", "propose_payment_block", "propose_provisional_credit", "propose_card_replacement")


def make(*turns, gateway=None, memory=None, research=None, **cfg):
    gw = gateway or LocalGateway.demo(TODAY)
    model, memory, research = ScriptedModel(*turns), memory or InMemoryMemory(), research or StubResearch()
    agent = Orchestrator(model=model, gateway=gw, memory=memory, research=research, config=Config(**cfg), today=lambda: TODAY)
    return agent, model, gw, memory, research


def tools(gw):
    return [t for t, _ in gw.calls]


ASTERIA = {"hints": {"descriptor": "Asteria", "amount": 10}}
CONFIRM_DENY = {"selection": "all", "recognizes_merchant": False}


def test_scenario_a_unknown_recurring_merchant_resolves_with_cached_intel():
    agent, model, gw, mem, research = make(ASTERIA, CONFIRM_DENY)
    r1 = agent.handle_turn("conv", "customer_demo_001", "$10 weekly from Asteria")
    assert r1.status == "AWAITING_TRANSACTION_CONFIRMATION"
    assert "6 × $9.99" in r1.text and "$59.94" in r1.text and "Asteria Digital" in r1.text
    assert len(model.views[0]["candidates"]) == 0 and len(model.views) == 1   # model saw no ledger, one inference

    r2 = agent.handle_turn("conv", "customer_demo_001", "yes, I don't recognize it")
    assert (r2.status, r2.case_id) == ("RESOLVED", "case_local_1")
    st = mem.load("conv")
    assert st["classification"] == "RECURRING_PAYMENT_NOT_AUTHORIZED" and st["confidence"] >= 0.8
    assert st["model_turns"] == 2                          # one inference per customer turn
    assert st["proposal"]["recommendedActions"] == ["CREATE_DISPUTE", "REVIEW_FUTURE_RECURRING_PAYMENT"]
    assert research.calls == [] and st["metrics"]["cache_hits"] == 1   # cached merchant intel: no research
    assert tools(gw).count("generate_case_report") == 2 and "escalate_case" not in tools(gw)
    assert gw.names("search_transactions")[0]["descriptorContains"] == "Asteria"
    assert gw.names("propose_dispute_creation")[0]["hasConfirmedTransactions"] is True
    assert gw.cases["case_local_1"]["status"] == "RESOLVED"
    assert all("chain" not in json.dumps(e).lower() for e in st["evidence"])


def test_scenario_c_recognized_merchant_opens_no_dispute():
    agent, _, gw, mem, _ = make({"hints": {"descriptor": "Meadow"}}, {"selection": "all", "recognizes_merchant": True})
    agent.handle_turn("c", "customer_demo_003", "I don't know MEADOW SUB")
    r = agent.handle_turn("c", "customer_demo_003", "oh that's my Meadow subscription")
    st = mem.load("c")
    assert r.status == "RESOLVED" and st["outcome"] == "CUSTOMER_RECOGNIZED_MERCHANT"
    assert not any(t.startswith("propose_") for t in tools(gw))
    assert any(e["type"] == "CUSTOMER_RECOGNIZED_MERCHANT" for e in st["evidence"])


def test_scenario_d_conflicting_evidence_escalates_without_accusation():
    agent, _, gw, mem, _ = make({"hints": {"descriptor": "ASTDIGITAL"}}, {"selection": "all", "denies_authorization": True})
    agent.handle_turn("d", "customer_demo_004", "unauthorized charge from ASTDIGITAL")
    r = agent.handle_turn("d", "customer_demo_004", "yes, I never authorized it")
    st = mem.load("d")
    assert r.status == "NEEDS_HUMAN_REVIEW" and st["escalation"]["reason"] == "CONFLICTING_AUTHORIZATION_EVIDENCE"
    assert st["escalation"]["delivered"] and st["escalation"]["evidenceRefs"]
    assert "liar" not in r.text.lower() and "fraud" not in r.text.lower()
    assert not any(t in PROPOSE for t in tools(gw))
    assert "escalate_case" in tools(gw) and "generate_case_report" in tools(gw)
    assert any(e["category"] == "CONTRADICTORY_EVIDENCE" for e in st["evidence"])


def test_transitions_follow_the_conversational_progression():
    agent, _, _, mem, _ = make(ASTERIA, CONFIRM_DENY)
    agent.handle_turn("t", "customer_demo_001", "x")
    agent.handle_turn("t", "customer_demo_001", "y")
    assert mem.load("t")["history"] == [
        "NEW", "INTAKE", "TRANSACTION_MATCHING", "AWAITING_TRANSACTION_CONFIRMATION", "CLASSIFYING_DISPUTE",
        "INVESTIGATING", "RESOLUTION_PROPOSED", "POLICY_REVIEW", "ACTION_APPROVED", "RESOLVED",
    ]


def test_asks_for_missing_details_then_escalates_when_matching_stays_uncertain():
    agent, _, _, _, _ = make({}, {"hints": {"descriptor": "Nope"}}, {"hints": {"descriptor": "Nada"}})
    assert agent.handle_turn("m", "customer_demo_001", "hi").status == "AWAITING_CUSTOMER_INFORMATION"
    assert agent.handle_turn("m", "customer_demo_001", "Nope").status == "AWAITING_CUSTOMER_INFORMATION"
    r = agent.handle_turn("m", "customer_demo_001", "Nada")
    assert r.status == "NEEDS_HUMAN_REVIEW"


def test_rejected_matches_rematch_with_new_details_and_invented_ids_are_ignored():
    agent, _, _, mem, _ = make(ASTERIA, {"selection": "none", "hints": {"descriptor": "ASTERIA", "amount": 19.99}},
                               {"selection": ["nope"]}, {"selection": ["txn_a_other"], "denies_authorization": True})
    agent.handle_turn("r", "customer_demo_001", "a")
    r = agent.handle_turn("r", "customer_demo_001", "b")
    assert "1 × $19.99" in r.text
    assert agent.handle_turn("r", "customer_demo_001", "c").status == "AWAITING_TRANSACTION_CONFIRMATION"   # invented id -> re-ask
    assert mem.load("r")["candidates"][0]["id"] == "txn_a_other"


def test_asks_claim_question_when_customer_has_not_said():
    agent, _, _, _, _ = make(ASTERIA, {"selection": "all"}, {"recognizes_merchant": False})
    agent.handle_turn("q", "customer_demo_001", "a")
    r = agent.handle_turn("q", "customer_demo_001", "b")
    assert r.status == "AWAITING_CUSTOMER_INFORMATION" and "recognize" in r.text
    assert agent.handle_turn("q", "customer_demo_001", "c").status == "RESOLVED"


def test_cancellation_is_not_classified_as_stolen_card():
    agent, _, _, mem, _ = make(ASTERIA, {"selection": "all", "canceled": True})
    agent.handle_turn("k", "customer_demo_001", "a")
    agent.handle_turn("k", "customer_demo_001", "I canceled last month")
    assert mem.load("k")["classification"] == "RECURRING_PAYMENT_AFTER_CANCELLATION"


# -- failures, budgets, policy -------------------------------------------------

def test_model_failure_preserves_state_and_asks_to_retry():
    agent, _, _, mem, _ = make(ASTERIA, RuntimeError("bedrock down"), CONFIRM_DENY)
    agent.handle_turn("f", "customer_demo_001", "a")
    before = mem.load("f")
    r = agent.handle_turn("f", "customer_demo_001", "b")
    assert r.text == RETRY_MSG and mem.load("f")["status"] == before["status"] == "AWAITING_TRANSACTION_CONFIRMATION"
    assert mem.load("f")["model_turns"] == 1
    assert agent.handle_turn("f", "customer_demo_001", "b").status == "RESOLVED"


def test_search_failure_retries_once_then_preserves_state():
    gw = LocalGateway.demo(TODAY, fail={"search_transactions": 2})
    agent, _, _, mem, _ = make(ASTERIA, gateway=gw)
    r = agent.handle_turn("s", "customer_demo_001", "a")
    assert r.text == RETRY_MSG and tools(gw).count("search_transactions") == 2 and r.case_id is None


def test_transient_tool_failure_is_retried_transparently():
    gw = LocalGateway.demo(TODAY, fail={"create_case": 1})
    agent, _, _, _, _ = make(ASTERIA, CONFIRM_DENY, gateway=gw)
    agent.handle_turn("x", "customer_demo_001", "a")
    assert agent.handle_turn("x", "customer_demo_001", "b").status == "RESOLVED"


def test_enrichment_failure_degrades_but_case_survives():
    gw = LocalGateway.demo(TODAY, fail={"get_merchant_risk_signals": 9, "save_evidence": 99, "get_customer_dispute_history": 9})
    agent, _, _, mem, _ = make(ASTERIA, CONFIRM_DENY, gateway=gw)
    agent.handle_turn("e", "customer_demo_001", "a")
    r = agent.handle_turn("e", "customer_demo_001", "b")
    assert r.status == "RESOLVED" and mem.load("e")["evidence"]          # evidence kept in state even if persistence failed


def test_required_tool_failure_after_case_exists_escalates():
    gw = LocalGateway.demo(TODAY, fail={"propose_dispute_creation": 9})
    agent, _, _, mem, _ = make(ASTERIA, CONFIRM_DENY, gateway=gw)
    agent.handle_turn("p", "customer_demo_001", "a")
    r = agent.handle_turn("p", "customer_demo_001", "b")
    assert r.status == "NEEDS_HUMAN_REVIEW" and mem.load("p")["escalation"]["reason"] == "TOOL_FAILURE"


def test_undelivered_escalation_is_retried_on_next_turn():
    gw = LocalGateway.demo(TODAY, fail={"propose_dispute_creation": 9, "escalate_case": 2})
    agent, _, _, mem, _ = make(ASTERIA, CONFIRM_DENY, gateway=gw)
    agent.handle_turn("u", "customer_demo_001", "a")
    agent.handle_turn("u", "customer_demo_001", "b")
    assert mem.load("u")["escalation"]["delivered"] is False
    agent.handle_turn("u", "customer_demo_001", "hello?")
    assert mem.load("u")["escalation"]["delivered"] is True


def test_policy_denial_escalates_instead_of_bypassing():
    for outcome in ("DENY", "REQUIRE_HUMAN_REVIEW"):
        gw = LocalGateway.demo(TODAY, outcomes={"propose_dispute_creation": outcome})
        agent, _, _, mem, _ = make(ASTERIA, CONFIRM_DENY, gateway=gw)
        agent.handle_turn("d", "customer_demo_001", "a")
        r = agent.handle_turn("d", "customer_demo_001", "b")
        assert r.status == "NEEDS_HUMAN_REVIEW" and mem.load("d")["escalation"]["reason"] == f"POLICY_{outcome}"
        assert "escalate_case" in tools(gw)


def test_malformed_policy_reply_fails_closed():
    gw = LocalGateway.demo(TODAY)
    gw.t_propose_dispute_creation = lambda **_: {"status": "ok"}
    agent, _, _, mem, _ = make(ASTERIA, CONFIRM_DENY, gateway=gw)
    agent.handle_turn("z", "customer_demo_001", "a")
    assert agent.handle_turn("z", "customer_demo_001", "b").status == "NEEDS_HUMAN_REVIEW"


def test_customer_requested_block_is_proposed_only_with_explicit_request():
    agent, _, gw, _, _ = make(ASTERIA, {**CONFIRM_DENY, "requested_block": True})
    agent.handle_turn("b", "customer_demo_001", "a")
    agent.handle_turn("b", "customer_demo_001", "b")
    assert gw.names("propose_payment_block")[0]["customerRequested"] is True
    agent, _, gw, _, _ = make(ASTERIA, CONFIRM_DENY)
    agent.handle_turn("b", "customer_demo_001", "a")
    agent.handle_turn("b", "customer_demo_001", "b")
    assert gw.names("propose_payment_block") == []


def test_model_turn_budget_escalates_without_another_inference():
    agent, model, _, mem, _ = make(ASTERIA, CONFIRM_DENY, max_model_turns=1)
    agent.handle_turn("bud", "customer_demo_001", "a")
    r = agent.handle_turn("bud", "customer_demo_001", "b")
    assert r.status == "NEEDS_HUMAN_REVIEW" and len(model.views) == 1
    assert mem.load("bud")["escalation"]["reason"] == "INVESTIGATION_BUDGET_EXCEEDED"


def test_candidate_and_history_budgets_are_passed_through():
    agent, _, gw, _, _ = make(ASTERIA, CONFIRM_DENY, max_candidates=3)
    agent.handle_turn("cb", "customer_demo_001", "a")
    agent.handle_turn("cb", "customer_demo_001", "b")
    assert gw.names("create_case")[0]["transactionIds"] == ["txn_a0", "txn_a1", "txn_a2"]
    assert gw.names("get_customer_dispute_history")[0]["limit"] == 5
    assert len(gw.names("get_transaction_auth_signals")) == 3


def uncached_gateway():
    gw = LocalGateway.demo(TODAY)
    gw.profiles["merchant_demo_001"] = {"merchantId": "merchant_demo_001", "canonicalName": "Asteria Digital", "caseStatistics": {"totalCases": 0}, "riskSignals": []}
    return gw


def test_uncached_merchant_research_runs_once_within_page_budget():
    research = StubResearch({"summary": "Asteria sells a weekly digital subscription.", "pages": 2})
    agent, _, _, mem, research = make(ASTERIA, CONFIRM_DENY, gateway=uncached_gateway(), research=research, browser_research=True, escalation_confidence=0.5)
    agent.handle_turn("rs", "customer_demo_001", "a")
    agent.handle_turn("rs", "customer_demo_001", "b")
    st = mem.load("rs")
    assert research.calls == [("Asteria Digital", 5)] and st["research_calls"] == 1 and st["metrics"]["cache_misses"] == 1
    assert any(e["category"] == "EXTERNAL_MERCHANT_INTELLIGENCE" for e in st["evidence"])


def test_uncached_merchant_without_research_is_missing_evidence_and_escalates_on_low_confidence():
    agent, _, _, mem, research = make(ASTERIA, CONFIRM_DENY, gateway=uncached_gateway())
    agent.handle_turn("nr", "customer_demo_001", "a")
    r = agent.handle_turn("nr", "customer_demo_001", "b")
    st = mem.load("nr")
    assert research.calls == [] and r.status == "NEEDS_HUMAN_REVIEW" and st["escalation"]["reason"] == "LOW_CONFIDENCE"
    assert any(e["category"] == "MISSING_EVIDENCE" for e in st["evidence"])


def test_browser_failure_is_survivable():
    class Boom:
        def research(self, *a):
            raise TimeoutError

    agent, _, _, mem, _ = make(ASTERIA, CONFIRM_DENY, gateway=uncached_gateway(), research=Boom(), browser_research=True, escalation_confidence=0.3)
    agent.handle_turn("bf", "customer_demo_001", "a")
    assert agent.handle_turn("bf", "customer_demo_001", "b").status == "RESOLVED"


def test_second_agent_instance_resumes_from_structured_memory_not_chat():
    memory = InMemoryMemory()
    a1, *_ = make(ASTERIA, memory=memory)
    a1.handle_turn("resume", "customer_demo_001", "a")
    a2, model2, *_ = make(CONFIRM_DENY, memory=memory)
    assert a2.handle_turn("resume", "customer_demo_001", "b").status == "RESOLVED"
    assert model2.views[0]["status"] == "AWAITING_TRANSACTION_CONFIRMATION" and len(model2.views[0]["candidates"]) == 6


def test_model_tier_is_fast_by_default_and_reasoning_when_confidence_is_low():
    agent, model, _, mem, _ = make(ASTERIA, {"selection": "all"})
    agent.handle_turn("tier", "customer_demo_001", "a")
    st = mem.load("tier")
    st["confidence"] = 0.4
    mem.save("tier", st)
    agent.handle_turn("tier", "customer_demo_001", "b")
    assert model.tiers == ["fast", "reasoning"]


# -- entry point ---------------------------------------------------------------

MAIN = Path(__file__).resolve().parents[1] / "src" / "orchestrator" / "main.py"


def run_main(stdin: str):
    env = {**os.environ, "THEMIS_MODE": "local"}
    return subprocess.run([sys.executable, str(MAIN)], input=stdin, capture_output=True, text=True, env=env, cwd=MAIN.parents[2], timeout=30)


def test_main_starts_in_local_mode():
    p = run_main("")
    assert p.returncode == 0 and "ready (local)" in p.stderr


def test_main_local_conversation_over_stdin():
    p = run_main(json.dumps({"conversationId": "m1", "customerId": "customer_demo_001", "message": "about $10 from Asteria"}) + "\n")
    out = json.loads(p.stdout.splitlines()[0])
    assert p.returncode == 0 and out["status"] == "AWAITING_TRANSACTION_CONFIRMATION" and "Asteria Digital" in out["reply"]
