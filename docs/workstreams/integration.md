# Integration workstream

## STATUS

WAVE_2A_INTEGRATED_LOCALLY (four worker branches merged on `main`; live AWS verification remains)

## WAVE 2A INTEGRATION

- Merged without rewriting worker history: AgentCore workflow hardening, merchant-intel durable store,
  messaging menu/delivery reliability, and Infra deployment hardening.
- `update_case.outcome` is one contract across the Gateway schema, canonical bank dispatcher, adapter,
  and AgentCore. The deployed Runtime enables `THEMIS_STRUCTURED_TOOLS=true`; Scenario C persists
  `CUSTOMER_RECOGNIZED_MERCHANT` and reports it.
- `escalate_case.summary/evidenceRefs` stays structured end-to-end. The adapter delegates to
  `orchestrator.workflow.escalate_case`, filters invented evidence IDs, preserves an explicit empty
  evidence list, and reuses an existing policy review so one policy escalation creates one request.
- The tools adapter constructs merchant intelligence through `intel_from_env`; its packaged
  `merchant_intel.DynamoProfileStore` stores `P#` profile/cache/case-state rows and `A#` aliases in
  `ThemisMerchants`. A second adapter instance reuses the durable cache without research.
- AgentCore reply suggestions are validated and persisted by `DynamoActiveMenuStore` before delivery.
  RCS postbacks and numbered/labeled SMS replies resolve to the same postback; AgentCore prefers that
  canonical postback over display text.
- `ThemisMessagingDeliveryEvents` is distinct from inbound topics, injected as
  `THEMIS_DELIVERY_EVENT_TOPIC_ARN`, and subscribed to the same Lambda's delivery-only boundary.
  Inbound and delivery handlers mutually reject the other payload class.
- Email transport failure is recorded and returned as `DELIVERY_FAILED`; a completed case and its
  report remain unchanged and the released tool idempotency claim permits a later retry.
- Root dependency resolution uses the committed workspace lockfile. Deployment assets contain the
  canonical bank-tools, merchant-intel, and orchestrator packages plus the Node 22 messaging bundle.

## INTEGRATION COVERAGE

- Python composition: policy allow/deny, Scenario B cancellation, Scenario C persisted outcome,
  Scenario E durable cache reuse, structured evidence, duplicate escalation, and notification failure.
- Cross-language composition: SNS -> active menu -> AgentCore -> Gateway tools -> Cedar -> report or
  escalation -> outbound SMS, including numeric SMS choice parity and duplicate SNS delivery.
- Infra assertions: tool schemas, shared table wiring, structured Runtime flag, canonical staged
  profile store, distinct topic subscriptions, IAM, asset completeness, and full CDK synthesis.

## CURRENT INTERFACES

- Runtime invocation: shared `InboundMessage` -> `{reply,status,caseId,suggestions?}`.
- Gateway mutation additions: `update_case.outcome?`; `escalate_case.summary?` and
  `escalate_case.evidenceRefs?`.
- Messaging direct events: `{themisTool:"send_customer_message",message}` and
  `{themisTool:"send_case_email",case,report,recipient,nextSteps}`.
- Reports: S3 `reports/<caseId>.json`. Durable merchant cache: `ThemisMerchants` `P#`/`A#` rows.
  Messaging admissions, active menus, and delivery records share the idempotency table.

## LIVE-AWS BLOCKERS

- Register/attach RCS and SMS identities and verify the SES sender; seed only synthetic demo data.
- Confirm new AgentCore CloudFormation enum values, Gateway invocation envelope/policy denial shape,
  Runtime/Memory calls, and delivery telemetry against the deployed services.
- Browser research remains disabled unless an approved page client/source provider is supplied.
- Customer identity remains the bundled synthetic phone-to-customer directory.

## VERIFICATION

Run from repository root: `npm ci`, `npm run check`, `npm run package:aws --workspace=infra`,
build wheels for all Python services, `git diff --check`, and `git status --short`.
