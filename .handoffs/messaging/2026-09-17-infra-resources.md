# Messaging resource interface for Infra / integration

No shared contract changes are requested. Messaging tests and typechecking pass against main 52e8419.

Provision/configure outside this worker:
- SNS inbound topics mapped explicitly to RCS/SMS; Lambda subscription with restricted invocation permissions and DLQ.
- Active RCS agent with two-way SNS destination enabled; an RCS+SMS pool for plain-text fallback.
- SMS phone number/sender identity for rich per-message fallback (pool identities are invalid here).
- DynamoDB table with one string partition key `pk`; grant PutItem/UpdateItem to the handler. Do not configure claim expiry; incomplete PROCESSING records require reconciliation before replay.
- SES verified sender, permitted recipients if sandboxed, and delivery monitoring.
- AWS SDK client composition/bundling and region/credentials at the Lambda entry point.

Environment: THEMIS_MODE=aws, THEMIS_RCS_POOL_ID, THEMIS_SMS_IDENTITY, THEMIS_SES_FROM, THEMIS_SUPPORT. Pass the idempotency table name to DynamoIdempotencyStore and topic/channel map to createSnsHandler.

Integration supplies consume(InboundMessage), customer/case-scoped active-menu storage for choicesFor(customerExternalId), and deterministic email nextSteps. These remain outside messaging ownership.

See services/messaging/README.md for client bindings. AWS acceptance IDs do not imply delivery. Ambiguous processing failures retain claims to avoid repeated downstream effects.
