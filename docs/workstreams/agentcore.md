# AgentCore workstream

## STATUS

WORKFLOW_HARDENING_COMPLETE (branch `agent/agentcore/workflow-hardening`; local mocks + real bank-tools path; AWS adapters unverified live)

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
- `update_case.outcome` and `escalate_case.summary/evidenceRefs` are sent only when `THEMIS_STRUCTURED_TOOLS=true` (Config.structured_tools, default off) because the Gateway schema lacks them; see `.handoffs/agentcore/2026-09-20-workflow-hardening-infra.md`. While off, Scenario C persists only locally (bank rejects early RESOLVED without outcome).
- Merchant research adapter not wired (`NoResearch`); uncached merchants escalate on low confidence.
- Scenario B ends RESOLVED with dispute + REQUEST_MERCHANT_EVIDENCE (no merchant reply handling yet). Scenario E verification = customer ledger via find_related_transactions + unreported-charge follow-up in the reply text.
- `customerRequested` on propose_payment_block is still caller-supplied (derived from the model's requested_block); bank has no stored field to validate it against.
- Status transition table is copied from `packages/contracts` (TS); keep in sync.
- Reasoning-tier routing only triggers when a later turn starts with confidence < threshold.

## HARDENING (this branch)

- `workflow.escalate_case`: one review per case+reason code; POLICY_* reuses the bank's POLICY_REQUIRES_REVIEW request; audit only on real change; evidenceRefs limited to stored evidence.
- Orchestrator calls `get_case` before policy and escalates CASE_STATE_MISMATCH if stored claimType/confidence/transactions differ.
- `Reply.suggestions` [{label, postback}] at transaction confirmation and the claim question; `_reply` adds `suggestions` only when non-empty.
- bank-tools `dispatch.OUTCOME_SPECS` = update_case + optional `outcome`, passed as `extra` until Infra adds it to SPECS.

## NEXT 3 TASKS

1. Live-verify Gateway/Memory/Bedrock adapters once infra is deployed (one cheap call each).
2. Wire merchant-intel research adapter; add Scenario E proactive verification.
3. Add inbound contract test against the real bank-tools store once the Gateway adapter exists.

## LAST TEST COMMAND + RESULT

- `python3 -m pytest -q services/agent services/bank-tools` -> 151 passed; `tests/integration` -> 13 passed; wheels build; `git diff --check` clean

## LAST CODE COMMIT

- See `git log -1` on `agent/agentcore/runtime`.
