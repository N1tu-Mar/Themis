# Request: deploy the messaging TypeScript runtime composition

From: messaging (`agent/messaging/runtime-composition`)
To: infra / integration

Replace the Python placeholder asset with the generated Node bundle:

- Pre-deploy: `npm --prefix services/messaging run build`
- Asset: `services/messaging/dist/`
- Runtime: Node.js 22
- Handler: `index.handler`
- Keep the exact-runtime-ARN `bedrock-agentcore:InvokeAgentRuntime` grant.
- Grant Dynamo GetItem/PutItem/UpdateItem/DeleteItem.

Set environment:

- `THEMIS_MODE=aws`
- `IDEMPOTENCY_TABLE=<table with string PK idempotencyKey>`
- optional `ACTIVE_MENU_TABLE` (defaults to the idempotency table; same PK)
- `AGENT_RUNTIME_ARN=<full runtime ARN>`
- optional `AGENT_RUNTIME_QUALIFIER`
- `ENABLE_RCS=true|false`, `ENABLE_SMS_FALLBACK=true|false`
- `THEMIS_RCS_TOPIC_ARN` when RCS is enabled
- `THEMIS_SMS_TOPIC_ARN` when SMS is enabled

The current shared inbound topic cannot distinguish plain RCS from SMS. Provision
distinct trusted SNS topic ARNs when both channels are enabled and subscribe the
same Lambda to both. Preserve restricted SNS invocation permissions, monitoring,
and a DLQ/alarm for initial failures. SNS retry will find the retained admission
claim and will not invoke AgentCore twice.

The case/outbound workflow must call `DynamoActiveMenuStore.set` whenever it sends
a choice menu and `clear(customerExternalId, caseId)` when that case menu closes.
The conditional clear protects a newer active case menu.
