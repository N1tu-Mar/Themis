# Themis

Themis is an AI-orchestrated bank-transaction dispute system. A customer reports an unfamiliar charge over RCS or SMS; Themis identifies the relevant transactions, resolves the merchant, gathers evidence, classifies the claim, evaluates deterministic policy, records the permitted outcome, and returns an auditable case report.

The repository is a synthetic-data prototype. It does not connect to a bank core, card network, real customer account, or real-money rail.

## Why Themis

A conventional dispute makes the customer coordinate the process: find transactions, complete forms, repeat context, wait for manual reconstruction, and supply additional evidence. Themis moves that coordination into one governed workflow:

```text
customer message
  -> normalize and deduplicate
  -> find affected transactions
  -> resolve merchant and collect evidence
  -> classify the dispute
  -> propose an action
  -> evaluate deterministic policy
  -> execute only an allowed action, or escalate
  -> persist the report and audit trail
  -> notify the customer
```

The model does not have unilateral authority over money or accounts:

```text
model reasoning over evidence
          |
structured tool proposal
          |
deterministic Cedar + Python policy
          |
ALLOW / DENY / REQUIRE_HUMAN_REVIEW
          |
idempotent tool execution
          |
structured audit event and case report
```

No hidden chain-of-thought is stored. Reports contain structured evidence, decisions, actions, and customer-facing rationale.

## What is implemented

- A single Python 3.12 AgentCore orchestrator with explicit case-state transitions, conversation memory adapters, safe escalation, and scenarios A–E.
- One frozen, versioned 20-tool invocation contract shared by the Gateway schema, Python dispatcher, Lambda adapter, tests, and deployment assets.
- Policy-gated synthetic banking tools backed by in-memory and DynamoDB-shaped stores, with mutation idempotency and audit records.
- Cache-first merchant intelligence with aliases, risk signals, TTL-aware durable profiles, bounded research interfaces, and cross-process cache reuse.
- RCS/SMS normalization, active reply menus, duplicate admission control, outbound retry records, delivery-event separation, SES case email, and a safe response for ambiguous AgentCore failures.
- A Next.js operations dashboard for cases, merchants, reports, and human-review requests. It uses fixtures by default and supports server-side DynamoDB/S3 reads in AWS mode.
- Five AWS CDK stacks covering data, AgentCore, messaging, observability, and Amplify hosting.
- Deterministic local end-to-end scenarios, failure injection, demo tooling, guarded AWS preflight/seeding/smoke commands, and a machine-readable release-acceptance gate.

## Architecture

```text
RCS / SMS
    |
AWS End User Messaging
    |
trusted inbound SNS topics
    |
Messaging Lambda  ---- delivery-event SNS topic
    |                  (separate handler boundary)
    v
Bedrock AgentCore Runtime
    |-- Memory: conversational continuity
    |-- Gateway: frozen 20-tool surface
    |-- Policy: deterministic Cedar authorization
    |
Tools-adapter Lambda
    |-- bank-tools
    |-- merchant-intel
    |-- case workflow
    |
    |-- DynamoDB: transactions, cases, merchants, audit, idempotency
    |-- S3: reports and evidence artifacts
    |-- Messaging Lambda: customer messages and SES email
    v
Amplify-hosted Next.js dashboard (read-only AWS data access)
```

The AgentCore Runtime does not access DynamoDB or S3 directly. It reaches the data tier through the Gateway and tools-adapter boundary. Account-impacting proposals are evaluated before execution, and ambiguous or disallowed cases are routed to human review.

See the [architecture explanation](docs/architecture/README.md) and [diagram](docs/architecture/themis.svg).

## Repository layout

```text
themis/
├── apps/dashboard/          # Next.js operations dashboard
├── services/
│   ├── agent/               # AgentCore orchestrator and workflow
│   ├── bank-tools/          # Policy-gated banking tools and stores
│   ├── merchant-intel/      # Merchant resolution, profiles, and cache
│   └── messaging/           # RCS, SMS, SNS, delivery, and SES runtime
├── packages/contracts/      # Shared TypeScript contracts and JSON Schemas
├── fixtures/                # Deterministic synthetic demo data
├── infra/                   # CDK stacks, Cedar policies, and asset staging
├── tests/integration/       # Cross-service composition and AWS ops tests
├── tests/e2e/               # Scenarios A–E and messaging reliability tests
├── scripts/demo/            # Local demo, seed, reset, and smoke tooling
├── scripts/themis_ops/      # Guarded deployed-environment operations CLI
├── docs/                    # Architecture, submission, and workstream docs
└── prompt.md                # Product specification
```

`packages/contracts` is the cross-language source of truth. TypeScript imports `@themis/contracts`; Python and deployment assets validate against the generated JSON Schema 2020-12 bundle.

## Local setup

Requirements:

- Node.js 22+
- npm
- Python 3.12 (not 3.13+)

```sh
npm ci
python3.12 -m pip install pytest setuptools wheel
npm run check
```

`npm run check` builds every workspace and runs:

- contract and fixture validation;
- dashboard component, route, and AWS-provider tests;
- messaging, idempotency, menu, delivery, and email tests;
- CDK assertions, asset staging, and credential-free synthesis;
- all Python service, integration, operational, and E2E tests;
- cross-language SNS-to-AgentCore-to-tools composition tests;
- the TypeScript messaging-boundary E2E suite.

None of these tests deploys infrastructure, sends messages, or makes paid AWS calls.

## Run the deterministic demo

```sh
scripts/demo/demo.sh 0
```

The demo runs locally against synthetic data and exercises five dispute paths: recurring unauthorized charges, charges after cancellation, a recognized merchant, contradictory authentication requiring human review, and durable merchant-cache reuse.

See [scripts/demo/RUNBOOK.md](scripts/demo/RUNBOOK.md) and the [three-minute judge script](docs/submission/demo-script.md).

## Release acceptance

Run the complete local release gate:

```sh
npm run acceptance
```

For CI or automation:

```sh
npm run acceptance:json
```

The acceptance runner verifies repository deliverables, the frozen tool contract, idempotency storage, environment documentation, the root build/test suite, Python imports and wheel builds, CDK synthesis, and packaged AWS assets. Live-provider requirements are reported as `MANUAL`; they never produce a misleading automated green result.

At the latest verified main commit, the gate reports 13 automated passes, 0 failures, 0 skips, and 5 manual live-AWS gates.

## AWS operations

The operations CLI requires an explicit account, region, and the synthetic `demo` stage. Seeding is offline and dry-run by default.

```sh
# Inspect the intended deployment target and deployed resources.
npm run ops -- preflight --account 123456789012 --region us-east-1 --stage demo

# Preview deterministic synthetic fixture seeding without AWS calls.
npm run ops -- seed --account 123456789012 --region us-east-1 --stage demo

# Read-only checks after an approved deployment and seed.
npm run ops -- smoke --account 123456789012 --region us-east-1 --stage demo

# Print validated cleanup guidance; this does not delete anything.
npm run ops -- cleanup-plan --account 123456789012 --region us-east-1 --stage demo
```

Applying a seed requires both `--apply` and an exact `ACCOUNT:REGION:demo` confirmation. Deployment, real messages, identity registration, and teardown are never performed by the local acceptance gate.

See [infra/README.md](infra/README.md) for packaging and deployment order.

## Current status and manual gates

All code workstreams are integrated on `main`, and the complete local acceptance gate passes. A live AWS deployment has not been claimed or implied.

The remaining environment-specific work is:

1. Deploy the CDK stacks in an approved AWS account and region.
2. Verify the live AgentCore Runtime, Gateway, Memory, and Cedar request/response shapes.
3. Register and attach RCS/SMS identities and verify the SES sender.
4. Connect the Amplify app to the repository through GitHub OAuth and select `main` with app root `apps/dashboard`.
5. Run an explicitly approved synthetic live-message test and inspect delivery telemetry.
6. Keep browser research disabled until a bounded source provider is approved and verified.

Before production use, Themis would also need bank-grade customer authentication, immutable audit retention, compliance review, production data governance, disaster recovery, rate limiting, and real banking integrations.

## Documentation

- [Submission guide](docs/submission/README.md)
- [Definition of done](docs/submission/definition-of-done.md)
- [Security and financial safety](docs/submission/security-and-financial-safety.md)
- [Known limitations](docs/submission/known-limitations.md)
- [AWS deployment checklist](docs/submission/aws-deployment-checklist.md)
- [Manual provider registration](docs/submission/manual-registration.md)
- [Integration status](docs/workstreams/integration.md)

All committed customer, transaction, merchant, case, message, and report data is synthetic.
