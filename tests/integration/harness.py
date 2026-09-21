"""Local composition harness: the real tools adapter (bank-tools + merchant-intel + workflow + messaging bridge)
behind a Cedar gate that evaluates the real infra/policies/financial-actions.cedar text.

Used by the pytest suites here and, as a child process, by composition.test.ts (stdin/stdout JSON lines).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
for p in ("services/bank-tools/src", "services/merchant-intel/src", "services/agent/src", "infra/lambda/tools-adapter"):
    sys.path.insert(0, str(ROOT / p))

from bank_tools.config import DEMO_AUTONOMOUS_CREDIT_LIMIT, DEMO_CREDIT_CONFIDENCE_THRESHOLD  # noqa: E402
from bank_tools.fixtures import load_demo_store  # noqa: E402
from merchant_intel import InMemoryProfileStore, MerchantIntel  # noqa: E402
from orchestrator.aws import policy_denial  # noqa: E402
from orchestrator.config import Config  # noqa: E402
from orchestrator.engine import Orchestrator  # noqa: E402
from orchestrator.local import HeuristicModel, InMemoryMemory, StubResearch  # noqa: E402
from orchestrator.workflow import MemoryReportStore  # noqa: E402
from router import ToolAdapter  # noqa: E402

CEDAR = ROOT / "infra/policies/financial-actions.cedar"
_PERMIT = re.compile(r'permit\(\s*principal,\s*action == Action::"(\w+)",\s*resource\s*\)(?:\s*when\s*\{(.*?)\})?\s*;', re.S)


def cedar_permits(credit_limit: float = DEMO_AUTONOMOUS_CREDIT_LIMIT, confidence: float = DEMO_CREDIT_CONFIDENCE_THRESHOLD) -> dict[str, str]:
    """action -> Python boolean expression over `context`, translated from the Cedar `when` clause (deploy-time substitution applied)."""
    text = re.sub(r"//[^\n]*", "", CEDAR.read_text(encoding="utf-8"))
    text = text.replace("__DEMO_AUTONOMOUS_CREDIT_LIMIT__", str(credit_limit)).replace("__DEMO_CREDIT_CONFIDENCE_THRESHOLD__", str(confidence))
    out = {}
    for action, cond in _PERMIT.findall(text):
        expr = (cond or "true").replace("&&", " and ").replace("||", " or ")
        expr = re.sub(r"context\.(\w+)", r'context["\1"]', expr)
        out[action] = "(" + re.sub(r"\btrue\b", "True", re.sub(r"\bfalse\b", "False", expr)) + ")"
    return out


class CedarGate:
    """Gateway stand-in: propose_* calls need a Cedar permit for their arguments, else the policy-denial decision the
    real GatewayHTTPClient produces; everything else passes straight to the tools adapter."""
    def __init__(self, inner: Any, permits: dict[str, str] | None = None) -> None:
        self.inner, self.permits, self.calls = inner, permits if permits is not None else cedar_permits(), []

    def call(self, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((tool, dict(arguments)))
        if tool.startswith("propose_"):
            expr = self.permits.get(tool)
            if expr is None or not eval(expr, {"__builtins__": {}}, {"context": arguments}):  # noqa: S307 - our own policy file
                return policy_denial(tool, "Policy denied: no permit matched") or {"status": "error"}
        return self.inner.call(tool, arguments)


class Composition:
    def __init__(self, permits: dict[str, str] | None = None, messenger: Any = None) -> None:
        self.store = load_demo_store(ROOT)
        self.intel = MerchantIntel(InMemoryProfileStore())
        self.intel.load_profiles(json.loads((ROOT / "fixtures/merchants/demo-profiles.json").read_text(encoding="utf-8")))
        self.reports, self.sent = MemoryReportStore(), []
        deliver = messenger or (lambda r: self.sent.append(r) or {"messageId": f"local:{len(self.sent)}"})
        self.adapter = ToolAdapter(self.store, self.intel, self.reports, deliver)
        self.gateway = CedarGate(self.adapter, permits)
        self.agent = Orchestrator(model=HeuristicModel(), gateway=self.gateway, memory=InMemoryMemory(), research=StubResearch(), config=Config())


def inspect(comp: Composition, case_id: str) -> dict[str, Any]:
    case = comp.store.get_case(case_id)
    return {"caseStatus": str(case.status), "requiresHumanReview": case.requiresHumanReview,
            "policy": [[str(d.action), str(d.outcome)] for d in comp.store.policy_decisions_for_case(case_id)],
            "reviews": [r.reason for r in comp.store.human_review_requests_for_case(case_id)],
            "reportHumanReviewEvents": len((comp.reports.get(case_id) or {}).get("humanReviewEvents", [])),
            "tools": [t for t, _ in comp.gateway.calls]}


def main() -> None:
    """Child-process protocol: one JSON payload per stdin line -> one JSON reply per stdout line.

    Payloads are shared InboundMessages (as the messaging service sends them) or {"inspect": caseId}.
    THEMIS_TEST_CREDIT_LIMIT lowers the Cedar credit limit so a bank-allowed credit is denied at the gate.
    """
    import os
    from orchestrator.main import _reply, load_directory
    limit = os.environ.get("THEMIS_TEST_CREDIT_LIMIT")
    comp = Composition(cedar_permits(credit_limit=float(limit)) if limit else None)
    directory = load_directory(str(ROOT / "fixtures/customers/demo.json"))
    print("ready", file=sys.stderr, flush=True)
    for line in sys.stdin:
        if line.strip():
            payload = json.loads(line)
            print(json.dumps(inspect(comp, payload["inspect"]) if "inspect" in payload else _reply(comp.agent, payload, directory)), flush=True)


if __name__ == "__main__":
    main()
