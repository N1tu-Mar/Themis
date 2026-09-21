# AWS services used

| AWS service | Role in Themis | Deployment status |
| --- | --- | --- |
| Amazon Bedrock AgentCore Runtime | Hosts the Python dispute orchestrator | Defined by CDK; live invocation pending |
| AgentCore Gateway | Exposes structured dispute tools over MCP | Defined by CDK; live schema/name compatibility pending |
| AgentCore Policy | Evaluates Cedar authorization for consequential tools | Defined by CDK and locally tested; live enforcement pending |
| AgentCore Memory | Stores conversation context | Defined by CDK; live memory API behavior pending |
| AgentCore Browser | Optional merchant research transport | Disabled by default; IAM requires enablement plus approval. The checked-in runtime uses a deterministic unavailable provider pending live API verification. |
| Amazon Bedrock | Supplies fast and reasoning foundation models | IAM and model IDs are configured; live access pending |
| AWS End User Messaging | Receives RCS/SMS and sends channel replies | Infrastructure is defined; identities require manual registration |
| Amazon SNS | Separates inbound RCS/SMS messages from delivery events | Distinct topics invoke mutually exclusive handlers in the messaging Lambda |
| AWS Lambda | Runs the messaging normalizer and Gateway tools adapter | Packaged and locally asserted |
| Amazon DynamoDB | Stores transactions, cases, merchant profiles, audit records, and idempotency claims | Tables, environment, and least-scope grants are defined |
| Amazon S3 | Stores generated reports, evidence, and research artifacts | Private encrypted bucket, logical prefixes, and resource-scoped access are defined |
| Amazon SES | Sends outcome email | Sender configuration is defined; identity verification is manual |
| AWS Amplify | Hosts the operations dashboard | App and branch are defined; repository connection is manual |
| Amazon CloudWatch | Provides logs, metrics, alarms, and an operations dashboard | Defined for deployed components |
| AWS CloudFormation / CDK | Reproducibly defines and deploys the five stacks | Synthesized and assertion-tested locally |
| AWS IAM | Gives each runtime and Lambda only the resources/actions it needs | Defined and covered by infrastructure assertions |

The five stacks are `ThemisData`, `ThemisAgent`, `ThemisMessaging`, `ThemisObservability`, and `ThemisWeb`.
