"""Local/mock implementations of every interface. Used by tests and THEMIS_MODE=local; no network, no AWS."""
from __future__ import annotations

import copy
import re
from datetime import date, timedelta
from typing import Any


class InMemoryMemory:
    def __init__(self, records: list[str] | None = None):
        self.states: dict[str, dict[str, Any]] = {}
        self.records = records or []

    def load(self, conversation_id: str) -> dict[str, Any] | None:
        s = self.states.get(conversation_id)
        return copy.deepcopy(s) if s else None

    def save(self, conversation_id: str, state: dict[str, Any]) -> None:
        self.states[conversation_id] = copy.deepcopy(state)

    def recall(self, query: str, limit: int) -> list[str]:
        return [r for r in self.records if query.lower() in r.lower()][:limit]


class StubResearch:
    """Returns canned findings (or None = unavailable) and counts calls."""
    def __init__(self, result: dict[str, Any] | None = None):
        self.result, self.calls = result, []

    def research(self, descriptor: str, max_pages: int) -> dict[str, Any] | None:
        self.calls.append((descriptor, max_pages))
        return self.result


class ScriptedModel:
    """Replays one canned analysis per turn and records what the model was shown."""
    def __init__(self, *turns: dict[str, Any] | Exception):
        self.turns, self.views, self.tiers = list(turns), [], []

    def analyze(self, system: str, view: dict[str, Any], message: str, tier: str) -> dict[str, Any]:
        self.views.append(copy.deepcopy(view))
        self.tiers.append(tier)
        turn = self.turns.pop(0)
        if isinstance(turn, Exception):
            raise turn
        return turn


class HeuristicModel:
    """Keyword extractor so THEMIS_MODE=local is usable by hand without Bedrock."""
    def analyze(self, system: str, view: dict[str, Any], message: str, tier: str) -> dict[str, Any]:
        m, out = message.lower(), {}
        hints = {}
        if (amt := re.search(r"\$?(\d+(?:\.\d+)?)", m)):
            hints["amount"] = float(amt.group(1))
        if (d := re.search(r"\b(?:from|by|at)\s+([a-z][\w.*-]+)", m)):
            hints["descriptor"] = d.group(1)
        if hints:
            out["hints"] = hints
        if re.search(r"\b(none|not these|no)\b", m):
            out["selection"] = "none"
        elif re.search(r"\b(yes|confirm|all|correct)\b", m):
            out["selection"] = "all"
        if re.search(r"(don'?t|do not) recognize|unfamiliar|never heard", m):
            out["recognizes_merchant"] = False
        elif re.search(r"\b(recognize|remember|my subscription)\b", m):
            out["recognizes_merchant"] = True
        if "cancel" in m:
            out["canceled"] = True
        if re.search(r"didn'?t authorize|unauthorized|not me|fraud", m):
            out["denies_authorization"] = True
        if re.search(r"\b(block|stop future)\b", m):
            out["requested_block"] = True
        return out


def _txn(tid, customer, merchant, descriptor, amount, day, **signals):
    return {"id": tid, "customerId": customer, "merchantId": merchant, "merchantDescriptor": descriptor,
            "amount": amount, "date": day.isoformat(), "recurring": bool(signals.get("recurring_indicator")), "authSignals": signals}


class LocalGateway:
    """In-memory stand-in for the Gateway's 20 tools (same names, camelCase args, {"status": ...} replies).

    `fail={"tool": n}` makes a tool error n times; `outcomes={"tool": "DENY"}` overrides a propose_* decision.
    The mock policy below only exists so local runs behave; the real gate is server-side.
    """
    def __init__(self, transactions=(), merchants=(), profiles=None, fail=None, outcomes=None):
        self.transactions = list(transactions)
        self.merchants = {m["merchantId"]: m for m in merchants}
        self.profiles = dict(profiles or {})
        self.fail, self.outcomes = dict(fail or {}), dict(outcomes or {})
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.cases: dict[str, dict[str, Any]] = {}
        self._seen: dict[str, dict[str, Any]] = {}

    @classmethod
    def demo(cls, today: date | None = None, **kw: Any) -> "LocalGateway":
        today = today or date.today()
        weekly = [today - timedelta(days=7 * i + 3) for i in range(6)]
        txns = [_txn(f"txn_a{i}", "customer_demo_001", "merchant_demo_001", "ASTERIA.IO", 9.99, d, recurring_indicator=True, prior_merchant_relationship=False)
                for i, d in enumerate(weekly)]
        txns += [
            _txn("txn_a_other", "customer_demo_001", "merchant_demo_001", "ASTERIA.IO", 19.99, today - timedelta(days=10), recurring_indicator=False),
            _txn("txn_c1", "customer_demo_003", "merchant_demo_002", "MEADOW SUB", 12.99, today - timedelta(days=5),
                 recurring_indicator=True, prior_merchant_relationship=True),
            _txn("txn_d1", "customer_demo_004", "merchant_demo_001", "ASTDIGITAL", 49.99, today - timedelta(days=4), card_present=True,
                 recurring_indicator=False, cvv_match=True, avs_match=True, **{"3ds_status": "AUTHENTICATED"}),
        ]
        merchants = [
            {"merchantId": "merchant_demo_001", "canonicalName": "Asteria Digital", "aliases": ["ASTERIA.IO", "ASTDIGITAL"]},
            {"merchantId": "merchant_demo_002", "canonicalName": "Meadow Studio", "aliases": ["MEADOW SUB"]},
        ]
        profiles = {"merchant_demo_001": {"merchantId": "merchant_demo_001", "canonicalName": "Asteria Digital",
                                          "caseStatistics": {"totalCases": 12}, "riskSignals": [{"type": "UNRECOGNIZED_RECURRING_SPIKE"}]},
                    "merchant_demo_002": {"merchantId": "merchant_demo_002", "canonicalName": "Meadow Studio", "caseStatistics": {"totalCases": 0}, "riskSignals": []}}
        return cls(txns, merchants, profiles, **kw)

    def call(self, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((tool, dict(arguments)))
        if self.fail.get(tool, 0) > 0:
            self.fail[tool] -= 1
            return {"status": "error", "error": {"code": "UNAVAILABLE", "message": "mock failure"}}
        handler = getattr(self, f"t_{tool}", None)
        if handler is None:
            return {"status": "error", "error": {"code": "UNKNOWN_TOOL", "message": tool}}
        key = arguments.get("idempotencyKey")
        if key and (tool, key) in self._seen:
            return self._seen[(tool, key)]
        result = handler(**arguments)
        if key:
            self._seen[(tool, key)] = result
        return result

    def names(self, tool: str) -> list[dict[str, Any]]:
        return [a for t, a in self.calls if t == tool]

    # -- reads ------------------------------------------------------------------
    def t_search_transactions(self, customerId, descriptorContains=None, since=None, minAmount=None, maxAmount=None, limit=50, **_):
        rows = [t for t in self.transactions if t["customerId"] == customerId
                and (not descriptorContains or descriptorContains.lower() in t["merchantDescriptor"].lower())
                and (not since or t["date"] >= since)
                and (minAmount is None or t["amount"] >= minAmount) and (maxAmount is None or t["amount"] <= maxAmount)][:limit]
        return {"status": "ok", "transactions": [{k: r[k] for k in ("id", "merchantDescriptor", "amount", "date", "recurring")} for r in rows],
                "count": len(rows), "total": round(sum(r["amount"] for r in rows), 2)}

    def t_get_transaction_auth_signals(self, transactionId, **_):
        t = next((t for t in self.transactions if t["id"] == transactionId), None)
        return {"status": "ok", "transactionId": transactionId, "authSignals": t["authSignals"]} if t else _err("NOT_FOUND")

    def t_resolve_merchant(self, descriptor, **_):
        for m in self.merchants.values():
            if descriptor.lower() in [a.lower() for a in m["aliases"]] + [m["canonicalName"].lower()]:
                return {"status": "ok", "resolved": True, "merchantId": m["merchantId"], "canonicalName": m["canonicalName"]}
        return {"status": "ok", "resolved": False, "merchantId": None, "canonicalName": None}

    def t_get_merchant_profile(self, merchantId, **_):
        p = self.profiles.get(merchantId)
        return {"status": "ok", "profile": p} if p else _err("NOT_FOUND")

    def t_get_merchant_risk_signals(self, merchantId, **_):
        p = self.profiles.get(merchantId)
        return {"status": "ok", "merchantId": merchantId, "riskSignals": p["riskSignals"], "count": len(p["riskSignals"])} if p else _err("NOT_FOUND")

    def t_find_related_transactions(self, transactionId, limit=20, **_):
        seed = next((t for t in self.transactions if t["id"] == transactionId), None)
        if seed is None:
            return _err("NOT_FOUND")
        rows = [t for t in self.transactions if t["customerId"] == seed["customerId"] and t["merchantId"] == seed["merchantId"]][:limit]
        return {"status": "ok", "seedTransactionId": transactionId, "count": len(rows),
                "transactions": [{k: r[k] for k in ("id", "merchantDescriptor", "amount", "date", "recurring")} for r in rows]}

    def t_get_case(self, caseId, **_):
        return {"status": "ok", "case": self.cases[caseId]} if caseId in self.cases else _err("NOT_FOUND")

    def t_get_customer_dispute_history(self, customerId, limit=20, **_):
        cases = [c for c in self.cases.values() if c["customerId"] == customerId][:limit]
        return {"status": "ok", "cases": cases, "count": len(cases)}

    # -- writes -----------------------------------------------------------------
    def t_create_case(self, customerId, claimType, transactionIds=(), merchantId=None, **_):
        cid = f"case_local_{len(self.cases) + 1}"
        self.cases[cid] = {"caseId": cid, "customerId": customerId, "status": "NEW", "claimType": claimType,
                           "merchantId": merchantId, "transactionIds": list(transactionIds)}
        return {"status": "ok", "case": self.cases[cid]}

    def t_update_case(self, caseId, **fields):
        self.cases[caseId].update({k: v for k, v in fields.items() if k != "idempotencyKey"})
        return {"status": "ok", "case": self.cases[caseId]}

    def t_save_evidence(self, caseId, **_):
        return {"status": "ok"}

    def t_generate_case_report(self, caseId, **_):
        return {"status": "ok", "reportId": f"report_{caseId}"}

    def t_escalate_case(self, caseId, reason, **_):
        self.cases[caseId]["status"] = "NEEDS_HUMAN_REVIEW"
        return {"status": "ok", "reason": reason}

    def _decide(self, tool, allow):
        outcome = self.outcomes.get(tool, "ALLOW" if allow else "REQUIRE_HUMAN_REVIEW")
        return {"status": "ok", "decision": {"outcome": outcome}}

    def t_propose_dispute_creation(self, hasConfirmedTransactions, **_):
        return self._decide("propose_dispute_creation", hasConfirmedTransactions)

    def t_propose_payment_block(self, customerRequested, **_):
        return self._decide("propose_payment_block", customerRequested)

    def t_propose_provisional_credit(self, amount, confidence, **_):
        return self._decide("propose_provisional_credit", amount <= 50 and confidence >= 0.8)

    def t_propose_card_replacement(self, **_):
        return self._decide("propose_card_replacement", False)


def _err(code: str) -> dict[str, Any]:
    return {"status": "error", "error": {"code": code, "message": code}}
