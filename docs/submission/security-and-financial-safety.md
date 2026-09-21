# Security and financial safety

Themis treats model output as a proposal, not authority. Consequential tool calls cross AgentCore Gateway and are evaluated by deterministic Cedar policy. Low-value, high-confidence demo credits can follow the autonomous path only within configured limits; uncertain, unsupported, ambiguous, or higher-risk cases require human review.

The safety boundary is reinforced by design:

- All customers, accounts, transactions, credits, and disputes are synthetic. No real financial account is connected and no real money can move.
- The agent has no direct database credentials or unrestricted AWS SDK surface. It calls typed Gateway tools, and the tools adapter receives resource-scoped IAM grants to named tables, the artifact bucket, and the messaging function.
- Inbound RCS/SMS topics and provider delivery-event topics are separate. Delivery receipts are not subscribed to the customer-message normalizer.
- The messaging path uses idempotency records to reduce repeated processing and outbound sends.
- DynamoDB records support durable cases, merchant profiles, audit history, and expiring idempotency claims. S3 blocks public access, requires TLS, encrypts stored objects, and applies a 30-day lifecycle to research artifacts.
- SES sending is constrained to the configured sender identity. Messaging permissions are limited to channel sending and the intended topics.
- CloudWatch alarms expose Lambda errors, policy denials, tool failures, and human-review signals.
- Secrets and registered channel identities are deployment inputs, not committed fixtures.

Financial controls remain deterministic even when the model is persuasive. The agent cannot raise its own limit, rewrite Cedar policy, or convert weak evidence into approval. Missing context produces a question or escalation rather than a fabricated conclusion.

For a production launch, Themis would also require bank-grade authentication, authorization and consent, encryption-key governance, PII minimization, formal retention schedules, fraud/AML review, model-risk validation, audit immutability, accessibility review, incident response, and regulatory/legal approval. Those controls are outside this hackathon prototype.
