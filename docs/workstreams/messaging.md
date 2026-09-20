# Messaging workstream

## STATUS

COMPLETE — deployable runtime composition implemented; Infra/integration wiring pending.

## DONE

- Validated shared RCS/SMS InboundMessage normalization from AWS SNS payloads.
- RCS suggestion JSON, active-menu numeric/text SMS replies share canonical postbacks.
- Atomic memory/Dynamo idempotency prevents repeated downstream admission.
- Deployable SNS Lambda bundle validates environment and invokes AgentCore only.
- Durable memory/Dynamo active menus preserve customer/case choice context.
- RCS text/suggestions, SMS menus and per-message SMS fallback payloads.
- Deterministic Case/CaseReport email renderer and SES v2 adapter.
- Local inbound injection and captured outbound/email payloads make zero AWS calls.
- External configuration and injected AWS clients; all tests remain AWS-free.
- Runtime dependencies declared locally; root lockfile update handed to integration.
- Verified compatibility with updated main 52e8419 in an isolated snapshot; no merge.

## CURRENT INTERFACES

- `dist/index.mjs` exports Lambda handler `index.handler`; source is `src/aws-entry.ts`.
- `createMessagingRuntime` composes trusted SNS topics, Dynamo admission/menu stores,
  and an injected `AgentRuntimeClient`.
- `MemoryActiveMenuStore` and `DynamoActiveMenuStore` track ordered menus by
  customer and active case; all Dynamo keys use `idempotencyKey`.
- createMessaging takes env, consume, store, messagingClient, sesClient.
- Shared contracts unchanged; canonical choice intent uses InboundMessage.postback.
- Client/resource binding details: services/messaging/README.md.
- Wiring/dependency requests: .handoffs/messaging/2026-09-20-*.md.

## KNOWN ISSUES

- AWS calls are mocked; live resource provisioning/delivery verification is pending.
- Failed/ambiguous processing keeps claims reserved; reconciliation is required before replay.
- At-most-once admission does not guarantee completion across external side effects.
- Current Infra Lambda is Python and uses one indistinguishable RCS/SMS topic;
  it must consume the TypeScript bundle and provide distinct trusted topic ARNs.
- Root package lock does not yet contain the two declared AWS SDK clients.
- CodeMunch was unavailable; discovery used bounded targeted inspection.

## NEXT 3 TASKS

1. Integration runs root npm install and commits the root lockfile.
2. Infra deploys `dist/index.mjs`, distinct topic ARNs, env, permissions, and DLQ.
3. Case/outbound flow writes and conditionally clears active menus; QA smoke-tests AWS.

## LAST TEST COMMAND + RESULT

- `npm --prefix services/messaging run build` — PASS; emits bundled Lambda.
- `npm --prefix services/messaging test` — PASS, 27/27 tests.
- `git diff --check` — PASS. All AWS clients mocked in tests.
