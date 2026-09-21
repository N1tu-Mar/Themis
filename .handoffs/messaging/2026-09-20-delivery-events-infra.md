# Request: delivery-event topic, permissions, env for messaging menus/reliability

From: messaging (`agent/messaging/menus-reliability`)
To: infra (cc integration)

## Topic
- New SNS topic `themis-delivery-events`, distinct from the RCS and SMS inbound topics
  (runtime refuses to start if it equals an inbound ARN).
- Point the End User Messaging configuration-set event destination (SMS + RCS delivery
  records) at it, NOT at the inbound SMS topic. Subscribe the messaging Lambda; keep DLQ + alarm.
- An event can arrive before the send is recorded; the handler throws and SNS redelivers
  (retry policy must allow a few retries with backoff).

## Environment (messaging Lambda)
- `THEMIS_DELIVERY_EVENT_TOPIC_ARN` (optional; unset = delivery events not consumed)
- Unchanged and still required: `THEMIS_RCS_POOL_ID`, `THEMIS_SMS_IDENTITY`,
  `THEMIS_SES_FROM`, `THEMIS_SUPPORT`, `IDEMPOTENCY_TABLE`, inbound topic ARNs.

## Permissions
- DynamoDB Get/Put/Update/DeleteItem on the idempotency table (already granted). Delivery
  and delivery-pointer rows reuse the `idempotencyKey` partition key
  (recordType `DELIVERY`, `DELIVERY_POINTER`); no new table.
- `sms-voice:SendTextMessage`, `sms-voice:SendRcsMessage`, `ses:SendEmail` (unchanged).
- SNS invoke permission for the new topic on the messaging Lambda.

## Reconciliation job (optional, later)
- Stuck inbound claims: rows with `state=PROCESSING` carry `claimedAt`. `ClaimReconciler`
  is an interface (Memory impl only). A scheduled job would need `dynamodb:Scan`
  (or a GSI on `state`) plus conditional UpdateItem/DeleteItem. Not wired.

## Tools adapter (infra/lambda/tools-adapter/handler.py)
- `send_case_email` now returns `{"status":"FAILED","error":...}` (no `messageId`, no raise)
  on SES failure and `{"status":"SENT","messageId":...}` on success. The adapter currently
  raises when `messageId` is missing: treat FAILED as a notification failure returned to the
  agent, never as a reason to alter or roll back the case.
- `send_customer_message` still raises on transport failure; retrying with the same
  `idempotencyKey` (= `messageId`) is safe and sends once.

## Agent runtime contract (agentcore)
- `{reply, status, caseId, suggestions?: [{label<=25, postback<=2048}]}`, 1-11 unique postbacks.
  Invalid suggestions are dropped (text still sent). `RESOLVED`/`CLOSED` status clears the case menu.
