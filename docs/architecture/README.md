# Themis architecture

Themis turns an RCS or SMS dispute message into a governed investigation. AWS End User Messaging receives the customer message, trusted Amazon SNS topics invoke the messaging Lambda's inbound handler, and the normalized turn enters an Amazon Bedrock AgentCore Runtime. The runtime preserves conversational context in AgentCore Memory and reaches deterministic banking and merchant capabilities through an AgentCore Gateway. AgentCore Policy evaluates Cedar rules before a tool request can reach the tools-adapter Lambda.

The adapter works with synthetic transaction data and persists cases, merchant intelligence, audit records, and idempotency claims in DynamoDB. It writes generated reports and evidence to a private S3 bucket. Customer updates return through the messaging path, while outcome email uses SES. CloudWatch collects operational signals, and an Amplify-hosted dashboard provides the judge-facing operations experience.

Solid arrows in the diagram are implemented deployment paths. Dashed arrows are deliberately honest boundaries: browser-backed research is not yet connected to the deployed runtime, and the current dashboard is fixture-backed rather than connected to DynamoDB through a live API.

- Source: [themis.mmd](./themis.mmd)
- Submission image: [themis.svg](./themis.svg)

The architecture intentionally separates customer messages from provider delivery events. Distinct SNS topics invoke mutually exclusive handlers in the same messaging Lambda; each handler rejects the other payload class, so a delivery receipt can never become a customer turn.
