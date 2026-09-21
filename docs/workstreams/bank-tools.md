# Bank Tools workstream

## STATUS

DYNAMO_DISPATCH_COMPLETE — storage protocol, DynamoDB store, and Gateway dispatcher done on
`agent/bank-tools/dynamo-dispatch` (local commit, not pushed). Lambda handler wiring is integration work.

## DONE

- Core tool surface (17 tools), in-memory store, deterministic policy, demo-fixture loader (35 tests).
- `BankToolsStorage` Protocol (store.py) is what tools/dispatcher depend on; in-memory `BankToolsStore`
  and `DynamoBankToolsStore` (dynamo_store.py, injected low-level client, no boto3 import) implement it.
- `dispatch(store, tool_name, arguments)` (dispatch.py): camelCase -> snake_case via explicit tables,
  required/unknown/type/range validation, mandatory `idempotencyKey` on mutating tools, NOT_OWNED for
  AgentCore/messaging tools, UNKNOWN_TOOL otherwise. A test parses infra/config/tool-schemas.ts and fails on drift.
- Idempotency: `claim_idempotency` (conditional put, 60s lease) -> run -> `remember_result`; replay returns
  the stored result and writes nothing; same key + different args -> IDEMPOTENCY_KEY_REUSED; errors release the key.
- `create_case` now rejects transactions owned by another customer (TRANSACTION_NOT_OWNED) and currency mismatches.
- Policy stays in Python: `confidence`/`claimType`/`hasConfirmedTransactions` from the Gateway are validated but
  ignored; propose_dispute_creation requires supplied transactionIds to be on the case.
- 108 tests; the dispatch tests run against both stores, incl. all current demo fixtures.

## CURRENT INTERFACES

Install: `python3 -m pip install -e services/bank-tools`.
- Tools: `fn(store: BankToolsStorage, **snake_case) -> {"status": "ok", ...} | {"status": "error", "error": {code, message}}`.
- Gateway: `dispatch(store, "create_case", {"customerId": ..., "idempotencyKey": ...})` from `bank_tools.dispatch`.
- Dynamo: `DynamoBankToolsStore(boto3.client("dynamodb"), Tables.from_env())`; tests use `tests/fake_dynamo.py`.
- Seed any store: `load_demo_store(repo_root, store=...)`.

## PERSISTENCE ASSUMPTIONS

- Tables/keys/GSIs from infra/stacks/data-stack.ts. No customer/evidence/policy tables exist, so they share
  Merchants (`C#`,`M#`,`P#`,`A#` prefixes), Cases (`E#`) and Audit (`audit_`,`policy_`,`review_` sort keys).
- No cross-item transactions: a crash mid-tool leaves partial writes; the IN_PROGRESS claim expires after its
  lease and a retry re-runs. `replace_case` is last-writer-wins. GSI reads (cases by customer) are eventually consistent.
- Idempotency rows: pk `<tool>#<key>`, fingerprint, status, result JSON, TTL `expiresAt` (7 days).

## KNOWN ISSUES

- Gateway event envelope unconfirmed; no Lambda handler module yet (handler author calls `dispatch`).
- `get_audit_log` and `include_expired` are not in the Gateway contract, so the dispatcher does not expose them.
- Fake Dynamo evaluates only the condition/key expressions this store emits; verify against real DynamoDB once.

## NEXT 3 TASKS

1. Integration: build Lambda handler + asset per `.handoffs/bank-tools/2026-09-20-dynamo-dispatch-integration.md`.
2. Seed Dynamo from fixtures (qa-demo) and run one live smoke test of the conditional writes.
3. If throughput/consistency matters: version attribute on cases, TransactWriteItems for propose_* writes.

## LAST TEST COMMAND + RESULT

- `python3 -m pytest services/bank-tools/tests -q` -> 108 passed.
- `uv build services/bank-tools` -> wheel + sdist built.

## Workflow hardening (branch agent/agentcore/workflow-hardening)

- `dispatch.OUTCOME_SPECS`: update_case with optional `outcome` (CUSTOMER_RECOGNIZED_MERCHANT). Kept out of `SPECS` so the TS-contract drift test still passes; move it in when Infra adds the field.
- `propose_*` no longer queues a duplicate POLICY_REQUIRES_REVIEW request on a repeat call with a new idempotency key.
- `BankToolsStorage` protocol now lists `human_review_requests_for_case`.
