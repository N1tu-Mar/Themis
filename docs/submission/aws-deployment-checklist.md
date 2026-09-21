# AWS deployment checklist

This is an operator checklist, not an automated test. Complete the manual identity work in [manual-registration.md](./manual-registration.md) before expecting a live customer message.

## 1. Set and review deployment inputs

```bash
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
export BEDROCK_MODEL_ID_FAST='<enabled-model-id>'
export BEDROCK_MODEL_ID_REASONING='<enabled-model-id>'
export THEMIS_RCS_POOL_ID='<registered-pool-id>'
export THEMIS_SMS_IDENTITY='<registered-phone-number-or-sender-id>'
export SES_SENDER_DOMAIN='<verified-domain>'
export THEMIS_SES_FROM='support@<verified-domain>'
export THEMIS_SUPPORT='support@<verified-domain>'
export DEMO_AUTONOMOUS_CREDIT_LIMIT=50
export DEMO_CREDIT_CONFIDENCE_THRESHOLD=0.8
```

Do not put production secrets in shell history. The preflight checks presence and shape, not whether an identity has completed provider review.

## 2. Bootstrap, synthesize, package, validate, deploy

Run these commands in this exact order from the repository root:

```bash
npm ci
npm exec --workspace=infra -- cdk bootstrap "aws://${CDK_DEFAULT_ACCOUNT}/${CDK_DEFAULT_REGION}"
npm run synth --workspace=infra
npm run package:aws --workspace=infra
npm run preflight --workspace=infra
npm exec --workspace=infra -- cdk deploy --all
```

Do not run the ordinary infra build between `package:aws` and `cdk deploy`; it can remove the vendored AWS dependencies from the packaged runtime asset.

## 3. Capture outputs and seed synthetic data

Record the stack outputs in the deployment evidence. Set the table and bucket variables from these `ThemisData` output keys:

- `TransactionsTableName`
- `CasesTableName`
- `MerchantsTableName`
- `AuditTableName`
- `IdempotencyTableName`
- `ArtifactsBucketName`

Then seed the synthetic records using the packaged runtime:

```bash
PYTHONPATH=infra/build/agent-runtime/src:infra/build/agent-runtime \
python3 -c 'from pathlib import Path; import boto3; from bank_tools.dynamo_store import DynamoBankToolsStore, Tables; from bank_tools.fixtures import load_demo_store; load_demo_store(Path.cwd(), store=DynamoBankToolsStore(boto3.client("dynamodb"), Tables.from_env()))'
```

Confirm table counts and verify that no non-synthetic record was loaded.

## 4. Smoke-test the trusted inbound path

```bash
export INBOUND_TOPIC_ARN="$(aws cloudformation describe-stacks --stack-name ThemisMessaging --query 'Stacks[0].Outputs[?OutputKey==`InboundTopicArn`].OutputValue' --output text)"
aws sns publish \
  --topic-arn "$INBOUND_TOPIC_ARN" \
  --message "{\"originationNumber\":\"+15555550100\",\"inboundMessageId\":\"smoke-$(date +%s)\",\"messageBody\":\"I do not recognize the Asteria charges.\"}"
aws logs tail /aws/lambda/ThemisMessageNormalizer --since 5m
```

Also verify Runtime health/invocation, a Gateway tool call, Cedar allow and deny decisions, Memory continuation, an S3 report, SES receipt, channel reply, dashboard availability, and expected CloudWatch metrics. Save redacted evidence.

## 5. Rollback readiness

- Know how to disable channel ingress and outbound messaging without deleting evidence.
- Keep autonomous demo limits conservative.
- Confirm the demo account contains no real customer or financial data.
- Treat the data stack's destroy/auto-delete settings as hackathon-only; change them before any durable environment.
