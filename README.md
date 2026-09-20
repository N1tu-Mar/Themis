# Themis

Themis is an AI-orchestrated dispute-resolution system for bank transactions. A customer texts about a charge they don't recognize; Themis handles the entire dispute workflow that would otherwise require a phone call, a web form, and a support queue.

## The problem

Today, disputing a transaction looks like this:

```text
customer notices charge
  -> calls bank
  -> automated system redirects to website/app
  -> customer finds transactions manually
  -> customer fills dispute form
  -> dispute enters queue
  -> employee reconstructs situation manually
  -> additional evidence requested
  -> customer waits
```

Themis replaces it with:

```text
customer reports problem
  -> conversational intake
  -> affected transactions found automatically
  -> transaction pattern analyzed
  -> merchant resolved
  -> evidence collected
  -> dispute type classified
  -> bank policy evaluated
  -> permitted action executed
  -> ambiguous case escalated
  -> report stored
  -> merchant intelligence updated
  -> customer notified
```

The customer should not have to orchestrate the dispute. Themis does.

## Core principle

Themis is deliberately **not** "LLM reads transaction, LLM decides fraud, LLM refunds money." The model reasons over evidence and proposes an action; it never has unilateral authority over money or accounts:

```text
LLM reasons about evidence
        |
structured proposed action
        |
deterministic policy engine
        |
allowed / denied / human approval
        |
tool execution
        |
auditable result
```

Every account-impacting action is gated by a deterministic policy engine, not model judgment, and every decision leaves an audit trail of structured evidence and rationale — never hidden chain-of-thought.

## Architecture

```text
                    CUSTOMER PHONE
                          |
                   RCS / SMS
                          |
                          v
             AWS END USER MESSAGING
                          |
                 inbound message
                          |
                          v
                    Amazon SNS
                          |
                          v
                  Messaging Lambda
                          |
               normalize + dedupe
                          |
                          v
               Bedrock AgentCore
                Themis Orchestrator
                          |
             +------------+-------------+
             |            |             |
             v            v             v
         Memory        Gateway       Browser
             |            |             |
             |       tool access    merchant web
             |            |          research
             |            v
             |      Policy Engine
             |        / Cedar
             |            |
             |            v
             |        AWS Lambda
             |       banking tools
             |            |
             |      +-----+-----+
             |      v     v     v
             |    DynamoDB S3   APIs
             |
             +------------+-------------
                          |
                          v
                    Case outcome
                     /        \
                    v          v
                 RCS/SMS       SES
               confirmation   report
```

An inbound message is normalized and handed to a single orchestrator agent (not a swarm of agents) running on Bedrock AgentCore. The orchestrator matches transactions, resolves the merchant, gathers evidence, and proposes a resolution. Every proposed action is checked against a deterministic policy engine before any banking tool executes it. Outcomes go back to the customer over RCS/SMS, with a formal case report emailed via SES.

Themis recognizes dispute types beyond "fraud," including unauthorized transactions, unrecognized merchants, recurring payments not authorized (or continued after cancellation), duplicates, wrong amounts, undelivered service/refund, and cases needing more information.

## Tech stack

| Layer | Choices |
| --- | --- |
| Frontend | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, Zod — deployed on AWS Amplify Hosting |
| Agent/backend | Python 3.12, Amazon Bedrock, Bedrock AgentCore, Strands Agents, Pydantic, Boto3 |
| Messaging | AWS End User Messaging (RCS + SMS fallback), Amazon SNS, Amazon SES |
| Data | Amazon DynamoDB (transactions, cases, merchant intelligence, audit), Amazon S3 (reports, evidence) |
| Policy | Cedar-based deterministic policy engine |
| Infra | AWS CDK, AWS Lambda, AWS Step Functions (where async workflow needs it), CloudWatch |

All customer, transaction, and merchant data used anywhere in this repo is synthetic. No real bank, card, or account integrations exist, and no real money moves.

## Repository structure

```text
themis/
├── apps/dashboard/        # Next.js case + merchant intelligence dashboard
├── services/
│   ├── agent/              # Orchestrator: prompts, state machine, tools
│   ├── bank-tools/         # Banking action tools gated by policy
│   ├── merchant-intel/     # Merchant profiles, risk signals, research
│   └── messaging/          # Inbound/outbound RCS, SMS, email adapters
├── packages/contracts/     # Shared TypeScript types + JSON Schemas (source of truth)
├── fixtures/                # Synthetic customers, transactions, merchants, cases
├── infra/                   # CDK stacks, policies, config
├── tests/e2e/                # End-to-end scenario tests
├── scripts/demo/             # Demo data loading / reset
├── docs/workstreams/         # Per-agent workstream handoffs
└── prompt.md                  # Full product specification
```

`packages/contracts` is the boundary every workstream builds against: TypeScript consumes `@themis/contracts` directly, Python services validate against the generated `packages/contracts/schemas.json` (JSON Schema 2020-12). See `packages/contracts/README.md` for the case state machine and type conventions.

## Getting started

Requires Node.js 22+ and Python 3.12.

```sh
npm ci
npm run check          # build + test all workspaces, Python suites, and the local end-to-end composition test
```

`npm run check` runs `tests/integration`: an inbound SNS event goes through the messaging runtime to the Python orchestrator, the composed tools adapter (bank-tools + merchant-intel + case workflow) behind the real Cedar policy text, and out to a captured outbound message. No AWS calls. Deploy assets are staged by `scripts/build_assets.py` (run by `npm run build --workspace=infra`); `npm run package:aws --workspace=infra` additionally vendors `boto3` into the AgentCore Runtime asset.

Build contracts and generate the synthetic demo fixtures:

```sh
npm run build --workspace @themis/contracts
node fixtures/scripts/generate-demo.mjs
npm test --workspace @themis/contracts
```

Python services create their own virtualenv as needed:

```sh
python3.12 -m venv .venv
```

## Status

This is a parallel-agent build. All services are integrated on `main` and covered by the local composition test; see `docs/workstreams/integration.md` for the frozen 20-tool ownership map and what still blocks a real AWS deployment. See `CLAUDE.md` for the operating rules that govern how work is split and merged, and `prompt.md` for the full specification.
