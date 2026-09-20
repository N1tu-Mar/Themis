# AgentCore workstream

## STATUS

RUNTIME_SLICE_COMPLETE (branch `agent/agentcore/runtime`; local mocks only, AWS adapters unverified live)

## DONE

- `services/agent` Python 3.12 package `orchestrator` (`pyproject.toml`, no runtime deps; `boto3` optional extra `aws`).
- `python3 src/orchestrator/main.py`: `THEMIS_MODE=local` reads JSON lines on stdin with mocks; `aws` serves `GET /ping` + `POST /invocations` on :8080.
- One orchestrator, structured `CaseState` persisted through `MemoryClient` (chat history is not state).
- Flow: intake -> matching -> confirmation -> classification -> investigation -> proposal -> policy -> action | human escalation -> report request.
- Deterministic prefilter (`prefilter.py`) before the model; model only extracts signals (<=1 inference/turn, output sanitized by `clean_analysis`).
- Budgets in `Config`: 8 model turns, 20 candidates, 5 history cases, 3 memory records, 5 research pages, 1 research call, 3 auth lookups.
- Policy: only `propose_*` tool results decide; non-`ALLOW` or malformed -> `escalate_case`. Tool failure after case exists -> escalate; before -> keep state, ask to retry. Reads/idempotent writes retried once; enrichment failures become MISSING_EVIDENCE.

## CURRENT INTERFACES (`src/orchestrator/interfaces.py`)

- `ModelClient.analyze(system, view, message, tier["fast"|"reasoning"]) -> dict`
- `GatewayClient.call(tool, arguments: camelCase dict) -> {"status":"ok"|"error", ...}` (tool contract not duplicated)
- `MemoryClient.load(conversation_id) / save(conversation_id, state) / recall(query, limit) -> list[str]`
- `MerchantResearch.research(descriptor, max_pages) -> {"summary","pages"} | None`
- `Orchestrator(model=, gateway=, memory=, research=, config=, today=).handle_turn(conversation_id, customer_id, message) -> Reply(text, status, case_id)`
- Mocks (`local.py`): `LocalGateway` (`demo()`, `fail=`, `outcomes=`), `ScriptedModel`, `HeuristicModel`, `InMemoryMemory`, `StubResearch`. AWS (`aws.py`): `BedrockModel`, `GatewayHTTPClient`, `AgentCoreMemory`, `NoResearch`.
- Config env: THEMIS_MODE, ENABLE_BROWSER_RESEARCH, BEDROCK_MODEL_ID_FAST/REASONING, GATEWAY_URL, MEMORY_ID, optional THEMIS_ESCALATION_CONFIDENCE (0.7).

## KNOWN ISSUES

- AWS adapters never run live (Gateway wire format, tool-name prefix, Memory API calls unverified).
- No tool to set case `outcome` or to pass summary/evidenceRefs to `escalate_case`; see `.handoffs/agentcore/2026-09-20-runtime-integration-requests.md`.
- Merchant research adapter not wired (`NoResearch`); uncached merchants escalate on low confidence.
- Scenario B/E have only partial coverage (cancellation classification tested; proactive verification not implemented).
- Status transition table is copied from `packages/contracts` (TS); keep in sync.
- Reasoning-tier routing only triggers when a later turn starts with confidence < threshold.

## NEXT 3 TASKS

1. Live-verify Gateway/Memory/Bedrock adapters once infra is deployed (one cheap call each).
2. Wire merchant-intel research adapter; add Scenario E proactive verification.
3. Add inbound contract test against the real bank-tools store once the Gateway adapter exists.

## LAST TEST COMMAND + RESULT

- `cd services/agent && python3 -m pytest -q` -> 31 passed
- repo root `python3 -m pytest -q` -> 66 passed (agent + bank-tools); `git diff --check` clean

## LAST CODE COMMIT

- See `git log -1` on `agent/agentcore/runtime`.
