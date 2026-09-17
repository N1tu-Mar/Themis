from bank_tools import tools
from bank_tools.models import MerchantProfile, MerchantRiskSignal


def test_resolve_merchant_by_exact_alias(store):
    result = tools.resolve_merchant(store, descriptor="ASTERIA.IO")
    assert result["resolved"] is True
    assert result["canonicalName"] == "Asteria Digital"


def test_resolve_merchant_normalizes_punctuation_and_case(store):
    result = tools.resolve_merchant(store, descriptor="asteria*premium")
    assert result["resolved"] is True
    assert result["merchantId"] == "merchant_asteria"


def test_resolve_merchant_unknown_descriptor_is_unresolved(store):
    result = tools.resolve_merchant(store, descriptor="totally unknown llc")
    assert result["resolved"] is False
    assert result["message"] == "merchant identity unresolved"


def test_get_merchant_profile_includes_billing_and_risk(store):
    result = tools.get_merchant_profile(store, merchant_id="merchant_asteria")
    assert result["profile"]["billingPatterns"][0]["amount"] == 9.99
    assert result["profile"]["riskSignals"][0]["type"] == "UNRECOGNIZED_RECURRING_SPIKE"


def test_get_merchant_risk_signals_excludes_expired_by_default(store):
    store.add_merchant_profile(MerchantProfile(
        merchantId="merchant_stale", canonicalName="Stale Co", aliases=[], billingPatterns=[],
        caseStatistics={"totalCases": 0, "resolvedCustomerDisputes": 0, "openCases": 0},
        riskSignals=[MerchantRiskSignal(
            type="OLD_SIGNAL", severity="LOW",
            observedAt="2020-01-01T00:00:00+00:00", expiresAt="2020-02-01T00:00:00+00:00", evidenceRefs=[],
        )],
        updatedAt="2020-02-01T00:00:00+00:00",
    ))
    assert tools.get_merchant_risk_signals(store, merchant_id="merchant_stale")["count"] == 0
    assert tools.get_merchant_risk_signals(store, merchant_id="merchant_stale", include_expired=True)["count"] == 1


def test_get_merchant_profile_not_found(store):
    result = tools.get_merchant_profile(store, merchant_id="merchant_missing")
    assert result["status"] == "error"
    assert result["error"]["code"] == "NOT_FOUND"
