# Messaging workstream

## STATUS

COMPLETE — application boundary implemented; AWS resource wiring belongs to Infra/integration.

## DONE

- Validated shared RCS/SMS InboundMessage normalization from AWS SNS payloads.
- RCS suggestion JSON, active-menu numeric/text SMS replies share canonical postbacks.
- Atomic memory/Dynamo idempotency prevents repeated downstream admission.
- RCS text/suggestions, SMS menus and per-message SMS fallback payloads.
- Deterministic Case/CaseReport email renderer and SES v2 adapter.
- Local inbound injection and captured outbound/email payloads make zero AWS calls.
- External configuration and injected AWS clients; no SDK/dependency additions.
- Verified compatibility with updated main 52e8419 in an isolated snapshot; no merge.

## CURRENT INTERFACES

- services/messaging/src/index.ts exports createMessaging, createSnsHandler,
  normalizeInbound, normalizeChoice, CHOICES, InboundProcessor,
  MemoryIdempotencyStore, DynamoIdempotencyStore, ChannelAdapter, SesAdapter, caseEmail.
- createMessaging takes env, consume, store, messagingClient, sesClient.
- SNS handler takes topics ARN/channel map, processor, choicesFor(customerExternalId).
- Shared contracts unchanged; canonical choice intent uses InboundMessage.postback.
- Client/resource binding details: services/messaging/README.md.
- Infra request: .handoffs/messaging/2026-09-17-infra-resources.md.

## KNOWN ISSUES

- AWS calls are mocked; live resource provisioning/delivery verification is pending Infra.
- Failed/ambiguous processing keeps claims reserved; reconciliation is required before replay.
- At-most-once admission does not guarantee completion across external side effects.
- In-memory idempotency is local-only; AWS composition must supply durable storage.
- Active menu persistence and downstream consumer are integration-owned.
- CodeMunch was unavailable; discovery used bounded targeted inspection.

## NEXT 3 TASKS

1. Infra provisions SNS/RCS/SMS/SES/Dynamo resources and SDK composition.
2. Integration connects consume and customer/case-scoped active menus.
3. QA runs a synthetic AWS smoke test with verified identities and delivery monitoring.

## LAST TEST COMMAND + RESULT

- npm --prefix services/messaging test — PASS, 20/20 tests.
- npm --prefix services/messaging run typecheck — PASS.
- Same suite/typecheck against main 52e8419 contracts/fixtures snapshot — PASS.
- git diff --check — PASS. No paid calls; existing workspace dependencies were linked for checks.

## LAST CODE COMMIT

- d3ada3e feat(messaging): add durable delivery deduplication and resource handoff
