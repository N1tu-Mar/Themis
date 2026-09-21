# Handoff: infra + integration (from agentcore, workflow-hardening)

Gateway schema (`infra/config/tool-schemas.ts`) and tools adapter (`infra/lambda/tools-adapter/router.py`) are Infra-owned; nothing there was edited.

## Schema additions requested (all optional, additive)

- `update_case`: `outcome` — string, enum `CUSTOMER_RECOGNIZED_MERCHANT`.
- `escalate_case`: `summary` — string (<=500 chars); `evidenceRefs` — array of string. `reason` becomes a plain code (e.g. `POLICY_DENY`) when these are sent.

## Router wiring

- update_case: register `bank_tools.dispatch.OUTCOME_SPECS["update_case"]` (or move its Spec into `SPECS` and the schema together; `test_dispatcher_matches_gateway_contract` compares them).
- escalate_case Spec: params `caseId, reason, summary?, evidenceRefs? (list), idempotencyKey`; call
  `workflow.escalate_case(store, case_id=, reason=, summary=, evidence_refs=)`. Working example: `RealGateway` in `services/agent/tests/test_workflow_hardening.py`.

## Runtime switch

Set `THEMIS_STRUCTURED_TOOLS=true` on the AgentCore Runtime only after the schema is deployed. Off: legacy `reason="CODE: summary [evidence: ids]"`, no outcome (the bank then rejects the early RESOLVED for Scenario C, best effort/ignored).

## Also for integration

- New optional `suggestions: [{label, postback}]` in the runtime reply JSON (`orchestrator.main._reply`); messaging can render as RCS suggested replies. Postbacks return as the next inbound `postback`/`text`.
- Runtime now calls `get_case` and `find_related_transactions` (both already in the Gateway schema; ensure Cedar/IAM allow them).
- `tests/integration` untouched; all 13 still pass.
