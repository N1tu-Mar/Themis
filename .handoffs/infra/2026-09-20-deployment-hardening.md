# Infra deployment-hardening handoff

- Gateway schema now accepts optional `update_case.outcome` and optional
  `escalate_case.summary/evidenceRefs`; adapter compatibility specs implement
  both without changing application-owned packages.
- `ThemisMessagingDeliveryEvents` is separate from inbound SMS/RCS topics.
  SMS ConfigurationSet events publish there; the normalizer has no subscription.
- `DeliveryEventTopicArn` is output. Topic policy permits only `sns:Publish`
  from `sms-voice.amazonaws.com`, constrained by account/configuration-set ARN.
- Tools adapter no longer has unused SES permission; outbound delivery remains
  delegated to the fixed messaging Lambda.
- Merchant-intel uses a Dynamo `ProfileStore` in prefixed `I#` rows of
  `ThemisMerchants`; `MERCHANT_PROFILE_TABLE` aliases the existing table and
  the adapter retains its required read/write grant.
- Tools and Runtime assets contain `bank_tools`, `merchant_intel`,
  `orchestrator`, schema data, and synthetic package data. AWS packaging vendors
  boto3/botocore and asserts all required paths plus messaging `index.mjs`.
- Runtime, tools adapter, and messaging Lambda are fixed to `THEMIS_MODE=aws`;
  tests assert Gateway/Memory/runtime refs, table/bucket env, and topic wiring.
- `npm run preflight --workspace=infra` validates deployment configuration but
  performs no live AWS lookup or identity registration.
- `infra/README.md` has exact synth, AWS package, preflight/deploy, Dynamo seed,
  and SNS smoke-test commands.
- Verification: infra tests 41/41, synth subprocess passed, AWS package passed,
  and final Runtime asset includes vendored boto3/botocore.
- Live remaining: identity registration/attachment, SES verification/delivery,
  AgentCore CFN enums and Gateway envelope, Runtime/Memory invocation, delivery
  telemetry, report persistence, and second-case merchant cache reuse.
