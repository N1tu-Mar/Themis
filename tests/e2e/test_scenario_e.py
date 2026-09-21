"""Scenario E: two distinct customers hit the same merchant. The first case pays for research once (stale profile);
the second, after a cold restart, reuses the durable cache with zero research and its own customer verification."""
from datetime import UTC, datetime

from world import Config, World, reconcile_world

FIRST, SECOND = "customer_demo_005", "customer_demo_001"  # both have Asteria charges; 005 is the fixture's scenario-E customer
MERCHANT = "merchant_demo_001"


def verification(world, case_id):
    return [e for e in world.store.evidence_for_case(case_id) if e.type == "CUSTOMER_MERCHANT_VERIFICATION"]


def test_second_case_reuses_durable_cache_with_customer_specific_verification():
    w = World(config=Config(structured_tools=True))
    w.clock.t = datetime(2026, 9, 26, tzinfo=UTC)  # fixture profile (updated 09-17, 7-day TTL) is now stale
    first = w.chat(FIRST, "9.99 from ASTERIA SUB", "yes I don't recognize it")
    assert first.status == "RESOLVED" and w.researcher.calls == [MERCHANT]  # the one paid research call

    w.restart()  # new process: fresh merchant-intel, adapter, gateway, agent memory; same durable tables
    seen = w.researcher.calls[:]
    second = w.chat(SECOND, "9.99 from ASTERIA", "yes I don't recognize it")
    assert second.status == "RESOLVED" and second.case_id != first.case_id

    # durable cache reuse, zero second research call
    assert w.researcher.calls == seen == [MERCHANT] and w.research.calls == []
    profile = w.adapter.call("get_merchant_profile", {"merchantId": MERCHANT})
    assert profile["cache"]["status"] == "hit" and profile["cache"]["researchPerformed"] is False
    assert profile["cache"]["version"] == 2 and profile["cache"]["sourceSummary"] == "synthetic research"
    assert w.agent.memory.load(f"conv-{SECOND}")["metrics"]["cache_hits"] == 1
    assert w.gateway.names("get_merchant_profile")[0] == {"merchantId": MERCHANT}

    # a known-pattern merchant never substitutes for this customer's own ledger
    assert profile["requiresCustomerVerification"] is True
    (v1,), (v2,) = verification(w, first.case_id), verification(w, second.case_id)
    assert v1.claim != v2.claim
    for v, customer in ((v1, FIRST), (v2, SECOND)):
        assert v.transactionIds and {w.store.get_transaction(t).customerId for t in v.transactionIds} == {customer}
    assert "1 charge(s)" in v1.claim and "6 in this case" in v2.claim

    # cases stay separate and reconcile
    assert set(w.store.get_case(first.case_id).transactionIds).isdisjoint(w.store.get_case(second.case_id).transactionIds)
    assert reconcile_world(w, [first.case_id, second.case_id]) == {"cases": 2, "transactions": 7, "total": 69.93}


def test_fresh_fixture_profile_needs_no_research_at_all():
    w = World(config=Config(structured_tools=True))  # 2026-09-20: profile updated 09-17 is inside its TTL
    assert w.chat(FIRST, "9.99 from ASTERIA SUB", "yes I don't recognize it").status == "RESOLVED"
    assert w.researcher.calls == [] and w.research.calls == []
