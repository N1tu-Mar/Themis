# Known limitations

This hackathon prototype deliberately prioritizes a safe, demonstrable dispute workflow over production breadth.

- No live AWS deployment or provider identity registration is proven by the repository. CDK synthesis, packaging, assertions, and local composition are the current evidence.
- AgentCore Runtime, Gateway, Policy, and Memory resource shapes still require live regional verification, including MCP tool naming and Cedar request context.
- The deployed runtime currently uses the no-research adapter. AgentCore Browser permission is optional, but browser-backed merchant research is not connected.
- Delivery-event routing and durable status updates are implemented, but the provider's live event shapes and timing still require verification against a registered identity.
- The Amplify dashboard is fixture-backed. It does not read live DynamoDB data, and review controls update local browser state only.
- Delivery idempotency reduces duplicates, but there is no send lock for concurrent redeliveries. A crash between sending and recording the result can require operator reconciliation, and menu-record gaps are not automatically repaired.
- SES, RCS, and SMS deliverability depend on manual identity approval, sandbox status, country rules, carrier behavior, and provider quotas.
- Customer identity is a synthetic phone-to-customer mapping, not bank-grade authentication.
- Merchant intelligence is bounded prototype data, not a verified commercial merchant-identity source. External research must not be inferred when Browser is disabled.
- All financial actions are simulated against synthetic fixtures. There is no integration with a bank core, card network, merchant acquirer, or real-money credit rail.
- Data-stack deletion and bucket auto-empty behavior are suitable for a disposable demo environment, not production retention requirements.
- Production controls such as PII governance, KMS key ownership, WAF/rate limiting, immutable audit retention, disaster recovery, fraud operations, compliance approval, and accessibility certification remain out of scope.
