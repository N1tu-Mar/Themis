"""Deterministic no-network Themis world: real orchestrator + tools adapter + Cedar text + bank-tools/merchant-intel
over an in-process DynamoDB fake. Shared by scripts/demo/* and tests/e2e/*. Fixed clock/today; only case ids vary."""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
for _p in ("tests/integration", "services/bank-tools/tests"):
    sys.path.insert(0, str(ROOT / _p))

import harness  # noqa: E402  (also puts the service packages + tools-adapter on sys.path)
from bank_tools.dynamo_store import DynamoBankToolsStore, from_attr  # noqa: E402
from bank_tools.fixtures import load_demo_store  # noqa: E402
from dynamo_profile_store import DynamoProfileStore  # noqa: E402
from fake_dynamo import TABLES, FakeDynamo  # noqa: E402
from merchant_intel import MerchantIntel  # noqa: E402
from orchestrator.config import Config  # noqa: E402
from orchestrator.engine import Orchestrator  # noqa: E402
from orchestrator.local import HeuristicModel, InMemoryMemory, StubResearch  # noqa: E402
from orchestrator.workflow import MemoryReportStore  # noqa: E402
from router import ToolAdapter  # noqa: E402

TODAY = date(2026, 9, 20)
NOW = datetime(2026, 9, 20, 14, 0, tzinfo=UTC)
MUTATING = ("create_case", "update_case", "save_evidence", "propose_payment_block", "propose_card_replacement",
            "propose_dispute_creation", "propose_provisional_credit", "generate_case_report", "escalate_case",
            "send_customer_message", "send_case_email")
PROFILES = ROOT / "fixtures/merchants/demo-profiles.json"


class DemoDynamo(FakeDynamo):
    """bank-tools' fake plus the two calls seeding/reset/profile-store need."""
    def scan(self, TableName, FilterExpression=None, ExpressionAttributeValues=None, **_):
        items = list(self.rows[TableName].values())
        if FilterExpression:
            attr, val = re.fullmatch(r"begins_with\((\w+), (:\w+)\)", FilterExpression).groups()
            prefix = from_attr(ExpressionAttributeValues[val])
            items = [i for i in items if str(from_attr(i.get(attr, {"S": ""}))).startswith(prefix)]
        return {"Items": items}

    def describe_table(self, TableName):
        return {"Table": {"KeySchema": [{"AttributeName": k} for k in __import__("fake_dynamo").KEYS[TableName] if k]}}


class Clock:
    def __init__(self, now: datetime = NOW) -> None:
        self.t = now

    def now(self) -> datetime:
        return self.t


class CountingResearcher:
    """merchant-intel Researcher boundary: canned findings, counts calls, can fail."""
    def __init__(self, fail: bool = False) -> None:
        self.calls, self.fail = [], fail

    def research(self, merchant_id: str, canonical_name: str) -> dict[str, Any]:
        self.calls.append(merchant_id)
        if self.fail:
            raise RuntimeError("research unavailable")
        return {"sourceSummary": "synthetic research"}


class Messenger:
    """Messaging-service stand-in behind send_customer_message/send_case_email. `fail` = tool names that raise."""
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.fail: set[str] = set()

    def __call__(self, request: dict[str, Any]) -> dict[str, Any]:
        if request["themisTool"] in self.fail:
            raise RuntimeError(f"{request['themisTool']} transport failure")
        self.sent.append(request)
        return {"messageId": f"local:{len(self.sent)}"}


class Flaky:
    """Gateway wrapper that fails a tool `n` times: kind 'error' returns an error payload, 'raise' throws."""
    def __init__(self, inner: Any, calls: list | None = None) -> None:
        self.inner, self.faults, self.calls = inner, {}, calls if calls is not None else []

    def fail(self, tool: str, times: int = 1, kind: str = "error") -> None:
        self.faults[tool] = [times, kind]

    def call(self, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((tool, dict(arguments)))
        f = self.faults.get(tool)
        if f and f[0] > 0:
            f[0] -= 1
            if f[1] == "raise":
                raise ConnectionError(f"{tool} unreachable")
            return {"status": "error", "error": {"code": "UNAVAILABLE", "message": "injected failure"}}
        return self.inner.call(tool, arguments)

    def names(self, tool: str) -> list[dict[str, Any]]:
        return [a for t, a in self.calls if t == tool]


@dataclass
class World:
    permits: dict[str, str] | None = None
    model: Any = None
    researcher: CountingResearcher | None = None
    clock: Clock = field(default_factory=Clock)
    config: Config = field(default_factory=Config)

    def __post_init__(self) -> None:
        self.dynamo = DemoDynamo()
        self.store = load_demo_store(ROOT, DynamoBankToolsStore(self.dynamo, TABLES))
        self.reports, self.messenger, self.research = MemoryReportStore(), Messenger(), StubResearch()
        self.researcher = self.researcher or CountingResearcher()
        seed = self._intel()
        seed.load_profiles(json.loads(PROFILES.read_text(encoding="utf-8")))
        self.restart()

    def _intel(self) -> MerchantIntel:
        return MerchantIntel(DynamoProfileStore(self.dynamo, TABLES.merchants), clock=self.clock, researcher=self.researcher)

    def restart(self, model: Any = None) -> None:
        """Cold start: new merchant-intel, adapter, gateway and agent (empty agent memory) over the same durable tables."""
        self.intel = self._intel()
        self.adapter = ToolAdapter(self.store, self.intel, self.reports, self.messenger)
        self.cedar = harness.CedarGate(self.adapter, self.permits)
        self.gateway = Flaky(self.cedar, getattr(self, "gateway", None) and self.gateway.calls)  # call log survives restarts
        self.agent = Orchestrator(model=model or self.model or HeuristicModel(), gateway=self.gateway, memory=InMemoryMemory(),
                                  research=self.research, config=self.config, today=lambda: TODAY)

    def chat(self, customer: str, *messages: str):
        for m in messages:
            reply = self.agent.handle_turn(f"conv-{customer}", customer, m)
        return reply

    def tools(self) -> list[str]:
        return [t for t, _ in self.gateway.calls]


# -- reconciliation ------------------------------------------------------------------------------------------------

def money(x: float) -> float:
    return round(x, 2)


def reconcile_case(w: World, case_id: str) -> dict[str, Any]:
    """Cross-check report, evidence, audit, policy and totals for one case. Raises AssertionError on any mismatch."""
    case, report = w.store.get_case(case_id), w.reports.get(case_id)
    assert report is not None, f"{case_id}: no report generated"
    ids = list(case.transactionIds)
    assert [t["transactionId"] for t in report["transactions"]] == ids
    ledger = money(sum(w.store.get_transaction(t).amount for t in ids))
    assert money(case.totalDisputedAmount) == report["totalDisputedAmount"] == ledger, (case.totalDisputedAmount, ledger)
    stored_evidence = {e.evidenceId for e in w.store.evidence_for_case(case_id)}
    assert set(case.evidenceIds) == stored_evidence == {e["evidenceId"] for e in report["evidence"]}
    assert all(e["caseId"] == case_id for e in report["evidence"])
    decisions = w.store.policy_decisions_for_case(case_id)
    assert [d.to_dict() for d in decisions] == report["policyDecisions"]
    assert report["actionsTaken"] == [str(d.action) for d in decisions if str(d.outcome) == "ALLOW"]
    audit = w.store.audit_for_case(case_id)
    assert set(report["auditRefs"]) <= {a.eventId for a in audit}
    proposals = [t for t in w.gateway.calls if t[0].startswith("propose_") and t[1].get("caseId") == case_id]
    assert len(decisions) <= len(proposals)  # a Cedar denial stops a proposal before the bank records a decision
    assert not any(str(d.outcome) == "DENY" and str(d.action) in report["actionsTaken"] for d in decisions)
    return {"caseId": case_id, "status": str(case.status), "total": ledger, "evidence": len(stored_evidence),
            "policy": [[str(d.action), str(d.outcome)] for d in decisions], "audit": len(audit)}


def reconcile_world(w: World, case_ids: list[str]) -> dict[str, Any]:
    """Totals across all cases: sum(case totals) == sum(report totals) == sum(ledger amounts of disputed txns), no txn shared."""
    rows = [reconcile_case(w, c) for c in case_ids]
    cases = [w.store.get_case(c) for c in case_ids]
    txns = [t for c in cases for t in c.transactionIds]
    assert len(txns) == len(set(txns)), "a transaction is disputed by two cases"
    total = money(sum(r["total"] for r in rows))
    assert total == money(sum(w.reports.get(c)["totalDisputedAmount"] for c in case_ids)) == money(sum(c.totalDisputedAmount for c in cases))
    return {"cases": len(rows), "transactions": len(txns), "total": total}
