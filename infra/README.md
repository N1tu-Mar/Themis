# Themis infrastructure (AWS CDK v2)

Five stacks, wired in `bin/themis.ts`:

| Stack | Owns |
|---|---|
| `ThemisData` | DynamoDB tables, idempotency table, S3 artifacts bucket |
| `ThemisAgent` | Tools-adapter Lambda, AgentCore Gateway/GatewayTarget/Memory/PolicyEngine/Policies/Runtime |
| `ThemisMessaging` | Inbound SNS topic, normalizer Lambda, SMS two-way IAM role + ConfigurationSet |
| `ThemisObservability` | CloudWatch alarms, log-derived metrics, dashboard |
| `ThemisWeb` | Amplify Hosting app + branch for `apps/dashboard` |

## Setup

```
npm install --workspace=infra   # from repo root
npm run build --workspace=infra
```

`cdk synth` needs no AWS credentials (uses dummy account/region if unset).
`cdk deploy` needs valid AWS credentials and a bootstrapped environment
(`npx cdk bootstrap aws://ACCOUNT/REGION`, one-time per account/region).

```
cd infra
npx cdk synth
npx cdk deploy --all      # requires AWS credentials
```

## Configuration (env vars, all read in `config/env.ts`)

```
THEMIS_MODE=local|aws            # default: local
AWS_REGION / CDK_DEFAULT_REGION  # default: us-east-1
CDK_DEFAULT_ACCOUNT

ENABLE_RCS                       # default: false
ENABLE_SMS_FALLBACK              # default: true
ENABLE_SES                       # default: true
ENABLE_BROWSER_RESEARCH          # default: false
ENABLE_PROACTIVE_DETECTION       # default: false

BEDROCK_MODEL_ID_FAST            # required when THEMIS_MODE=aws, no default
BEDROCK_MODEL_ID_REASONING       # required when THEMIS_MODE=aws, no default
SES_SENDER_DOMAIN                # default: themis-demo.example (placeholder - see manual steps)
PROVISIONAL_CREDIT_AUTO_APPROVE_LIMIT   # default: 50
```

## Manual steps CDK does not automate

RCS registration, SMS number provisioning, SES identity verification, and
connecting the Amplify app to a GitHub repo all require interactive
console/OAuth steps that can't be reproduced by `cdk deploy` alone - see
`.handoffs/infra/2026-09-17-messaging-lambda-contract.md` and
`.handoffs/infra/2026-09-17-web-and-ses-manual-steps.md` for exactly what to
do and why each one was left manual.

## Retention / teardown

Every data resource (`ThemisData` stack) is `RemovalPolicy.DESTROY` with
`autoDeleteObjects` on the S3 bucket - `cdk destroy --all` fully tears the
demo down with no orphaned billing resources. This is a hackathon setting,
not a production one; do not reuse this stack for anything holding real data
without changing it.

## Testing

```
npm test --workspace=infra
```

Runs `cdk synth` (via the CLI, dummy account/region) plus `aws-cdk-lib/assertions`
checks per stack: expected resources exist, no `Action:"*"`+`Resource:"*"`
IAM statements, env/config values propagate, SNS/DynamoDB/S3/CloudWatch
wiring matches what's documented above. No AWS credentials or live
paid calls (SES/SNS/Bedrock) happen in any test.
