# THEMIS

## AWS CDS Agentic AI Hackathon — Master Build Specification

**Project:** Themis
**Hackathon:** AWS Communication Developer Services Agentic AI Partner Hackathon
**Product category:** Agentic banking dispute resolution + merchant-risk intelligence
**Primary interface:** AWS End User Messaging RCS with SMS fallback
**Primary AI infrastructure:** Amazon Bedrock + Amazon Bedrock AgentCore

Themis is named after the Greek personification of law, justice, order, and fair judgment.

---

# 0. READ THIS BEFORE WRITING CODE

You are contributing to **Themis**.

The repository may be modified by multiple Claude Code agents at the same time.

Your job is not to independently redesign Themis.

Your job is to implement the smallest correct portion of the architecture assigned to your branch while preserving compatibility with the rest of the system.

The priorities are:

1. Working product.
2. Correct AWS CDS runtime integration.
3. Demonstrable agentic behavior.
4. Financial-action safety.
5. Low LLM/token consumption.
6. Parallel development without merge conflicts.
7. Frequent recoverable Git checkpoints.
8. Simple architecture.
9. Strong demo reliability.
10. No unnecessary features.

Do not optimize for cleverness.

Do not create abstractions merely because they might theoretically become useful.

Do not turn this into a production banking core.

Build the hackathon product described here.

---

# 1. ABSOLUTE DEVELOPMENT RULES

These rules override normal coding-agent behavior.

## 1.1 Do not burn tokens understanding the entire repository

Never begin with:

* reading every file;
* recursively opening the repository;
* explaining the entire architecture back to the user;
* searching every dependency;
* reading unrelated workstreams;
* repeatedly re-reading `prompt.md`;
* creating an exhaustive implementation plan after one already exists here.

At session start, read only:

1. this `prompt.md`;
2. your assigned workstream document if one exists;
3. `git status --short`;
4. `git branch --show-current`;
5. the files directly relevant to your task.

Use targeted repository inspection.

Prefer:

```bash
rg "ExactThingIAmLookingFor" path/to/workstream
rg --files path/to/workstream | head -80
sed -n '120,220p' path/to/file
git diff --stat
git diff -- path/to/file
```

Avoid dumping entire large files when a targeted region is enough.

Do not inspect `node_modules`, `.next`, build artifacts, coverage output, generated CDK output, binary files, or large fixture datasets unless specifically necessary.

---

## 1.2 Implementation beats discussion

Once the requirements are understood, implement.

Do not consume large amounts of context repeatedly explaining what you intend to do.

A work cycle should generally be:

```text
inspect narrowly
→ implement
→ targeted test
→ commit
→ continue
```

Not:

```text
inspect entire repo
→ produce essay
→ inspect entire repo again
→ create speculative architecture
→ rewrite plan
→ eventually code
```

---

## 1.3 Do not browse documentation unnecessarily

The architecture in this document is authoritative for the hackathon build.

Use external documentation only when:

* an AWS API signature is uncertain;
* a package/API changed;
* a deployment command is failing;
* an integration cannot be implemented safely from existing context.

When documentation is required:

* search the exact problem;
* prefer official AWS documentation;
* inspect the minimum relevant section;
* return immediately to implementation.

Do not perform broad research.

---

# 2. GIT + MULTI-AGENT DEVELOPMENT CONTRACT

Multiple coding agents will work concurrently.

Preventing collisions is mandatory.

---

# 2.1 Main and integration branches

`main` is protected conceptually.

Worker agents must never directly implement on `main`.

Use:

```text
main
 └── integration
      ├── agent/contracts/<task>
      ├── agent/frontend/<task>
      ├── agent/bank-tools/<task>
      ├── agent/agentcore/<task>
      ├── agent/messaging/<task>
      ├── agent/infra/<task>
      └── agent/qa/<task>
```

If an assigned worker begins on `main` or `integration`, create its branch before making code changes.

Example:

```bash
git switch integration
git switch -c agent/agentcore/dispute-orchestrator
```

Prefer separate Git worktrees for simultaneous agents.

Example:

```bash
git worktree add ../themis-agentcore agent/agentcore/dispute-orchestrator
git worktree add ../themis-frontend agent/frontend/dashboard
git worktree add ../themis-messaging agent/messaging/rcs
```

Each coding agent should operate in its own worktree.

---

# 2.2 NO PUSHING

Worker agents MUST NOT run:

```bash
git push
```

Do not push automatically.

Do not force push.

Do not publish branches.

The user or designated integration process will decide when anything is pushed.

Local commits are required.

Remote pushes are forbidden unless the user explicitly overrides this rule.

---

# 2.3 Commit every 3–5 minutes

While actively changing code, create a small checkpoint commit approximately every **3–5 minutes**.

Never allow a large pile of unrelated uncommitted changes to accumulate.

If there is a coherent change available at approximately three minutes, commit it.

If a coherent unit takes closer to five minutes, commit it then.

If a task finishes in under three minutes, commit when it finishes.

Do NOT create empty commits merely to satisfy the timer.

Do NOT interrupt a file halfway through a syntactically invalid edit solely to commit.

Examples:

```bash
git add services/agent/src/orchestrator.py
git commit -m "feat(agent): add dispute intake state machine"
```

then:

```bash
git add services/agent/src/tools/
git commit -m "feat(agent): wire transaction search tools"
```

then:

```bash
git add services/agent/tests/
git commit -m "test(agent): cover unknown merchant intake"
```

Prefer:

```bash
git add <specific-owned-files>
```

Do not use:

```bash
git add -A
```

unless you have verified every staged file belongs to your workstream.

Checkpoint commits are desirable. They can be squashed later.

---

# 2.4 Never rewrite another agent's history

Workers must not:

* rebase another agent's branch;
* amend another agent's commits;
* reset another branch;
* cherry-pick unrequested work;
* merge another worker branch;
* delete another worker's files;
* modify another worktree;
* force-reset shared branches.

The integration agent owns local integration.

---

# 2.5 Strict file ownership

Parallel work is divided by directory.

### Contracts agent

Owns:

```text
packages/contracts/**
fixtures/**
```

### Frontend agent

Owns:

```text
apps/dashboard/**
```

### Bank tools agent

Owns:

```text
services/bank-tools/**
```

### AgentCore agent

Owns:

```text
services/agent/**
services/merchant-intel/**
```

### Messaging agent

Owns:

```text
services/messaging/**
```

### Infrastructure agent

Owns:

```text
infra/**
```

### QA/demo agent

Owns:

```text
tests/e2e/**
scripts/demo/**
```

### Integration agent

Owns shared/root files:

```text
README.md
prompt.md
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
pyproject.toml
uv.lock
.gitignore
.env.example
Makefile
docker-compose.yml
docs/architecture/**
docs/submission/**
```

Only the integration agent should modify root dependency lockfiles after parallel development begins.

---

# 2.6 Cross-workstream change requests

If your task requires editing a file owned by another workstream:

DO NOT EDIT IT.

Create a uniquely named handoff:

```text
.handoffs/<your-workstream>/<timestamp>-<short-description>.md
```

Example:

```text
.handoffs/frontend/20260917-request-case-status-field.md
```

Keep it short:

```text
Need:
CaseSummary.status to include NEEDS_HUMAN_REVIEW.

Reason:
Dashboard review queue requires it.

Requested owner:
contracts
```

Then continue with work that does not require the change.

Do not block the entire task when a safe stub/interface can be used temporarily.

---

# 2.7 Dependency changes

Dependency files are high-conflict files.

Worker agents should not casually install packages.

Before requesting a new dependency:

1. check whether the functionality already exists;
2. prefer the standard library;
3. prefer AWS SDK functionality already installed;
4. prefer a tiny local helper over a dependency for trivial behavior.

If a new package is genuinely required, create:

```text
.handoffs/dependencies/<workstream>-<package>.md
```

Include:

```text
package:
reason:
workstream:
required or optional:
```

The integration agent installs and pins dependencies centrally.

---

# 3. PRODUCT THESIS

Today, a customer notices an unfamiliar transaction and often experiences something like:

```text
customer notices charge
→ calls bank
→ automated system redirects to website/app
→ customer finds transactions manually
→ customer fills dispute form
→ dispute enters queue
→ employee reconstructs situation manually
→ additional evidence requested
→ customer waits
```

Themis replaces this with:

```text
customer reports problem
→ conversational intake
→ affected transactions found automatically
→ transaction pattern analyzed
→ merchant resolved
→ evidence collected
→ dispute type classified
→ bank policy evaluated
→ permitted action executed
→ ambiguous case escalated
→ report stored
→ merchant intelligence updated
→ customer notified
```

The customer should not be responsible for orchestrating the dispute workflow.

Themis performs the orchestration.

---

# 4. CORE PRODUCT PRINCIPLE

Themis must NOT be implemented as:

> LLM reads transaction → LLM decides fraud → LLM refunds money.

The system must instead be:

```text
LLM reasons about evidence
        ↓
structured proposed action
        ↓
deterministic policy engine
        ↓
allowed / denied / human approval
        ↓
tool execution
        ↓
auditable result
```

The model may reason.

The model does not possess unrestricted authority.

---

# 5. MVP USER STORY

Primary demonstration:

A customer notices several recurring charges from an unfamiliar merchant.

The customer sends:

> I keep getting charged $9.99 every week and I don't recognize the company.

Themis should:

1. understand the complaint;
2. ask only necessary follow-up questions;
3. search the customer's synthetic transaction history;
4. identify matching transactions;
5. ask the customer to confirm them;
6. classify the dispute;
7. resolve the merchant identity;
8. inspect relevant transaction/authentication signals;
9. load existing bank merchant intelligence;
10. research the merchant externally only if needed;
11. assemble structured evidence;
12. propose a resolution;
13. run the action through deterministic policy;
14. execute safe permitted actions or escalate;
15. generate a case report;
16. save the case;
17. update the merchant intelligence profile;
18. send the customer a confirmation;
19. send a formal case email through SES.

---

# 6. DO NOT USE A REAL COMPANY FOR THE DEMO

The synthetic demo merchant should be:

**Asteria Digital**

Example descriptor aliases:

```text
ASTERIA.IO
ASTERIA*PREMIUM
ASTDIGITAL
ASTERIA SUB
```

Use fictional companies and fictional customers in seed data.

Do not characterize a real business as fraudulent.

External-web intelligence is supporting evidence only.

---

# 7. DISPUTE TYPES

Themis should distinguish at minimum:

```text
UNAUTHORIZED_TRANSACTION

UNRECOGNIZED_MERCHANT

RECURRING_PAYMENT_NOT_AUTHORIZED

RECURRING_PAYMENT_AFTER_CANCELLATION

DUPLICATE_TRANSACTION

WRONG_AMOUNT

SERVICE_NOT_RECEIVED

REFUND_NOT_RECEIVED

OTHER_MERCHANT_DISPUTE

INSUFFICIENT_INFORMATION
```

Do not treat all disputes as fraud.

---

# 8. PRIMARY ARCHITECTURE

Use the following architecture unless there is a blocking technical reason.

```text
                    CUSTOMER PHONE
                          │
                   RCS / SMS
                          │
                          ▼
             AWS END USER MESSAGING
                          │
                 inbound message
                          │
                          ▼
                    Amazon SNS
                          │
                          ▼
                  Messaging Lambda
                          │
               normalize + dedupe
                          │
                          ▼
               Bedrock AgentCore
                Themis Orchestrator
                          │
             ┌────────────┼─────────────┐
             │            │             │
             ▼            ▼             ▼
         Memory        Gateway       Browser
             │            │             │
             │       tool access    merchant web
             │            │          research
             │            ▼
             │      Policy Engine
             │        / Cedar
             │            │
             │            ▼
             │        AWS Lambda
             │       banking tools
             │            │
             │      ┌─────┼─────┐
             │      ▼     ▼     ▼
             │    DynamoDB S3   APIs
             │
             └────────────┬─────────────
                          │
                          ▼
                    Case outcome
                     /        \
                    /          \
                   ▼            ▼
                 RCS/SMS       SES
               confirmation   report
```

---

# 9. TECH STACK

## Frontend

```text
Next.js
React
TypeScript
Tailwind CSS
shadcn/ui
Zod
```

Dashboard deployment:

```text
AWS Amplify Hosting
```

Do not add Redux.

Use React state and server/API requests unless a genuine need arises.

---

## Agent/backend

```text
Python 3.12
Amazon Bedrock
Amazon Bedrock AgentCore
Strands Agents where useful
Pydantic
Boto3
```

Do not introduce LangChain unless an AgentCore integration absolutely requires functionality unavailable through the chosen implementation.

Do not create a custom agent framework.

---

## AWS services

Use:

```text
AWS End User Messaging
  - RCS
  - SMS fallback

Amazon SNS
  - inbound messaging events

Amazon SES
  - formal dispute email

Amazon Bedrock
  - model inference

Amazon Bedrock AgentCore
  - agent runtime/harness
  - gateway
  - memory
  - policy
  - browser

AWS Lambda
  - banking tools
  - message normalization
  - service adapters

Amazon DynamoDB
  - transactions
  - cases
  - merchant intelligence
  - audit metadata

Amazon S3
  - reports
  - evidence snapshots

Amazon CloudWatch
  - logs
  - metrics
  - auditability

AWS Step Functions
  - only where asynchronous case workflow requires it

AWS CDK
  - infrastructure as code
```

Avoid unnecessary infrastructure.

Do not use:

```text
EKS
Kubernetes
Kafka
self-hosted Redis
Neo4j
Elasticsearch/OpenSearch
multiple vector databases
custom service mesh
```

unless a hard requirement appears that cannot reasonably be solved by the selected stack.

---

# 10. PRODUCT AGENT ARCHITECTURE

The product itself should NOT be a swarm of LLM agents for the MVP.

Use one main orchestration agent:

```text
Themis Orchestrator
```

It has narrow capabilities corresponding conceptually to:

```text
intake
investigation
resolution
reporting
```

These can be implemented as deterministic stages, prompt modes, or internal modules.

Do not invoke four separate expensive LLM agents merely because there are four logical responsibilities.

Agentic behavior comes from:

```text
reasoning
+
tool selection
+
memory
+
multi-step execution
+
policy-controlled action
```

not from agent count.

---

# 11. AGENT TOOL SURFACE

Expose narrow tools through AgentCore Gateway.

Target tool set:

```text
search_transactions
get_transaction_details
get_transaction_auth_signals

find_related_transactions

get_customer_dispute_history

resolve_merchant
get_merchant_profile
get_merchant_risk_signals

get_case
create_case
update_case

save_evidence
generate_case_report

propose_payment_block
propose_card_replacement
propose_dispute_creation
propose_provisional_credit

escalate_case

send_customer_message
send_case_email
```

Tools must have strict structured schemas.

Do not give the model:

```text
execute_sql(query)
run_shell(command)
write_anything_to_database(payload)
perform_arbitrary_http_request(url)
```

Those tool interfaces are too broad.

---

# 12. TOOL DESIGN STANDARD

Each tool should:

* perform exactly one conceptual operation;
* validate input;
* return compact structured JSON;
* expose only fields relevant to reasoning;
* be idempotent where possible;
* include explicit success/error state;
* avoid sending huge datasets into the model.

Example:

```json
{
  "status": "ok",
  "transactions": [
    {
      "id": "txn_104",
      "merchantDescriptor": "ASTERIA.IO",
      "amount": 9.99,
      "date": "2026-09-01",
      "recurring": true
    }
  ],
  "count": 6,
  "total": 59.94
}
```

Not:

```json
{
  "customer": "... 600 fields ...",
  "completeAccountHistory": [...5000 transactions...],
  "rawProcessorPayload": {...},
  "rawNetworkData": {...}
}
```

---

# 13. TOKEN-EFFICIENT PRODUCTION AGENT

Themis itself must minimize Bedrock consumption.

This is mandatory.

## 13.1 Deterministic preprocessing first

Do not ask the LLM to search thousands of transactions.

Use code first.

Example:

```text
customer says:
"$10 weekly from Asteria"

deterministic filtering:
amount approximately 10
descriptor approximately Asteria
recent date window
recurring pattern

result:
6 candidates

LLM sees:
6 candidates
```

Not 4,000 transactions.

---

## 13.2 One reasoning call per conversational turn when possible

Target:

```text
1 model inference
+
0–3 tool calls
+
final response
```

Complex investigations may exceed this.

Do not create repeated self-reflection loops by default.

---

## 13.3 Hard investigation budget

Default case budget:

```text
Maximum model turns during automated investigation: 8

Maximum external merchant browser pages: 5

Maximum merchant-intelligence searches: 1 per uncached merchant investigation

Maximum retrieved historical merchant cases sent to model: 5 summaries

Maximum AgentCore long-term memory results: 3 relevant records

Maximum candidate transactions shown to model at once: 20
```

If additional work is needed:

```text
summarize
→ persist state
→ continue only when materially necessary
```

---

# 13.4 Merchant cache

External merchant research is expensive.

Never re-research a merchant on every dispute.

Store:

```text
merchant_id
canonical_name
aliases
domain
product_names
billing_patterns
risk_signals
source_summary
last_researched_at
expires_at
intel_version
```

Workflow:

```text
resolve merchant
     ↓
cached intelligence exists?
     │
   yes ─────→ use cache
     │
     no
     ↓
browser research
     ↓
structured summary
     ↓
cache result
```

Default demo TTL:

```text
7 days
```

Make configurable.

---

# 13.5 Do not repeatedly feed raw conversation history

Use AgentCore Memory for continuity, but send the model:

```text
current message
+
compact case state
+
recent relevant turns
+
retrieved relevant memories
```

Do not continuously inject the complete transcript.

Maintain:

```text
case_summary
confirmed_facts
open_questions
evidence_refs
current_stage
```

---

# 13.6 Structured state instead of prose memory

Primary case state should be JSON/typed data.

Example:

```json
{
  "caseId": "case_001",
  "stage": "INVESTIGATING",
  "claimType": "UNRECOGNIZED_MERCHANT",
  "confirmedTransactionIds": [
    "txn_101",
    "txn_109",
    "txn_117"
  ],
  "customerStatements": {
    "recognizesMerchant": false,
    "contactedMerchant": true,
    "merchantResponse": "No account located"
  },
  "openQuestions": [],
  "evidenceRefs": [
    "ev_001",
    "ev_002"
  ]
}
```

The LLM reasons over this compact state.

---

# 13.7 No multi-agent debates

Do not implement:

```text
agent A makes decision
agent B critiques
agent C critiques B
agent D votes
```

This wastes tokens.

Use:

```text
one orchestrator
+
structured evidence
+
deterministic validation
+
human escalation when uncertain
```

---

# 13.8 Model routing

Model IDs must come from configuration.

Example:

```text
BEDROCK_MODEL_ID_FAST=
BEDROCK_MODEL_ID_REASONING=
```

Normal intake, extraction, and straightforward decisions should use the lower-cost configured model.

Only use the stronger reasoning model when:

```text
evidence conflicts
OR
policy requires deeper review
OR
confidence < threshold
```

Do not hardcode model IDs throughout the codebase.

---

# 14. CASE STATE MACHINE

Use an explicit state machine.

```text
NEW

INTAKE

TRANSACTION_MATCHING

AWAITING_TRANSACTION_CONFIRMATION

CLASSIFYING_DISPUTE

INVESTIGATING

AWAITING_CUSTOMER_INFORMATION

AWAITING_MERCHANT_EVIDENCE

RESOLUTION_PROPOSED

POLICY_REVIEW

NEEDS_HUMAN_REVIEW

ACTION_APPROVED

RESOLVED

CLOSED
```

Every case must have one state.

Do not represent workflow stage only through chat history.

---

# 15. CUSTOMER INTAKE

When someone reports a suspicious transaction, the agent should gather only information that changes the investigation.

Good questions:

```text
Do you recognize this merchant under another name?

Did you ever subscribe to this service?

Did you cancel it?

Have you contacted the merchant?

What happened when you contacted them?

Are all of these transactions unfamiliar?
```

Avoid making the customer complete a twenty-question questionnaire.

Use transaction data to answer questions the bank already knows.

---

# 16. TRANSACTION MATCHING

User:

> I've been getting charged around $10 every week by Asteria.

The deterministic tool should return:

```text
6 × $9.99
1 × $19.99 unrelated
```

The agent should propose:

> I found six $9.99 recurring charges from Asteria Digital totaling $59.94. Are these the charges you mean?

Allow:

```text
Confirm all
Select specific transactions
None of these
```

With RCS, use structured suggestions/postbacks when practical.

---

# 17. EVIDENCE GRAPH

Every investigation creates structured evidence.

Core categories:

```text
CUSTOMER CLAIMS

TRANSACTION EVIDENCE

AUTHENTICATION EVIDENCE

MERCHANT IDENTITY

MERCHANT HISTORY

BANK HISTORY

EXTERNAL MERCHANT INTELLIGENCE

CONTRADICTORY EVIDENCE

MISSING EVIDENCE
```

Example:

```json
{
  "evidenceId": "ev_201",
  "caseId": "case_001",
  "category": "TRANSACTION_EVIDENCE",
  "type": "RECURRING_PATTERN",
  "claim": "Six matching $9.99 charges occurred approximately seven days apart.",
  "source": "BANK_LEDGER",
  "reliability": "HIGH",
  "transactionIds": [
    "txn_101",
    "txn_109",
    "txn_117"
  ]
}
```

Do not store hidden chain-of-thought.

Store evidence and concise decision rationale.

---

# 18. AUTHENTICATION SIGNALS

Synthetic transaction records may include:

```text
card_present
cvv_match
avs_match
3ds_status
wallet_token
device_id
ip_region
merchant_id
recurring_indicator
prior_merchant_relationship
```

These are evidence.

They do not independently determine guilt or fraud.

---

# 19. MERCHANT INTELLIGENCE

Merchant resolution should support aliases.

Example:

```text
ASTERIA.IO
ASTERIA*PREMIUM
ASTDIGITAL
ASTERIA SUB
```

may resolve to:

```text
Asteria Digital
```

Store a canonical merchant entity.

---

# 20. EXTERNAL WEB RESEARCH

Use AgentCore Browser only when:

```text
merchant is unknown
OR
cached merchant intelligence is stale
OR
a specific missing merchant fact matters
```

Research may inspect:

```text
official merchant website
pricing
subscription terms
cancellation information
publicly available company identity
limited public complaint patterns
```

Do not perform unlimited scraping.

Do not scrape logged-in/private services.

Do not attempt to bypass anti-bot measures.

Do not characterize a merchant as fraudulent merely because complaints exist.

Use language such as:

```text
elevated complaint pattern
recurring billing complaints observed
merchant identity unresolved
additional verification recommended
```

---

# 21. MERCHANT INSTITUTIONAL MEMORY

After cases are resolved, update the merchant profile.

Example:

```json
{
  "merchantId": "merchant_asteria",
  "canonicalName": "Asteria Digital",
  "aliases": [
    "ASTERIA.IO",
    "ASTERIA*PREMIUM",
    "ASTDIGITAL"
  ],
  "billingPatterns": [
    {
      "amount": 9.99,
      "cadenceDays": 7
    }
  ],
  "caseStatistics": {
    "totalCases": 61,
    "resolvedCustomerDisputes": 39,
    "openCases": 8
  },
  "riskSignals": [
    {
      "type": "UNRECOGNIZED_RECURRING_SPIKE",
      "severity": "ELEVATED"
    }
  ]
}
```

Historical complaints should not create a permanent blacklist.

Merchant risk is time-aware.

Risk signals should be capable of decaying.

---

# 22. PROACTIVE PROTECTION

The merchant-intelligence system should make future detection faster.

Example:

```text
new recurring transaction
        ↓
merchant profile matched
        ↓
known elevated complaint pattern
        ↓
risk rule triggers customer verification
        ↓
RCS:

"We noticed a new recurring $9.99 charge
from Asteria Digital. Do you recognize it?"

[Yes]
[No]
[I canceled this]
```

For MVP, proactive detection may run against synthetic transactions through a scheduled/demo trigger.

Do not implement a full real-time payment processor.

---

# 23. RESOLUTION OUTPUT

The agent does not output:

```text
FRAUD = TRUE
```

Instead:

```json
{
  "classification": "RECURRING_PAYMENT_NOT_AUTHORIZED",
  "confidence": 0.89,
  "supportingEvidence": [
    "ev_101",
    "ev_103",
    "ev_109"
  ],
  "contradictoryEvidence": [],
  "missingEvidence": [
    "merchant_authorization_record"
  ],
  "recommendedActions": [
    "CREATE_DISPUTE",
    "REVIEW_FUTURE_RECURRING_PAYMENT"
  ],
  "requiresHumanReview": false
}
```

---

# 24. POLICY ENGINE

Anything capable of changing money, access, or customer account state must pass through deterministic policy.

Use AgentCore Policy / Cedar.

Conceptual rules:

```text
read account transactions
→ allowed for authenticated case context

create draft dispute case
→ allowed

save investigation report
→ allowed

send informational customer message
→ allowed

request merchant evidence
→ allowed

provisional credit
→ policy threshold

permanent merchant payment block
→ policy-controlled

card closure
→ human approval

large-dollar dispute resolution
→ human approval

deny customer dispute
→ human approval for MVP
```

Do not rely on the LLM system prompt for enforcement.

---

# 25. DEMO POLICY RULES

Because this is synthetic banking infrastructure, actions are simulations.

Example policies:

```text
CREATE_DISPUTE
permit when case has confirmed transactions.

PROVISIONAL_CREDIT
permit only when:
amount <= DEMO_AUTONOMOUS_CREDIT_LIMIT
AND
confidence >= DEMO_CREDIT_CONFIDENCE_THRESHOLD
AND
case classification is eligible.

BLOCK_RECURRING_MERCHANT
permit only when customer explicitly requested the action.

REPLACE_CARD
require human review.

DENY_CASE
require human review.
```

Thresholds belong in configuration, not scattered magic numbers.

---

# 26. HUMAN REVIEW

Themis should escalate when:

```text
evidence materially conflicts

customer identity is uncertain

transaction matching is uncertain

merchant cannot be resolved

high-impact action requested

policy denies automated action

confidence below configured threshold

required evidence is missing

model/tool failure prevents safe resolution
```

Human queue record:

```json
{
  "caseId": "case_001",
  "reason": "CONFLICTING_AUTHORIZATION_EVIDENCE",
  "summary": "Customer denies authorization but transaction passed strong authentication.",
  "recommendedNextStep": "Review merchant authorization evidence.",
  "evidenceRefs": [
    "ev_201",
    "ev_202"
  ]
}
```

---

# 27. CASE REPORT

Every investigated dispute should produce a structured report.

Example sections:

```text
Case ID

Customer complaint summary

Transactions disputed

Total disputed amount

Merchant

Dispute classification

Timeline

Customer statements

Transaction evidence

Authentication evidence

Merchant intelligence

Historical bank signals

Contradictory evidence

Missing evidence

Resolution

Actions taken

Policy decisions

Human-review events

Timestamp

Agent/tool audit references
```

Store structured JSON first.

Generate human-readable HTML/PDF-style output from structured data.

Do not use the LLM to invent missing case fields.

---

# 28. DATA STORAGE

Use DynamoDB for searchable operational records.

Recommended tables:

```text
ThemisTransactions

ThemisCases

ThemisMerchants

ThemisAudit
```

Use S3 for:

```text
case reports
evidence snapshots
browser research snapshots where appropriate
generated export artifacts
```

AgentCore Memory is for conversational continuity.

DynamoDB is the system of record for application state.

Do not use AgentCore conversational memory as the authoritative financial case database.

---

# 29. CASE DATA MODEL

Minimum shape:

```json
{
  "caseId": "case_001",
  "customerId": "customer_001",
  "status": "INVESTIGATING",
  "createdAt": "2026-09-17T20:00:00Z",
  "updatedAt": "2026-09-17T20:04:00Z",
  "claimType": "UNRECOGNIZED_MERCHANT",
  "merchantId": "merchant_asteria",
  "transactionIds": [],
  "evidenceIds": [],
  "totalDisputedAmount": 0,
  "currency": "USD",
  "confidence": null,
  "recommendedActions": [],
  "requiresHumanReview": false
}
```

Use shared schemas from `packages/contracts`.

---

# 30. MESSAGE NORMALIZATION

Messaging infrastructure should normalize inbound events into:

```json
{
  "channel": "RCS",
  "customerExternalId": "+15555550123",
  "messageId": "msg_x",
  "text": "I don't recognize these charges.",
  "postback": null,
  "receivedAt": "..."
}
```

RCS, SMS, and future channels should feed the same agent interface.

Do not put channel-specific logic deep inside the dispute agent.

---

# 31. IDEMPOTENCY

Messaging systems retry.

Financial workflows cannot assume exactly-once delivery.

Maintain idempotency for:

```text
inbound message IDs
case creation
dispute creation
report generation
customer notifications
simulated financial actions
```

If the same inbound event is received twice, it must not create two dispute cases or two credits.

---

# 32. RCS EXPERIENCE

Use RCS where it visibly improves the demo.

Potential actions:

```text
Confirm all transactions

Select transactions

I recognize this

I don't recognize it

I canceled this

Contact merchant first

Open dispute

Request human review
```

Do not build rich UI merely to show off RCS.

Keep the conversation natural.

Support SMS text equivalents.

---

# 33. SMS FALLBACK

The application logic should not depend on rich RCS controls.

Every RCS decision should have a textual SMS-compatible path.

Example:

```text
Reply:
1 — I recognize it
2 — I don't recognize it
3 — I canceled it
```

Normalize both RCS postbacks and SMS responses into the same internal intent.

---

# 34. SES EMAIL

At meaningful case events, send transactional email through SES.

Primary MVP email:

```text
Dispute investigation summary

Case number
Transactions
Total amount
Current status
Actions taken
Next steps
Support information
```

The email should be generated from case data.

Do not make SES merely decorative.

It should visibly complete the omnichannel workflow.

---

# 35. INTERNAL DASHBOARD

The dashboard exists for bank investigators.

It is secondary to the customer messaging experience.

Required routes:

```text
/cases

/cases/[caseId]

/merchants

/merchants/[merchantId]

/review
```

---

# 36. CASE DASHBOARD

Show:

```text
case status

customer complaint

merchant

transactions

amount

timeline

evidence

decision

policy results

agent actions

human-review status
```

Avoid excessive charts.

---

# 37. MERCHANT INTELLIGENCE DASHBOARD

Show:

```text
merchant name

known descriptors

billing patterns

case volume

recent dispute trend

common dispute classifications

current risk signals

cached research timestamp

related cases
```

Do not display a simplistic:

```text
FRAUD SCORE: 96
```

Use interpretable signals.

---

# 38. REVIEW QUEUE

Show cases requiring human review.

Allow demo investigator to:

```text
view case

view evidence

approve proposed action

reject proposed action

request more evidence
```

These actions can use synthetic backend state.

---

# 39. VISUAL DIRECTION

Themis should visually resemble a modern financial operations product.

Use:

```text
clean
high-information density
calm
professional
trustworthy
minimal
```

Avoid:

```text
cyberpunk fraud UI
neon gradients everywhere
giant glowing AI orb
chatbot mascots
fake hacker aesthetic
excessive animation
```

The product should look deployable to a credit union or bank.

---

# 40. REPOSITORY STRUCTURE

Target structure:

```text
themis/
│
├── prompt.md
├── README.md
├── .env.example
│
├── apps/
│   └── dashboard/
│       ├── app/
│       ├── components/
│       ├── lib/
│       └── tests/
│
├── services/
│   ├── agent/
│   │   ├── src/
│   │   │   ├── orchestrator/
│   │   │   ├── prompts/
│   │   │   ├── state/
│   │   │   └── tools/
│   │   └── tests/
│   │
│   ├── bank-tools/
│   │   ├── src/
│   │   └── tests/
│   │
│   ├── merchant-intel/
│   │   ├── src/
│   │   └── tests/
│   │
│   └── messaging/
│       ├── src/
│       │   ├── inbound/
│       │   ├── outbound/
│       │   ├── rcs/
│       │   ├── sms/
│       │   └── email/
│       └── tests/
│
├── packages/
│   └── contracts/
│
├── fixtures/
│   ├── customers/
│   ├── transactions/
│   ├── merchants/
│   └── cases/
│
├── infra/
│   ├── stacks/
│   ├── policies/
│   └── config/
│
├── tests/
│   └── e2e/
│
├── scripts/
│   └── demo/
│
├── docs/
│   ├── architecture/
│   ├── workstreams/
│   └── submission/
│
└── .handoffs/
```

Do not substantially change this layout after parallel work begins.

---

# 41. SHARED CONTRACTS

The contracts package is the boundary between workstreams.

Define schemas for:

```text
Transaction

TransactionAuthSignals

Merchant

MerchantProfile

MerchantRiskSignal

Case

CaseStatus

Evidence

EvidenceType

ResolutionProposal

PolicyDecision

HumanReviewRequest

InboundMessage

OutboundMessage

CaseReport
```

Frontend/backend agents consume contracts.

Do not duplicate competing definitions in five services.

---

# 42. SYNTHETIC DATASET

Seed enough data for realistic reasoning, not benchmark-scale data.

Target approximately:

```text
50 synthetic customers

1,000–2,000 synthetic transactions

40 merchants

4 merchant alias groups

10–15 historical dispute cases

3 recurring-payment patterns

3 ordinary legitimate recurring merchants

1 emerging-risk merchant

1 ambiguous case
```

Do not generate 100,000 transactions.

That increases development and model cost without improving the demo.

---

# 43. DEMO SCENARIOS

Implement these testable scenarios.

## Scenario A — Unknown recurring merchant

Customer denies recognizing Asteria Digital.

Themis finds:

```text
6 × $9.99 recurring transactions
```

Agent investigates.

Case is created.

Report generated.

Merchant intelligence updated.

Customer receives confirmation.

---

## Scenario B — Canceled subscription

Customer recognizes merchant but states:

> I canceled this last month.

System classifies:

```text
RECURRING_PAYMENT_AFTER_CANCELLATION
```

Do not classify it as stolen-card fraud.

---

## Scenario C — Forgotten legitimate subscription

Customer initially does not recognize descriptor.

Merchant resolution reveals a service the customer remembers purchasing.

Customer confirms it.

No dispute is opened.

Case records:

```text
CUSTOMER_RECOGNIZED_MERCHANT
```

---

## Scenario D — Conflicting evidence

Customer denies transaction.

Strong authentication signals conflict with claim.

System does not accuse customer of lying.

Escalate:

```text
NEEDS_HUMAN_REVIEW
```

---

## Scenario E — Institutional memory

A new Asteria transaction appears after multiple prior cases.

Existing merchant intelligence loads immediately.

Themis does not repeat browser research.

Proactive customer verification is triggered.

This scenario demonstrates the intelligence flywheel.

---

# 44. THE INTELLIGENCE FLYWHEEL

The demo should make this visible:

```text
customer reports transaction
          ↓
Themis investigates
          ↓
evidence created
          ↓
case resolved
          ↓
report stored
          ↓
merchant profile updated
          ↓
future similar transaction appears
          ↓
known pattern recognized
          ↓
customer protected earlier
```

This is a primary differentiator.

Do not bury it.

---

# 45. AUDIT LOGGING

Every meaningful automated action should create an audit record:

```json
{
  "eventId": "audit_001",
  "caseId": "case_001",
  "timestamp": "...",
  "actor": "THEMIS_AGENT",
  "action": "SEARCH_TRANSACTIONS",
  "tool": "search_transactions",
  "result": "SUCCESS"
}
```

For policy-controlled operations also store:

```text
policy name

policy outcome

proposed action

input amount where relevant

human approval requirement
```

Never store hidden model chain-of-thought.

---

# 46. ERROR HANDLING

External failure should degrade gracefully.

Examples:

```text
Browser unavailable
→ continue with internal evidence
→ mark merchant research unavailable

Bedrock unavailable
→ preserve case state
→ return service-retry message

SES unavailable
→ case remains resolved
→ mark email delivery pending/failed

RCS unavailable
→ SMS fallback

merchant unresolved
→ request clarification or human review

tool timeout
→ retry only when safe/idempotent
```

Do not allow one failed enrichment to destroy the entire case.

---

# 47. SECURITY

Never commit:

```text
AWS credentials
API keys
phone numbers belonging to real users
real account numbers
real bank credentials
real card numbers
customer PII
```

Use `.env.example`.

Use synthetic identifiers.

Use IAM least privilege where practical.

Avoid wildcard permissions when a narrower permission is reasonably achievable.

---

# 48. FINANCIAL SAFETY

This is a hackathon system operating on synthetic data.

Do not connect to a real bank account.

Do not initiate real ACH/card transfers.

Do not issue real refunds.

Do not block real cards.

Do not claim a demo action changed a real financial account.

Tool names may reflect realistic bank operations, but their implementation should operate on synthetic/mock banking records.

---

# 49. INFRASTRUCTURE

Infrastructure should be reproducible.

Use AWS CDK.

Separate logical constructs/stacks for:

```text
data

messaging

agentcore

tools

observability

web
```

Do not create one massive file containing every AWS resource.

Also do not create dozens of microscopic stacks.

---

# 50. LOCAL DEVELOPMENT

The product should support a local/demo mode.

Environment flag:

```text
THEMIS_MODE=local
```

Local mode should:

```text
use synthetic data
mock outbound RCS/SMS if AWS resources unavailable
mock SES if unavailable
use deterministic fixtures
allow dashboard testing
```

AWS mode:

```text
THEMIS_MODE=aws
```

should use actual configured AWS services.

The final demonstration must include actual qualifying AWS CDS runtime usage.

---

# 51. FEATURE FLAGS

Useful flags:

```text
THEMIS_MODE

ENABLE_RCS

ENABLE_SMS_FALLBACK

ENABLE_SES

ENABLE_BROWSER_RESEARCH

ENABLE_PROACTIVE_DETECTION

ENABLE_REASONING_ESCALATION
```

Do not create a feature-flag framework.

Environment configuration is enough.

---

# 52. TESTING STRATEGY

Do not run the full suite after every edit.

During implementation:

```text
run the narrowest relevant test
```

Example:

```bash
pytest services/agent/tests/test_transaction_matching.py -q
```

or:

```bash
pnpm --filter dashboard test -- case-card
```

Before handoff:

```text
run all tests for your workstream
```

Integration agent runs the complete suite after merges.

---

# 53. REQUIRED TESTS

At minimum cover:

```text
transaction matching

merchant alias resolution

duplicate inbound message handling

case state transitions

merchant cache hit

merchant cache miss

dispute classification

policy allow

policy deny

human escalation

report generation

merchant-profile update

RCS/SMS normalization

SES payload generation
```

---

# 54. MOCKS

Mock external AWS network calls in unit tests.

Do not spend money sending real RCS messages as part of normal test execution.

Provide an explicit manually invoked integration/demo script for real AWS messaging.

---

# 55. PARALLEL WORKSTREAM PLAN

## Workstream A — contracts + fixtures

Deliver:

```text
shared types
schemas
synthetic users
transactions
merchants
cases
```

Branch:

```text
agent/contracts/core-models
```

Own:

```text
packages/contracts/**
fixtures/**
```

---

## Workstream B — banking tools

Deliver:

```text
search_transactions
get_transaction_details
authentication signals
case CRUD
merchant lookup
audit persistence
synthetic action tools
```

Branch:

```text
agent/bank-tools/core-tools
```

Own:

```text
services/bank-tools/**
```

---

## Workstream C — AgentCore

Deliver:

```text
orchestrator
state machine
Bedrock inference
Gateway client
Memory integration
Policy integration
resolution pipeline
report reasoning
```

Branch:

```text
agent/agentcore/orchestrator
```

Own:

```text
services/agent/**
```

---

## Workstream D — merchant intelligence

This can be owned by the AgentCore worker or a separate worker if enough developers exist.

Deliver:

```text
merchant resolution
aliases
cache
risk signals
Browser integration
profile updates
```

Branch:

```text
agent/agentcore/merchant-intel
```

Own:

```text
services/merchant-intel/**
```

Only one worker may own this directory at a time.

---

## Workstream E — messaging

Deliver:

```text
SNS inbound normalization
RCS outbound
SMS-compatible responses
postback handling
SES email
idempotency
```

Branch:

```text
agent/messaging/cds
```

Own:

```text
services/messaging/**
```

---

## Workstream F — dashboard

Deliver:

```text
case list
case detail
merchant intelligence
merchant detail
human review queue
```

Branch:

```text
agent/frontend/dashboard
```

Own:

```text
apps/dashboard/**
```

---

## Workstream G — infrastructure

Deliver:

```text
CDK stacks
DynamoDB
S3
SNS
Lambda wiring
IAM
AgentCore resources
messaging configuration support
CloudWatch
Amplify deployment config
```

Branch:

```text
agent/infra/aws
```

Own:

```text
infra/**
```

---

## Workstream H — QA/demo

Deliver:

```text
E2E tests
demo reset
demo fixture load
demo scripts
happy-path automation
failure scenario validation
```

Branch:

```text
agent/qa/demo
```

Own:

```text
tests/e2e/**
scripts/demo/**
```

---

# 56. INTEGRATION AGENT

One designated agent acts as integration owner.

Integration agent may:

```text
merge worker branches locally
resolve conflicts
update root dependencies
update README
update architecture docs
run full tests
perform deployment fixes spanning workstreams
```

Integration agent should not rewrite entire working implementations merely to make them stylistically uniform.

Prefer adapting boundaries.

---

# 57. MERGE ORDER

Suggested local merge order:

```text
contracts
↓
bank-tools
↓
merchant-intel
↓
agentcore
↓
messaging
↓
frontend
↓
infra
↓
qa/demo
```

Independent branches can be developed simultaneously.

This is only merge order.

It is not a requirement to develop sequentially.

---

# 58. CONFLICT RESOLUTION

When integration discovers conflict:

1. preserve shared contract behavior;
2. preserve already-tested interfaces;
3. make smallest reconciliation;
4. do not rewrite both implementations;
5. rerun affected tests;
6. commit conflict resolution separately.

Example:

```text
fix(integration): align case status contract
```

---

# 59. TOKEN-EFFICIENT CODING AGENT HANDOFF

Before a coding agent stops, update only its own workstream handoff file:

```text
docs/workstreams/<workstream>.md
```

Keep it below roughly 100 lines.

Include:

```text
STATUS

DONE

CURRENT INTERFACES

KNOWN ISSUES

NEXT 3 TASKS

LATEST TEST COMMAND

LATEST COMMIT
```

The next agent reads this file instead of reconstructing history from the entire repository.

This is critical for token efficiency.

Do not write giant development journals.

---

# 60. SESSION START PROTOCOL

Every worker session should begin with:

```bash
git branch --show-current
git status --short
```

Then read:

```text
prompt.md
docs/workstreams/<assigned-workstream>.md
```

Then inspect only relevant files.

Do not automatically run:

```bash
find . -type f
cat every source file
git log --all --stat
```

---

# 61. SESSION RESUME PROTOCOL

If resuming existing work:

```text
read workstream handoff
check latest 5 commits
inspect git status
continue next listed task
```

Do not recreate the architecture plan.

---

# 62. CONTEXT COMPRESSION

When context is becoming large:

write concise state into:

```text
docs/workstreams/<workstream>.md
```

Then continue using that summary.

Do not preserve huge repetitive reasoning transcripts.

Persist facts, not thought process.

---

# 63. CODE QUALITY

Prefer:

```text
small modules
typed contracts
explicit names
pure functions where reasonable
structured errors
tests around business rules
```

Avoid:

```text
premature generic frameworks
deep inheritance
metaprogramming
magic
1000-line agent prompts
hidden state
duplicate domain models
```

---

# 64. AGENT PROMPT DESIGN

The runtime system prompt must be concise.

It should define:

```text
role
financial boundaries
available evidence
state schema
tool rules
escalation rules
response format
```

Do not embed this entire `prompt.md` into the production LLM prompt.

This document is for developers.

Production agent prompts should generally remain a few thousand tokens or less and preferably substantially less.

---

# 65. PROMPT CACHING / STATIC CONTEXT

Keep stable agent instructions separated from changing case information.

Where supported by the selected Bedrock model/runtime configuration, structure calls so stable instructions are reusable/cache-friendly.

Do not dynamically regenerate giant system prompts on every message.

---

# 66. REPORT GENERATION TOKEN RULE

Report generation should use existing structured evidence.

Do not:

```text
re-query all transactions
re-run merchant browser
re-read complete conversation
re-run entire investigation
```

Generate:

```text
case JSON
+
evidence summaries
+
policy result
→ report
```

---

# 67. OBSERVABILITY

Record:

```text
case latency
tool calls
model calls
browser calls
cache hits
cache misses
human escalations
policy allows
policy denies
message delivery result
approximate model usage where available
```

A demo dashboard metric showing:

```text
merchant research cache hit
```

is useful because it directly demonstrates the cost/intelligence benefit.

---

# 68. COST DISCIPLINE

This hackathon has limited AWS credits.

Default toward low-cost usage.

Do not repeatedly:

```text
deploy unchanged infrastructure
send real SMS/RCS during unit tests
invoke expensive models for fixture generation
run Browser against known cached merchants
generate huge Bedrock outputs
```

Use local fixtures until validating the AWS integration.

---

# 69. REQUIRED END-TO-END HAPPY PATH

The system is not complete until this works:

```text
1. Synthetic suspicious transactions exist.

2. Customer sends an inbound RCS/SMS message.

3. SNS delivers message.

4. Messaging service normalizes it.

5. Themis receives conversation.

6. Customer describes unknown recurring charge.

7. Themis calls transaction search.

8. Matching transactions returned.

9. Customer confirms affected transactions.

10. Merchant resolves.

11. Cached/internal intelligence loads.

12. Additional research happens only if necessary.

13. Evidence graph updates.

14. Resolution proposal created.

15. AgentCore/Cedar policy evaluates proposed action.

16. Allowed synthetic action executes OR case escalates.

17. Case report created.

18. Report/evidence persisted.

19. Merchant intelligence updated.

20. Customer receives RCS/SMS confirmation.

21. Customer receives SES case email.

22. Investigator dashboard displays the case.

23. Merchant dashboard displays updated institutional intelligence.
```

---

# 70. REQUIRED SECOND PASS

After the first resolved Asteria case:

run another synthetic customer case against the same merchant.

The second case should demonstrate:

```text
merchant resolved from existing profile

cached merchant intelligence used

browser research skipped

historical pattern included as supporting evidence

customer-specific investigation still performed
```

This proves Themis learns institutionally without blindly assuming every transaction is fraudulent.

---

# 71. DEMO SCRIPT

Target approximately three minutes.

## 0:00–0:20

Explain:

> A customer can lose money for weeks before noticing a recurring charge. When they finally contact their bank, automated systems often send them to forms instead of investigating.

## 0:20–0:45

Show phone.

Customer receives or initiates RCS conversation.

Customer:

> I don't recognize these recurring charges.

## 0:45–1:15

Themis:

```text
finds transactions
shows six $9.99 charges
asks customer to confirm
```

Customer confirms.

## 1:15–1:45

Show agent investigation:

```text
transaction evidence
merchant resolution
authorization signals
merchant history
evidence graph
```

Avoid staring at logs for thirty seconds.

Represent actions visually.

## 1:45–2:05

Show policy gate:

```text
agent proposes action
Cedar policy evaluates it
action approved or escalated
```

## 2:05–2:25

Show:

```text
case report
SES confirmation
```

## 2:25–2:45

Show merchant dashboard:

```text
Asteria profile
aliases
case pattern
risk signal
```

## 2:45–3:00

Trigger next Asteria case.

Show:

```text
merchant intelligence cache hit
known pattern recognized immediately
no duplicate browser investigation
```

Closing idea:

> Every dispute Themis resolves becomes institutional intelligence that helps the bank recognize the next problem earlier.

---

# 72. HACKATHON SUBMISSION REQUIREMENTS TO SUPPORT

Repository must ultimately provide:

```text
working source code

deployment/run instructions

architecture diagram

text description

deployed experience or interaction instructions

approximately 3-minute demo flow

runtime AWS CDS usage
```

Integration agent owns final submission documentation.

Do not wait until the final day to make the architecture reproducible.

---

# 73. ARCHITECTURE DIAGRAM

Produce Mermaid source under:

```text
docs/architecture/themis.mmd
```

Also export a judge-friendly image before submission.

Diagram must visibly include:

```text
customer
RCS/SMS
AWS End User Messaging
SNS
Lambda
Bedrock/AgentCore
Gateway
Policy
Memory
Browser
DynamoDB
S3
SES
dashboard
```

---

# 74. README

README should remain concise.

Required sections:

```text
What is Themis?

Problem

How it works

Architecture

AWS services used

Demo

Local setup

AWS deployment

Environment variables

Repository structure

Safety / synthetic-data note

Hackathon submission information
```

Do not turn README into an internal engineering diary.

---

# 75. NON-GOALS

Do not build for MVP:

```text
real bank integrations

real payment-network integrations

Plaid production connectivity

actual money movement

full identity/KYC platform

full authentication product

full fraud-ML model

mobile banking application

consumer budgeting features

credit scoring

loan underwriting

crypto functionality

general-purpose support bot

voice-call center unless core product is already complete

WhatsApp solely for feature count

multiple LLM agents debating each other
```

If the MVP is complete early, improve reliability and demo quality before adding scope.

---

# 76. DEFINITION OF DONE

Themis is complete when:

```text
AWS CDS is genuinely used at runtime.

A real RCS/SMS interaction can reach the agent.

Agent can investigate synthetic transactions.

Merchant aliases resolve.

Dispute type is classified.

Evidence is structured.

Policy controls meaningful actions.

Ambiguous cases can escalate.

Report is generated and persisted.

SES sends case communication.

Merchant intelligence persists across cases.

Second related case uses stored intelligence.

Internal dashboard shows cases and merchant intelligence.

Tests cover core business logic.

AWS deployment is reproducible.

Demo can run predictably.

No real financial account is affected.
```

---

# 77. DO NOT OVERBUILD AFTER DEFINITION OF DONE

Once all Definition of Done items work:

STOP adding architecture.

Focus on:

```text
bugs

latency

demo polish

UI clarity

test reliability

documentation

deployment reliability

video narrative
```

Do not suddenly add:

```text
Kafka
five more agents
mobile application
custom ML model
blockchain
another database
another cloud
```

---

# 78. FIRST TASK FOR THE COORDINATOR

If the repository is empty, the coordinator should perform only the bootstrap necessary for parallel development.

Create:

```text
directory structure

integration branch

shared contracts skeleton

workspace configuration

basic Python environment

dashboard skeleton

CDK skeleton

.env.example

workstream handoff files
```

Install/pin the core dependencies centrally.

Commit.

Then create/assign worker branches.

Do not build every component personally before allowing parallelism.

---

# 79. FIRST TASK FOR A WORKER

When receiving this prompt:

1. determine assigned workstream;
2. verify current Git branch;
3. create an `agent/<workstream>/<task>` branch if required;
4. verify Git status;
5. read only the workstream handoff;
6. inspect owned files;
7. identify the smallest missing deliverable;
8. implement immediately;
9. targeted-test it;
10. make first commit within roughly 3–5 minutes of meaningful work;
11. continue in small checkpoints;
12. never push.

Do not answer with another giant architecture proposal.

The architecture already exists.

Build it.

---

# 80. FINAL ENGINEERING PRINCIPLE

Themis should feel like:

> **an AI employee operating inside a carefully governed banking system**

not:

> **a chatbot with access to a database.**

The intelligence comes from combining:

```text
conversation
+
bank data
+
merchant resolution
+
external evidence
+
institutional memory
+
agentic tool use
+
deterministic policy
+
human escalation
```

The customer gets a dramatically easier dispute experience.

The bank gets a reusable investigation system.

Every resolved case leaves behind structured institutional knowledge.

That knowledge helps protect the next customer sooner.

Build that system.
