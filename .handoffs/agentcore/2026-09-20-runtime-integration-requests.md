# Requests from agentcore (agent/agentcore/runtime)

## infra
- Runtime must serve the AgentCore HTTP contract: `THEMIS_MODE=aws` starts `GET /ping` and `POST /invocations` on :8080 via `python3 src/orchestrator/main.py`. Body: `{"conversationId","customerId","message"}` -> `{"reply","status","caseId"}`.
- Zipped `services/agent/` needs `boto3` available in the Runtime image (aws adapters import it lazily; `pyproject` extra `aws`). The agent has no other dependencies.
- Optional env: `THEMIS_ESCALATION_CONFIDENCE` (default 0.7). Existing env vars are read as documented in the runtime-contract handoff.
- Unverified live: Gateway MCP wire format (SigV4 JSON-RPC `tools/call`, service `bedrock-agentcore`), whether tool names carry a target prefix, and AgentCore Memory `create_event/list_events/retrieve_memory_records` usage.

## bank-tools / infra tool schema
- Agent sends `update_case` as flat camelCase fields (`status`, `claimType`, `confidence`, `requiresHumanReview`) per `infra/config/tool-schemas.ts`; bank-tools' Python `update_case` takes `patch=`. The Lambda adapter must map flat -> patch.
- Agent expects: `create_case` -> `{"status":"ok","case":{"caseId"}}`; `resolve_merchant` -> `resolved/merchantId/canonicalName`; `propose_*` -> `{"decision":{"outcome":"ALLOW|DENY|REQUIRE_HUMAN_REVIEW"}}`; `get_merchant_risk_signals` -> `count`. Anything else is treated as DENY (fail closed).
- Agent creates the case with `claimType=INSUFFICIENT_INFORMATION`, then replays statuses via `update_case(status=...)` following the shared transition table, and finally sets `claimType`. `save_evidence` gets an agent-generated `evidenceId` (`ev_<case>_<n>`).
- No tool sets case `outcome` (e.g. `CUSTOMER_RECOGNIZED_MERCHANT`); the agent records it as evidence type `CUSTOMER_RECOGNIZED_MERCHANT`. Ask: allow `update_case` to set `outcome`.
- `escalate_case` only takes `reason`; the agent packs `CODE: summary [evidence: ids]` into it. Ask: optional `summary`/`evidenceRefs` args to fill the human-review queue record.

## merchant-intel
- Agent defines `MerchantResearch.research(descriptor, max_pages) -> {"summary","pages"} | None`. Only a `NoResearch` stub is wired in aws mode. Provide an adapter (Browser tool, <=5 pages, only when merchant intel is uncached) or a Gateway tool.
