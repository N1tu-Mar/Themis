# Themis infrastructure (AWS CDK v2)

Five stacks are wired in `bin/themis.ts`:

| Stack | Owns |
|---|---|
| `ThemisData` | DynamoDB system-of-record tables, idempotency table, private S3 artifacts bucket |
| `ThemisAgent` | Tools-adapter Lambda, AgentCore Gateway/target, Memory, Policy Engine/policies, Runtime |
| `ThemisMessaging` | Separate SMS/RCS inbound SNS topics, delivery-event SNS topic, messaging Lambda, SMS two-way role and ConfigurationSet |
| `ThemisObservability` | CloudWatch alarms, log-derived metrics, dashboard |
| `ThemisWeb` | Amplify Hosting app and branch |

## Local build and tests

From the repository root:

```sh
npm install --workspace=infra
npm test --workspace=infra
```

The infra tests build both Lambda assets, run CDK assertion tests, and execute a
credential-free `cdk synth`. They never register identities, deploy stacks, or
call live messaging, SES, Bedrock, AgentCore, DynamoDB, or S3 APIs.

## AWS deployment configuration

`infra/config/env.ts` reads these variables. `npm run preflight --workspace=infra`
fails before deployment if AWS mode, model IDs, enabled-channel identities, the
SES sender identity, or support contact are incomplete.

```sh
export THEMIS_MODE=aws
export AWS_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT=123456789012
export CDK_DEFAULT_REGION="$AWS_REGION"

export ENABLE_RCS=true
export ENABLE_SMS_FALLBACK=true
export ENABLE_SES=true
export ENABLE_BROWSER_RESEARCH=false
export ENABLE_PROACTIVE_DETECTION=false
export ENABLE_REASONING_ESCALATION=true

export BEDROCK_MODEL_ID_FAST='<foundation-model-id>'
export BEDROCK_MODEL_ID_REASONING='<foundation-model-id>'
export THEMIS_RCS_POOL_ID='<manually-registered-rcs-sms-pool-id>'
export THEMIS_SMS_IDENTITY='<phone-number-or-sender-id; not a pool>'
export SES_SENDER_DOMAIN='<verified-ses-domain>'
export THEMIS_SES_FROM='themis@<verified-ses-domain>'
export THEMIS_SUPPORT='<support-email-or-phone>'

export DEMO_AUTONOMOUS_CREDIT_LIMIT=50
export DEMO_CREDIT_CONFIDENCE_THRESHOLD=0.8
```

At least one inbound channel must be enabled. The deployed outbound composition
constructs both channel adapters at cold start, so both `THEMIS_RCS_POOL_ID` and
`THEMIS_SMS_IDENTITY` are required. The verified SES sender/domain and support
contact are also mandatory deployment inputs. CDK does not verify that these
manually provisioned identities are live.

## Exact deployment order

Do this only after manually registering the RCS pool/SMS identity and verifying
the SES sender. Bootstrap is a one-time account/region operation.

```sh
npm exec --workspace=infra -- cdk bootstrap "aws://${CDK_DEFAULT_ACCOUNT}/${CDK_DEFAULT_REGION}"

# 1. Compile, build assets, and synthesize all stacks with the intended config.
npm run synth --workspace=infra

# 2. Rebuild complete AWS assets. This vendors boto3/botocore into the Runtime
#    and asserts both Python assets contain all three packages and schema data.
npm run package:aws --workspace=infra

# 3. Validate deployment-only values, then deploy the already-packaged assets.
npm run preflight --workspace=infra
npm exec --workspace=infra -- cdk deploy --all
```

`package:aws` produces:

- `infra/build/tools-adapter`: `handler.py`, `router.py`, Dynamo profile adapter,
  `bank_tools`, `merchant_intel`, `orchestrator`, merchant profiles, schemas.
- `infra/build/agent-runtime`: the same three packages under `src/`, packaged
  schemas and fixtures, Runtime entry point, and vendored `boto3`/`botocore`.
- `services/messaging/dist/index.mjs`: the bundled Node 22 messaging Lambda.

Do not run `npm run build --workspace=infra` between `package:aws` and deploy;
the ordinary build intentionally creates the credential-free, non-vendored
Runtime asset used by tests.

## Seed after deploy

Load stack outputs and seed only the committed synthetic demo fixtures:

```sh
export TRANSACTIONS_TABLE="$(aws cloudformation describe-stacks --stack-name ThemisData --query 'Stacks[0].Outputs[?OutputKey==`TransactionsTableName`].OutputValue | [0]' --output text)"
export CASES_TABLE="$(aws cloudformation describe-stacks --stack-name ThemisData --query 'Stacks[0].Outputs[?OutputKey==`CasesTableName`].OutputValue | [0]' --output text)"
export MERCHANTS_TABLE="$(aws cloudformation describe-stacks --stack-name ThemisData --query 'Stacks[0].Outputs[?OutputKey==`MerchantsTableName`].OutputValue | [0]' --output text)"
export AUDIT_TABLE="$(aws cloudformation describe-stacks --stack-name ThemisData --query 'Stacks[0].Outputs[?OutputKey==`AuditTableName`].OutputValue | [0]' --output text)"
export IDEMPOTENCY_TABLE="$(aws cloudformation describe-stacks --stack-name ThemisData --query 'Stacks[0].Outputs[?OutputKey==`IdempotencyTableName`].OutputValue | [0]' --output text)"

PYTHONPATH=infra/build/agent-runtime/src:infra/build/agent-runtime python3 -c 'from pathlib import Path; import boto3; from bank_tools.dynamo_store import DynamoBankToolsStore, Tables; from bank_tools.fixtures import load_demo_store; load_demo_store(Path.cwd(), store=DynamoBankToolsStore(boto3.client("dynamodb"), Tables.from_env()))'
```

## Smoke-test after seed

First attach the deployed `SmsTwoWayRoleArn` and `InboundTopicArn` to the SMS
identity, attach `RcsInboundTopicArn` to the RCS agent, and confirm both are
active. Then send a synthetic SNS message through the same normalizer boundary:

```sh
export INBOUND_TOPIC_ARN="$(aws cloudformation describe-stacks --stack-name ThemisMessaging --query 'Stacks[0].Outputs[?OutputKey==`InboundTopicArn`].OutputValue | [0]' --output text)"
aws sns publish --topic-arn "$INBOUND_TOPIC_ARN" --message "{\"originationNumber\":\"+15555550100\",\"inboundMessageId\":\"smoke-$(date +%s)\",\"messageBody\":\"I do not recognize the Asteria charges.\"}"
aws logs tail /aws/lambda/ThemisMessageNormalizer --since 5m
```

Finally, verify a real registered RCS/SMS interaction, the SES case email, the
stored report under `reports/` in the artifacts bucket, durable merchant cache
rows in `ThemisMerchants`, and the second-case cache-hit flow. Acceptance IDs
are not delivery receipts, so inspect provider/SES delivery telemetry as well.

## Messaging topic separation and IAM

`InboundTopicArn` and `RcsInboundTopicArn` carry trusted customer messages and
are the only topics subscribed to `ThemisMessageNormalizer`.
`DeliveryEventTopicArn` carries ConfigurationSet delivery telemetry and has no
normalizer subscription. Its resource policy grants only `sns:Publish` to the
AWS End User Messaging SMS service, constrained by account and ConfigurationSet
ARN. The inbound two-way role can publish only to the SMS inbound topic.

The tools adapter can read/write its Dynamo/S3 system of record and invoke the
fixed messaging Lambda. It does not send SES or SMS directly. The Runtime can
invoke its configured models, Gateway and Memory; it does not access tables or
S3 directly.

## Manual steps and teardown

RCS registration, SMS identity provisioning, SES verification, live Gateway
wire validation, and Amplify OAuth connection remain manual. See the infra
handoffs for provider-specific details. These steps deliberately remain out of
automated tests.

Data resources use `RemovalPolicy.DESTROY`, and the artifacts bucket is private,
encrypted, auto-emptied, and destroyable. This is appropriate only for the
synthetic hackathon environment.
