# Request: implement the inbound-message normalizer Lambda

From: infra (`agent/infra/aws`)
To: messaging

## What infra provisioned

SNS topic `ThemisInboundMessaging` (`infra/stacks/messaging-stack.ts`) is the
two-way inbound destination for both channels. One Lambda
(`ThemisMessageNormalizer`) is subscribed to it; its code currently comes
from `infra/lambda/message-normalizer/handler.py`, a placeholder that logs
and returns `not_implemented` for every SNS record.

## What you need to implement

Replace the placeholder with real normalization:

1. Idempotency: `IDEMPOTENCY_TABLE` (DynamoDB) is granted read/write. Do a
   conditional put keyed on the provider's inbound message id
   (`ConditionExpression=attribute_not_exists(idempotencyKey)`) before acting
   - prompt.md #31 requires this; a retried SNS delivery must not create a
     second case.
2. Normalize the SNS record body into the `InboundMessage` shape from
   `packages/contracts` (channel, customerExternalId, messageId, text,
   postback, receivedAt).
3. Forward to the agent: `AGENT_RUNTIME_ARN` is set in the environment and
   `bedrock-agentcore:InvokeAgentRuntime` is granted on exactly that ARN.
   Don't call Bedrock directly from here.

`ENABLE_RCS` / `ENABLE_SMS_FALLBACK` are also in the environment if you need
to branch on which channels are live.

## Manual AWS-side steps infra could not automate

CDK/CloudFormation has no resource type for AWS End User Messaging Social
(RCS) as of the installed `aws-cdk-lib` version - RCS sender/agent
registration is console/API-only. And provisioning a real SMS origination
identity (`AWS::SMSVOICEV2::PhoneNumber`/`Pool`) via CDK would mean carrier
registration that can take days and has an ongoing cost, which isn't
reproducible on a hackathon timeline - so infra provisioned the reusable
piece (topic, IAM role, delivery-event `ConfigurationSet`) but not the number
itself. Before this can receive live traffic:

1. **RCS**: in the End User Messaging Social console, register an RCS agent
   and set its two-way destination to the `ThemisInboundMessaging` topic ARN
   (see stack output `InboundTopicArn`).
2. **SMS**: provision a phone number or pool (console or `aws pinpoint-sms-voice-v2`),
   set `twoWay.enabled = true`, `twoWay.channelArn` = the same topic ARN, and
   `twoWay.channelRole` = the `ThemisSmsTwoWayRole` ARN (stack output
   `SmsTwoWayRoleArn`) so the service has publish permission already granted.

Until either is done, `THEMIS_MODE=local` mocks both channels per prompt.md
#50 - local development and tests do not need this manual step.
