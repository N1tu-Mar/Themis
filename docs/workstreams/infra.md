# Infrastructure workstream

## STATUS

DEPLOYMENT_HARDENED (local only; live AWS verification still required).

## DONE

- 5 CDK v2 stacks (`ThemisData`, `ThemisAgent`, `ThemisMessaging`,
  `ThemisObservability`, `ThemisWeb`) in `infra/stacks/`, wired in
  `infra/bin/themis.ts`.
- Data: 4 tables from prompt.md #28 + an idempotency table, 1 S3 bucket.
  PAY_PER_REQUEST, `RemovalPolicy.DESTROY`.
- Messaging: separate trusted inbound topic(s) and a delivery-event topic. The
  ConfigurationSet publishes only to delivery telemetry; only inbound topics
  subscribe the normalizer. Delivery topic ARN is output.
- Agent: tools-adapter Lambda (20 tools, `infra/config/tool-schemas.ts`),
  AgentCore Gateway/GatewayTarget/Memory/PolicyEngine/Policy/Runtime, all
  real `AWS::BedrockAgentCore::*` L1 resources.
- Gateway compatibility includes optional `update_case.outcome` and structured
  `escalate_case.summary/evidenceRefs`.
- Merchant-intel cache records persist in prefixed rows of `ThemisMerchants`.
- Runtime and tools assets both package bank-tools, merchant-intel, agentcore,
  and contract schemas; `package:aws` additionally vendors boto3/botocore.
- Deployment preflight validates AWS mode, model IDs, enabled messaging
  identities, SES sender/domain, support contact, and at least one channel.
- Cedar policies gating the 4 financial tools live in `infra/policies/`.
- Observability: 2 Lambda-error alarms, 3 log-derived metrics matching
  `AuditEventSchema`, 1 dashboard.
- Web: Amplify App + branch (no repo connected - manual step, needs OAuth).
- 26 tests (`infra/test/*.test.mjs`): `cdk synth` + `aws-cdk-lib/assertions`
  resource/IAM checks. No live AWS calls in tests.

## CURRENT INTERFACES

- Stack outputs: table/bucket names, `InboundTopicArn`, `SmsTwoWayRoleArn`,
  `GatewayIdentifier`/`GatewayUrl`, `MemoryId`, `AgentRuntimeArn`,
  `PolicyEngineId`, `AmplifyAppId`/`AmplifyDefaultDomain`.
- Exact synth -> package -> preflight/deploy -> seed -> smoke order and all env
  vars are documented in `infra/README.md`.
- Cross-workstream contracts: `.handoffs/infra/2026-09-17-*.md` (tools
  adapter, agentcore runtime, messaging normalizer, web/SES manual steps).

## KNOWN ISSUES

- `authorizerType: "AWS_IAM"`, Runtime `runtime: "PYTHON_3_12"`, and the SMS
  ConfigurationSet `matchingEventTypes: ["ALL"]` are infra's best-documented
  values for very-new CFN resource types; flagged in code comments to verify
  against live service behavior at first `cdk deploy`.
- RCS/SMS registration, SES verification/delivery, Gateway wire format,
  Runtime/Memory behavior, and second-case persistence require live validation.

## NEXT 3 TASKS

1. Run the documented live deployment after identities are registered.
2. Confirm new AgentCore CFN enums and Gateway invocation envelope live.
3. Seed synthetic Dynamo data and execute both first-case and cache-hit smoke flows.

## LAST TEST COMMAND + RESULT

- `npm test --workspace=infra` -> 41/41 pass, including the existing real
  `cdk synth` subprocess; `npm run package:aws --workspace=infra` -> pass.

## LAST CODE COMMIT

- Final local commit on `agent/infra/deployment-hardening` (see `git log -1`).
