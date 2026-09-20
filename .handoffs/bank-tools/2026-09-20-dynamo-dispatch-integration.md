# Request: wire the bank-tools dispatcher into the tools-adapter Lambda

From: bank-tools (`agent/bank-tools/dynamo-dispatch`)
To: infra, agentcore, qa-demo

## Python entry point (no envelope assumptions made)

```python
import boto3
from bank_tools.dispatch import dispatch
from bank_tools.dynamo_store import DynamoBankToolsStore, Tables

store = DynamoBankToolsStore(boto3.client("dynamodb"), Tables.from_env())  # module scope, reused per container
result = dispatch(store, tool_name, arguments)  # arguments = camelCase object from infra/config/tool-schemas.ts
```

`result` is `{"status": "ok", ...}` or `{"status": "error", "error": {"code", "message"}}`. Codes:
VALIDATION_ERROR, NOT_FOUND, CONFLICT, INVALID_TRANSITION, TRANSACTION_NOT_OWNED, UNKNOWN_TOOL,
NOT_OWNED (generate_case_report, escalate_case -> agentcore; send_customer_message, send_case_email
-> messaging), IDEMPOTENCY_KEY_REUSED, IDEMPOTENCY_IN_PROGRESS. Unconfirmed Gateway event envelope
(`toolName`/`name`, `input`/`arguments`) is left to the handler author.

## Infra asks

1. Lambda asset: build the wheel (`uv build services/bank-tools`) and install it (Python 3.12, matches
   `requires-python`) into the deployable directory next to the handler; `boto3` comes from the runtime.
2. Table keys already match `infra/stacks/data-stack.ts`. There are no customer/evidence/policy tables, so
   the store multiplexes them into existing tables with key prefixes (see `dynamo_store.py` docstring):
   Merchants `C#/M#/P#/A#`, Cases `E#`, Audit sort-key prefixes `audit_/policy_/review_`. If you prefer
   dedicated tables, tell bank-tools the names and keys.
3. The store queries GSI `byCustomer` on Transactions and Cases (grantReadWriteData already covers indexes).
4. Idempotency TTL attribute `expiresAt` (epoch seconds) is already declared; rows carry it.

## qa-demo ask

Seed Dynamo from fixtures with `load_demo_store(repo_root, store=DynamoBankToolsStore(...))`.
