# Infrastructure workstream

## STATUS

DONE (MVP) - synth-clean, tested, manual steps documented.

## DONE

- 5 CDK v2 stacks (`ThemisData`, `ThemisAgent`, `ThemisMessaging`,
  `ThemisObservability`, `ThemisWeb`) in `infra/stacks/`, wired in
  `infra/bin/themis.ts`.
- Data: 4 tables from prompt.md #28 + an idempotency table, 1 S3 bucket.
  PAY_PER_REQUEST, `RemovalPolicy.DESTROY`.
- Messaging: one SNS topic (`ThemisInboundMessaging`), one normalizer Lambda,
  SMS two-way IAM role + ConfigurationSet. RCS/SMS number registration is a
  documented manual step (not CDK-automatable).
- Agent: tools-adapter Lambda (20 tools, `infra/config/tool-schemas.ts`),
  AgentCore Gateway/GatewayTarget/Memory/PolicyEngine/Policy/Runtime, all
  real `AWS::BedrockAgentCore::*` L1 resources.
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
- Env vars consumed by Lambdas/Runtime documented in `infra/README.md`.
- Cross-workstream contracts: `.handoffs/infra/2026-09-17-*.md` (tools
  adapter, agentcore runtime, messaging normalizer, web/SES manual steps).

## KNOWN ISSUES

- `infra/lambda/{tools-adapter,message-normalizer}/handler.py` are
  placeholders returning `not_implemented` - real logic is agentcore/
  bank-tools/merchant-intel/messaging's to implement per the handoffs above.
- `authorizerType: "AWS_IAM"`, Runtime `runtime: "PYTHON_3_12"`, and the SMS
  ConfigurationSet `matchingEventTypes: ["ALL"]` are infra's best-documented
  values for very-new CFN resource types; flagged in code comments to verify
  against live service behavior at first `cdk deploy`.
- Root `package-lock.json` picked up the new infra deps (aws-cdk-lib,
  constructs, aws-cdk, typescript, @types/node) locally but was left
  uncommitted per file ownership (lockfiles → integration) - integration
  should `npm install` once merged to regenerate it.

## NEXT 3 TASKS

1. Once agentcore/bank-tools land real tool code, swap the Lambda asset
   paths in `infra/stacks/agent-stack.ts` if they don't end up matching
   `infra/lambda/**` (see handoffs for the alternative).
2. Run one real `cdk deploy` against a scratch AWS account to confirm the
   three flagged enum values above; update comments with the confirmed
   values.
3. Wire root `.env.example` (integration-owned) to reference the config vars
   documented in `infra/README.md` once integration merges this branch.

## LAST TEST COMMAND + RESULT

- `npm test --workspace=infra` → 26/26 pass (build + `cdk synth` +
  `aws-cdk-lib/assertions`).

## LAST CODE COMMIT

- `d0756d4` feat(infra): provision Themis AWS CDK infrastructure
