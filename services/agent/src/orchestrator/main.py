"""Runtime entry point: `python3 src/orchestrator/main.py` (see .handoffs/infra/2026-09-17-agentcore-runtime-contract.md).

THEMIS_MODE=local: mocks only; reads JSON lines ({"conversationId","customerId","message"} or plain text) from stdin.
THEMIS_MODE=aws:   AgentCore Runtime HTTP contract on :8080 (GET /ping, POST /invocations).
"""
from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # so `orchestrator` imports when run as a script

from orchestrator.config import Config  # noqa: E402
from orchestrator.engine import Orchestrator  # noqa: E402
from orchestrator.local import HeuristicModel, InMemoryMemory, LocalGateway, StubResearch  # noqa: E402


def build(cfg: Config) -> Orchestrator:
    if cfg.mode == "aws":
        from orchestrator.aws import AgentCoreMemory, BedrockModel, GatewayHTTPClient, NoResearch
        return Orchestrator(model=BedrockModel(cfg), gateway=GatewayHTTPClient(cfg.gateway_url),
                            memory=AgentCoreMemory(cfg.memory_id), research=NoResearch(), config=cfg)
    return Orchestrator(model=HeuristicModel(), gateway=LocalGateway.demo(), memory=InMemoryMemory(),
                        research=StubResearch(), config=cfg)


def _reply(agent: Orchestrator, payload: dict) -> dict:
    r = agent.handle_turn(str(payload.get("conversationId", "local-1")), str(payload.get("customerId", "customer_demo_001")),
                          str(payload.get("message", "")))
    return {"reply": r.text, "status": r.status, "caseId": r.case_id}


def run_local(agent: Orchestrator) -> None:
    print("themis agent ready (local)", file=sys.stderr)
    for line in sys.stdin:
        if line.strip():
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                payload = {"message": line.strip()}
            print(json.dumps(_reply(agent, payload if isinstance(payload, dict) else {"message": line.strip()})), flush=True)


def run_server(agent: Orchestrator, port: int = 8080) -> None:
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            self._send(200, {"status": "Healthy"}) if self.path == "/ping" else self._send(404, {})

        def do_POST(self) -> None:
            if self.path != "/invocations":
                return self._send(404, {})
            try:
                payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                self._send(200, _reply(agent, payload))
            except Exception:  # noqa: BLE001 - never leak internals to the caller
                self._send(500, {"error": "internal error"})

    HTTPServer(("0.0.0.0", port), Handler).serve_forever()


def main() -> None:
    cfg = Config.from_env()
    agent = build(cfg)
    run_server(agent) if cfg.mode == "aws" else run_local(agent)


if __name__ == "__main__":
    main()
