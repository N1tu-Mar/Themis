"""Compact Gateway-facing tools. Reply shape mirrors bank_tools: {"status": "ok"|"error", ...}."""
from typing import Any

from .service import MerchantIntel, iso

NOTICE = "Signals are context, not proof of fraud; customer-specific verification is still required."


def _err(code: str, message: str) -> dict[str, Any]:
    return {"status": "error", "error": {"code": code, "message": message}}


def resolve_merchant(intel: MerchantIntel, *, descriptor: str) -> dict[str, Any]:
    if not descriptor or not descriptor.strip():
        return _err("VALIDATION_ERROR", "descriptor required")
    r = intel.resolve(descriptor)
    if r["ambiguous"]:
        r["message"] = "ambiguous alias; do not pick a merchant, escalate for review"
    elif not r["resolved"]:
        r["message"] = "merchant identity unresolved"
    return {"status": "ok", **r}


def get_merchant_profile(intel: MerchantIntel, *, merchant_id: str, allow_research: bool = True) -> dict[str, Any]:
    r = intel.get_profile(merchant_id, allow_research=allow_research)
    if r is None:
        return _err("NOT_FOUND", f"no merchant profile for {merchant_id}")
    return {"status": "ok", **r, "requiresCustomerVerification": True}


def get_merchant_risk_signals(intel: MerchantIntel, *, merchant_id: str, include_expired: bool = False) -> dict[str, Any]:
    signals = intel.risk_signals(merchant_id, include_expired=include_expired)
    if signals is None:
        return _err("NOT_FOUND", f"no merchant profile for {merchant_id}")
    return {"status": "ok", "merchantId": merchant_id, "riskSignals": signals, "count": len(signals),
            "asOf": iso(intel.clock.now()), "fraudEstablished": False, "requiresCustomerVerification": True,
            "notice": NOTICE}
