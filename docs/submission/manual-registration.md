# Required manual registration and verification

These steps require human action in AWS or a provider workflow. They must stay out of automated tests.

## RCS

1. Register an RCS agent in AWS End User Messaging and provide the required brand, use-case, privacy, and support information.
2. Wait for provider approval and confirm the agent is live in the selected country/region.
3. Configure two-way messaging to the CloudFormation `RcsInboundTopicArn` output.
4. Use the `SmsTwoWayRoleArn` output for the channel's SNS publish role where required.
5. Send from an allow-listed device first, then verify production routing and fallback behavior.

## SMS

1. Obtain and, where applicable, register an origination phone number, sender ID, or pool for the target country.
2. Configure inbound/two-way messaging to the `InboundTopicArn` output and authorize the provider with `SmsTwoWayRoleArn`.
3. Set `THEMIS_SMS_IDENTITY` to the actual outbound phone number or sender identity expected by the runtime. Do not assume a pool identifier is accepted by every send API.
4. Verify opt-in, opt-out, help, quiet-hours, throughput, and carrier requirements before any external test.

## Amazon SES

1. Verify `SES_SENDER_DOMAIN` and the address used by `THEMIS_SES_FROM`.
2. Publish and validate DKIM records.
3. While the account is in the SES sandbox, verify every demo recipient; otherwise request production access.
4. Confirm bounce, complaint, and suppression handling before broader use.

## Bedrock and AgentCore

1. Select model IDs available in the deployment region and confirm account access.
2. Verify live AgentCore Runtime, Gateway, Policy, and Memory resource creation.
3. Validate the deployed runtime language/auth enum values, MCP tool-name prefixes, request context passed to Cedar, and Memory API behavior against the live service.
4. Keep Browser research disabled until live Browser session creation, navigation/redirect reporting, content-size behavior, and IAM behavior are tested in the target region. A live change requires both `ENABLE_BROWSER_RESEARCH=true` and `BROWSER_RESEARCH_APPROVED=true`, plus an approved merchant source allowlist/provider; the checked-in adapter fails closed.

## Amplify

1. Connect the Amplify app to the repository through the approved Git provider/OAuth flow.
2. Select the intended branch and set the app root to `dashboard` if the build configuration requires it.
3. Verify build logs, access controls, and the public URL. The current UI remains fixture-backed until a live data API is added.

## Final channel verification

Run a controlled RCS conversation, force an SMS fallback, receive an SES email, and inspect logs without exposing message content in screenshots. Confirm that provider receipts arrive only on `DeliveryEventTopicArn`, update the matching delivery record through the delivery-only handler, and never invoke AgentCore as customer input.
