# Known limitations

This hackathon prototype deliberately prioritizes a safe, demonstrable dispute workflow over production breadth.

- No live AWS deployment or provider identity registration is proven by the repository. CDK synthesis, packaging, assertions, and local composition are the current evidence.
- AgentCore Runtime, Gateway, Policy, and Memory resource shapes still require live regional verification, including MCP tool naming and Cedar request context.
- The checked-in runtime uses a deterministic unavailable Browser provider. AgentCore Browser remains disabled by default and requires both enablement and `BROWSER_RESEARCH_APPROVED`; live session creation, URL/navigation response shape, redirect reporting, content limits, and regional IAM behavior still require deployment verification before wiring a live transport.
- Delivery-event routing and durable status updates are implemented, but the provider's live event shapes and timing still require verification against a registered identity.
- The dashboard defaults to fixtures; `THEMIS_DASHBOARD_DATA_SOURCE=aws` enables server-side DynamoDB/S3 reads, which are not yet verified against a deployed stack. It is read-only: there is no review-decision API.
- Delivery idempotency reduces duplicates, and a scheduled reconciler resumes claims stranded after admission from their delivery record without replaying AgentCore. Concurrent redeliveries of one reply can still double-send (no send lock), a crash between recording a reply and persisting its menu is not repaired, and QUARANTINED claims emit a metric but no alarm.
- SES, RCS, and SMS deliverability depend on manual identity approval, sandbox status, country rules, carrier behavior, and provider quotas.
- Customer identity is a synthetic phone-to-customer mapping, not bank-grade authentication.
- Merchant intelligence is bounded prototype data, not a verified commercial merchant-identity source. External research must not be inferred when Browser is disabled.
- All financial actions are simulated against synthetic fixtures. There is no integration with a bank core, card network, merchant acquirer, or real-money credit rail.
- Data-stack deletion and bucket auto-empty behavior are suitable for a disposable demo environment, not production retention requirements.
- Production controls such as PII governance, KMS key ownership, WAF/rate limiting, immutable audit retention, disaster recovery, fraud operations, compliance approval, and accessibility certification remain out of scope.
