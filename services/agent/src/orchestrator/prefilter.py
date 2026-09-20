"""Deterministic transaction prefilter: code narrows thousands of rows to <=20 before the model sees any."""
from __future__ import annotations

import re
from datetime import date, timedelta
from difflib import SequenceMatcher
from typing import Any

AMOUNT_TOLERANCE = 0.15   # "around $10" matches 9.99 but not 19.99
MIN_AMOUNT_SLACK = 1.0


def amount_bounds(amount: float) -> tuple[float, float]:
    slack = max(MIN_AMOUNT_SLACK, amount * AMOUNT_TOLERANCE)
    return round(max(0.0, amount - slack), 2), round(amount + slack, 2)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _descriptor_matches(hint: str, descriptor: str) -> bool:
    h, d = _norm(hint), _norm(descriptor)
    if not h or not d:
        return False
    return h in d or d in h or SequenceMatcher(None, h, d).ratio() >= 0.7


def prefilter(
    transactions: list[dict[str, Any]], hints: dict[str, Any], *, today: date,
    window_days: int = 90, max_candidates: int = 20,
) -> list[dict[str, Any]]:
    """Return compact candidates (newest first) matching the customer's hints. No hints -> nothing."""
    descriptor, amount = hints.get("descriptor"), hints.get("amount")
    if not descriptor and amount is None:
        return []
    cutoff = (today - timedelta(days=window_days)).isoformat()
    out = []
    for t in transactions:
        if t["date"] < cutoff:
            continue
        if descriptor and not _descriptor_matches(descriptor, t["merchantDescriptor"]):
            continue
        if amount is not None:
            low, high = amount_bounds(float(amount))
            if not low <= t["amount"] <= high:
                continue
        out.append({k: t[k] for k in ("id", "merchantDescriptor", "amount", "date", "recurring")})
    out.sort(key=lambda t: t["date"], reverse=True)
    return out[:max_candidates]
