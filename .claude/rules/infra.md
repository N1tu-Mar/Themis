---
paths:
  - "infra/**"
---

# Infrastructure workstream

- Infrastructure as code: AWS CDK.
- Core services: AWS End User Messaging, SNS, SES, Bedrock/AgentCore, Lambda, DynamoDB, S3, CloudWatch; Step Functions only where asynchronous workflow truly needs it.
- Separate logical areas for data, messaging, agent/tools/policy, observability, and web without creating dozens of tiny stacks.
- Least-privilege IAM where practical.
- No real bank integrations or real financial actions.
- Do not introduce EKS/Kubernetes, Kafka, Redis, Neo4j, OpenSearch, service mesh, or another database without a hard requirement.
- Environment/model/policy thresholds belong in configuration, not scattered literals.
- Optimize for reproducible hackathon deployment, not production-enterprise complexity.
