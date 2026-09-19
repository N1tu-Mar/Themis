# Messaging boundary

Requires Node 24 and the workspace's existing Zod/TypeScript dependencies. Source imports the shared runtime contracts directly; no contract changes or new dependencies are needed.

Run `npm --prefix services/messaging test` and `npm --prefix services/messaging run typecheck` from the repository root.

`createMessaging({env, consume, ...})` exposes `inbound`, `channel`, `email`, `sender`, and `support`. `consume` receives only validated shared `InboundMessage` data. Local mode (the default or `THEMIS_MODE=local`) captures outbound payloads in `channel.captured` and `email.captured`, even if AWS clients are supplied. Inject fake messages with `inbound.process(normalizeInbound(payload, channel, timestamp))`.

`createSnsHandler({topics, processor, choicesFor})` returns a Lambda-compatible SNS handler. Map SNS topic ARNs to RCS/SMS explicitly: AWS's identical payload shape cannot reliably identify the channel. Pass the runtime's `inbound` as processor. `choicesFor(customerExternalId)` must return the customer's active menu in outbound order, scoped to the current conversation/case. Numeric replies have no global meaning. Returned canonical intents use the shared `postback` field. Unknown postbacks fail instead of triggering an action. Menus are resolved after the idempotency claim so duplicate retries survive menu changes.

AWS mode requires `THEMIS_RCS_POOL_ID`, `THEMIS_SMS_IDENTITY`, `THEMIS_SES_FROM`, `THEMIS_SUPPORT`, injected clients, and a durable `IdempotencyStore`. Use an RCS+SMS pool for text fallback. The SMS identity must be a phone number/sender ID (value, ID or ARN), not a pool, because rich RCS per-message fallback disallows pools. Region/credentials are configured on the injected SDK clients. Resource creation is owned by Infra.

The client interfaces accept exact AWS request payloads. Bind AWS SDK v3 operations at the composition root:

```js
const messagingClient = {
  sendTextMessage: input => smsVoice.send(new SendTextMessageCommand(input)),
  sendRcsMessage: input => smsVoice.send(new SendRcsMessageCommand(input)),
};
const sesClient = { sendEmail: input => sesV2.send(new SendEmailCommand(input)) };
const dynamoClient = {
  putItem: input => dynamo.send(new PutItemCommand(input)),
  updateItem: input => dynamo.send(new UpdateItemCommand(input)),
};
const store = new DynamoIdempotencyStore(tableName, dynamoClient);
```

SDK installation/bundling belongs to the deployment composition root. The worker does not import an SDK or create clients in local mode.

Dynamo idempotency uses the shared table's string partition key `idempotencyKey` and PutItem/UpdateItem permission. Keys are hashed customer/message IDs; no message bodies are persisted. Atomic conditional claims prevent repeats across Lambda invocations. Claims do not expire or automatically release after failure: partial downstream effects must not execute twice. Failed/incomplete PROCESSING claims need operator reconciliation; this is at-most-once admission, not an exactly-once transaction across banking and messaging systems. Memory storage is for a single-process local MVP only. Downstream systems should also retain the inbound ID as their operation key. A transport timeout is ambiguous, so adapters surface it without automatically resending over SMS.

`caseEmail({case, report, recipient, sender, support, nextSteps})` produces an SES v2 request using structured facts. Case/report identities, transaction membership, currency, totals, and customer ownership are checked. Only `actionsTaken` are presented as completed actions. `nextSteps` must be supplied by deterministic case workflow; the renderer invents none. SES sender identities must be verified; sandbox accounts additionally restrict recipients. Acceptance IDs are not delivery receipts. Infra must configure delivery monitoring/DLQs and SNS subscription permissions. Use the Lambda subscription boundary, not an unauthenticated SNS HTTP endpoint.

Official request references: [inbound SNS](https://docs.aws.amazon.com/sms-voice/latest/userguide/rcs-inbound.html), [suggestion replies](https://docs.aws.amazon.com/sms-voice/latest/userguide/rcs-suggestions.html), [rich RCS fallback](https://docs.aws.amazon.com/sms-voice/latest/userguide/rcs-rich-messaging.html), [conditional Dynamo claims](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html), [SES v2](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).
