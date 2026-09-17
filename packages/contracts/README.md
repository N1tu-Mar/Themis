# Shared contracts

Import types and runtime schemas from `@themis/contracts`. Each domain type has a corresponding `<Type>Schema` and supports `.parse(value)` / `.safeParse(value)`. Objects reject unknown fields. Missing auth signals mean unknown, never false. Amounts use major currency units as in the specification; workers must compute totals in integer minor units. All timestamps are ISO 8601 with an explicit timezone. IDs are opaque nonempty strings.

`npm run build` emits TypeScript declarations and `schemas.json`, a map of standalone JSON Schema 2020-12 documents. This is the serialized boundary for Python workers; generated schemas must not be edited by hand. Build before consuming the package. `EvidenceType`, evidence sources, review reasons, and risk signal types remain nonempty source-defined labels because the specification supplies no exhaustive vocabulary.

## Case state machine

The exact 14 status names come from specification section 14. That section supplies no edge list. `CASE_STATUS_TRANSITIONS` is the initial repository transition contract and the authoritative edge list for workers. `canTransitionCaseStatus` checks an edge; `assertCaseStatusTransition` rejects it. Neither executes actions nor grants policy permission.

Normal path: NEW → INTAKE → TRANSACTION_MATCHING → AWAITING_TRANSACTION_CONFIRMATION → CLASSIFYING_DISPUTE → INVESTIGATING → RESOLUTION_PROPOSED → POLICY_REVIEW → ACTION_APPROVED → RESOLVED → CLOSED.

A rejected match returns to TRANSACTION_MATCHING. Customer-information waits return to the requesting stage (the caller retains that context). Merchant-evidence waits return to INVESTIGATING. Investigation/intake/matching can escalate to NEEDS_HUMAN_REVIEW; policy can do so too. Human review can return to investigation, propose a revised resolution, or record approval before ACTION_APPROVED. CLOSED has no outgoing edges and repeated statuses are not transitions. Persistence/idempotency belongs to the service worker. A human-review approval edge requires recorded human approval; this package validates shape and workflow only.

The schemas validate individual documents, not database references, policy correctness, or monetary reconciliation. Services own those checks. Case reports retain structured evidence and concise rationale, never hidden chain-of-thought.
