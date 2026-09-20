import copy
from datetime import timedelta

import pytest

from intel_fakes import FakeResearcher, ROOT, load
from merchant_intel import ContractError, InMemoryProfileStore, MerchantIntel, normalize, tools, validate

A = "merchant_demo_001"


def test_normalize_and_alias_resolution(intel):
    assert normalize(" asteria*premium ") == "ASTERIA PREMIUM"
    r = tools.resolve_merchant(intel, descriptor="asteria*premium")
    assert (r["status"], r["merchantId"], r["canonicalName"]) == ("ok", A, "Asteria Digital")
    assert tools.resolve_merchant(intel, descriptor="ASTERIA SUB 8005550100")["merchantId"] == A  # trailing junk
    assert tools.resolve_merchant(intel, descriptor="ASTER")["resolved"] is False  # no partial-word match
    assert tools.resolve_merchant(intel, descriptor="")["status"] == "error"


def test_every_committed_alias_resolves_to_its_merchant(intel):
    for p in load("demo-profiles.json"):
        for a in p["aliases"]:
            assert intel.resolve(a)["merchantId"] == p["merchantId"]


def test_ambiguous_alias_is_not_resolved(clock):
    i = MerchantIntel(InMemoryProfileStore(), clock=clock)
    base = load("demo-profiles.json")[0]
    other = {**copy.deepcopy(base), "merchantId": "m_other", "canonicalName": "Other Co", "aliases": ["ASTERIA.IO"]}
    i.load_profiles([base, other])
    r = tools.resolve_merchant(i, descriptor="ASTERIA.IO")
    assert r["resolved"] is False and r["ambiguous"] is True and r["merchantId"] is None
    assert [c["merchantId"] for c in r["candidates"]] == sorted([A, "m_other"])


def test_cache_hit_skips_research(intel, researcher):
    r = tools.get_merchant_profile(intel, merchant_id=A)
    assert r["cache"]["status"] == "hit" and not r["cache"]["researchPerformed"]
    assert researcher.calls == []
    validate("MerchantProfile", r["profile"])


def test_expiry_is_deterministic_and_triggers_one_research(intel, clock, researcher):
    clock.advance(days=4)  # updatedAt 09-17T20:00Z + 7d = 09-24T20:00Z; now 09-24T12:00Z
    assert tools.get_merchant_profile(intel, merchant_id=A)["cache"]["status"] == "hit"
    clock.advance(hours=8)  # exactly expiry -> expired
    r = tools.get_merchant_profile(intel, merchant_id=A)
    assert r["cache"]["status"] == "expired" and r["cache"]["researchPerformed"] and r["cache"]["version"] == 2
    assert researcher.calls == [A]
    assert tools.get_merchant_profile(intel, merchant_id=A)["cache"]["status"] == "hit"  # refreshed
    assert researcher.calls == [A]


def test_custom_ttl(clock):
    i = MerchantIntel(InMemoryProfileStore(), clock=clock, ttl=timedelta(days=1))
    i.load_profiles(load("demo-profiles.json"))
    assert i.get_profile(A)["cache"]["status"] == "expired"  # 3 days old, no researcher -> stale, flagged
    assert i.get_profile(A)["cache"]["stale"] is True


def test_miss_and_unknown_never_research(intel, researcher):
    assert tools.get_merchant_profile(intel, merchant_id="nope")["error"]["code"] == "NOT_FOUND"
    assert researcher.calls == []


def test_research_failure_degrades_to_stale(clock):
    r = FakeResearcher(fail=True)
    i = MerchantIntel(InMemoryProfileStore(), clock=clock, researcher=r, ttl=timedelta(days=1))
    i.load_profiles(load("demo-profiles.json"))
    out = tools.get_merchant_profile(i, merchant_id=A)
    assert out["status"] == "ok" and out["cache"]["stale"] and "browser down" in out["cache"]["researchError"]


def test_research_merge_keeps_prior_data_and_requires_evidence(clock):
    r = FakeResearcher({"sourceSummary": "web", "aliases": ["ASTERIA NEW", "asteria.io"], "riskSignals": [
        {"type": "PUBLIC_COMPLAINTS", "severity": "HIGH", "evidenceRefs": ["src_1"]},
        {"type": "NO_EVIDENCE", "severity": "HIGH", "evidenceRefs": []}]})
    i = MerchantIntel(InMemoryProfileStore(), clock=clock, researcher=r, ttl=timedelta(days=1))
    i.load_profiles(load("demo-profiles.json"))
    p = i.get_profile(A)["profile"]
    assert p["aliases"][-1] == "ASTERIA NEW" and len(p["aliases"]) == 5  # dedup is normalized
    assert [s["type"] for s in p["riskSignals"]] == ["UNRECOGNIZED_RECURRING_SPIKE", "PUBLIC_COMPLAINTS"]
    assert p["caseStatistics"]["totalCases"] == 12 and p["billingPatterns"] == [{"amount": 9.99, "cadenceDays": 7}]


def test_risk_signals_decay_expire_and_never_prove_fraud(intel, clock):
    r = tools.get_merchant_risk_signals(intel, merchant_id=A)
    s = r["riskSignals"][0]  # 2026-07-19 -> 10-17, now 09-20: ~0.36 left
    assert s["evidenceRefs"] and s["observedAt"] and s["expiresAt"]
    assert s["severity"] == "ELEVATED" and s["effectiveSeverity"] == "LOW" and 0 < s["weight"] < 0.5
    assert r["fraudEstablished"] is False and r["requiresCustomerVerification"] is True
    clock.advance(days=40)
    assert tools.get_merchant_risk_signals(intel, merchant_id=A)["count"] == 0
    old = tools.get_merchant_risk_signals(intel, merchant_id=A, include_expired=True)["riskSignals"][0]
    assert old["expired"] and old["weight"] == 0


def test_record_case_updates_stats_without_losing_profile(intel):
    before = copy.deepcopy(intel.get_profile(A)["profile"])
    intel.record_case(A, "c1", status="OPEN")
    p = intel.record_case(A, "c1", status="RESOLVED", dispute_confirmed=True,
                          signal={"type": "CONFIRMED_DISPUTE", "severity": "LOW", "evidenceRefs": ["ev_c1"]})
    assert p["caseStatistics"] == {"totalCases": 13, "resolvedCustomerDisputes": 9, "openCases": 4}
    for k in ("aliases", "billingPatterns", "canonicalName"):
        assert p[k] == before[k]
    assert p["riskSignals"][0] == before["riskSignals"][0] and len(p["riskSignals"]) == 2
    again = intel.record_case(A, "c1", status="RESOLVED", dispute_confirmed=True)  # idempotent
    assert again["caseStatistics"] == p["caseStatistics"]
    validate("MerchantProfile", again)
    assert intel.record_case("nope", "c", status="OPEN") is None
    with pytest.raises(ValueError):
        intel.record_case(A, "c2", status="MAYBE")


def test_scenario_e_institutional_memory(intel, researcher):
    """Asteria already profiled: resolve from profile, cached intel, zero research, verification still required."""
    r = tools.resolve_merchant(intel, descriptor="ASTERIA SUB")  # txn_demo_0012 descriptor
    assert r["merchantId"] == A
    prof = tools.get_merchant_profile(intel, merchant_id=r["merchantId"])
    sig = tools.get_merchant_risk_signals(intel, merchant_id=r["merchantId"])
    assert prof["cache"]["status"] == "hit" and prof["cache"]["researchPerformed"] is False
    assert researcher.calls == []  # no duplicate research call
    assert prof["requiresCustomerVerification"] and sig["requiresCustomerVerification"]
    assert not sig["fraudEstablished"]


def test_contract_validator_rejects_bad_profiles():
    bad = load("demo-profiles.json")[0] | {"extra": 1}
    with pytest.raises(ContractError):
        validate("MerchantProfile", bad)
    bad = copy.deepcopy(load("demo-profiles.json")[0])
    bad["riskSignals"][0]["severity"] = "CRITICAL"
    with pytest.raises(ContractError):
        validate("MerchantProfile", bad)


def test_committed_fixtures_are_contract_compatible():
    for name in ("demo-profiles.json", "profiles.json"):
        for p in load(name):
            validate("MerchantProfile", p)
    for name in ("demo.json", "merchants.json"):
        for m in load(name):
            validate("Merchant", m)
    assert ROOT.joinpath("fixtures/scenarios.json").exists()
