# Request: implement the AgentCore Gateway tools-adapter Lambda

From: infra (`agent/infra/aws`)
To: agentcore, bank-tools, merchant-intel

## What infra provisioned

One Lambda (`ThemisToolsAdapter`, `infra/stacks/agent-stack.ts`) registered as
the AgentCore Gateway's only target (`ThemisGateway` / `themis-tools`),
exposing all 20 tools from prompt.md #11. Its code currently comes from
`infra/lambda/tools-adapter/handler.py`, a placeholder that returns
`{"status": "not_implemented", "tool": <name>}` for every call - it never
claims a financial/account-impacting action succeeded.

Tool names + parameter schemas registered on the Gateway target live in
`infra/config/tool-schemas.ts` (source of truth for what the Gateway will
send). If you change a tool's parameters, update that file in the same PR so
Gateway and Lambda stay in sync.

## What you need to implement

Replace `infra/lambda/tools-adapter/handler.py` (or point
`lambda.Code.fromAsset` in `infra/stacks/agent-stack.ts` at wherever your
build output lands - either works, infra just needs one deployable directory)
with a real handler:

```python
def handler(event, context):
    # event shape: MCP-style tool invocation from the Gateway - {"toolName" or
    # "name": str, "input" or "arguments": dict}. Confirm the exact envelope
    # against the deployed Gateway (this is a very new AWS service; infra
    # verified everything at the CDK/CloudFormation type level but not against
    # a live invocation).
    ...
```

Environment variables already wired (read via `os.environ`):

```
TRANSACTIONS_TABLE, CASES_TABLE, MERCHANTS_TABLE, AUDIT_TABLE, IDEMPOTENCY_TABLE
ARTIFACTS_BUCKET
SES_SENDER_DOMAIN, ENABLE_SES
PROVISIONAL_CREDIT_AUTO_APPROVE_LIMIT
THEMIS_MODE
```

IAM already granted to this Lambda's role: read/write on all 5 tables,
read/write on the artifacts bucket, and (when `ENABLE_SES=true`)
`ses:SendEmail`/`ses:SendRawEmail` scoped to `identity/${SES_SENDER_DOMAIN}`.
No other AWS permissions - if a tool needs something else, ask via a new
handoff rather than widening this role yourselves (you don't own `infra/**`).

## Policy-gated tools

`propose_payment_block`, `propose_card_replacement`,
`propose_dispute_creation`, `propose_provisional_credit` are meant to be
evaluated by the AgentCore Policy Engine (`infra/policies/*.cedar`) before
your handler executes the action - see `infra/policies/README.md` for the
Cedar source and its own "verify before deploy" caveat. Do not re-implement
that gate as an LLM instruction only (prompt.md #24/#48).
