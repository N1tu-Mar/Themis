# Bank Tools workstream

## STATUS

CORE_TOOL_SURFACE_COMPLETE — integrated on main and reconciled with current contracts/fixtures.

## DONE

- All tool families from prompt.md #55 workstream B: transaction lookup, auth signals,
  case CRUD, merchant lookup, audit persistence, synthetic protected action tools.
- Installable `bank_tools` package under `services/bank-tools/src/bank_tools/`.
- `services/bank-tools/src/bank_tools/`: models.py (dataclasses mirroring packages/contracts,
  ported CASE_STATUS_TRANSITIONS), store.py (in-memory, indexed), policy.py
  (deterministic gate for propose_* actions), config.py (thresholds), tools.py
  (17 tool functions), errors.py.
- Canonical demo-fixture loader plus generated-schema enum compatibility tests.
- 35 tests passing: `python3 -m pytest services/bank-tools/tests -q`.
- Working in a dedicated worktree (`/private/tmp/themis-bank-tools-core-tools`) after
  a shared-root checkout collision wiped uncommitted work once — see KNOWN ISSUES.

## CURRENT INTERFACES

Import `from bank_tools import tools`; install with `python3 -m pip install -e services/bank-tools`.
Every tool is `fn(store: BankToolsStore, **kwargs) -> dict`, shaped
`{"status": "ok", ...}` or `{"status": "error", "error": {"code", "message"}}`.
Tools: search_transactions, get_transaction_details, get_transaction_auth_signals,
find_related_transactions, get_customer_dispute_history, resolve_merchant,
get_merchant_profile, get_merchant_risk_signals, get_case, create_case, update_case,
save_evidence, propose_provisional_credit, propose_dispute_creation,
propose_payment_block, propose_card_replacement, get_audit_log.
All state-changing bank tools require `idempotency_key` and replay cached results.
Audit records require a `case_id` (matches `AuditEventSchema`); read tools only
audit when a `case_id` is passed in.

## KNOWN ISSUES

- Runtime validation uses stdlib dataclasses + StrEnum; compatibility tests compare
  the Python enums with generated `packages/contracts/schemas.json`.
- DynamoDB persistence and AgentCore Gateway/Lambda handler wiring remain unbuilt.
- Multiple agents were sharing one working directory earlier and a branch
  switch by another agent wiped my uncommitted files (recovered from memory +
  4 surviving untracked test files). Now isolated in a `git worktree`. Other
  workstream agents should confirm they're each in their own worktree too.

## NEXT 3 TASKS

1. Add a DynamoDB-backed store implementing the existing `BankToolsStore` boundary.
2. Map the versioned camelCase Gateway contract to Python snake_case arguments.
3. Add a thin AgentCore Gateway/Lambda handler module once agentcore workstream
   defines the invocation contract.

## LAST TEST COMMAND + RESULT

- `python3 -m pytest services/bank-tools/tests -q` -> 35 passed.
- `uv build services/bank-tools` -> wheel and source distribution built.

## LAST CODE COMMIT

- 2dbd24e "Add bank-tools core tool surface: transactions, merchants, case CRUD,
  policy-gated actions" on `agent/bank-tools/core-tools`.
