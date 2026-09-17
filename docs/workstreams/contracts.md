# Contracts workstream

## STATUS

BOOTSTRAP_COMPLETE — ready for parallel workers; full demo dataset remains deferred.

## DONE

- Initialized repository at `/Users/nityanthmaramreddy/Downloads/themis` on `integration`.
- Copied the setup overlay into the root; normalized the supplied trailing-space specification to `prompt.md`.
- Created specification section 40 directories with tracked placeholders.
- Added minimal npm workspace, pinned Zod 4.1.5 / TypeScript 5.9.2 and lockfile.
- Added Python 3.12 project baseline, README, environment template and ignore rules.
- Implemented all requested types and runtime schemas, including Customer and EvidenceType.
- Exported standalone JSON Schema 2020-12 documents for Python boundaries.
- Established all 14 specified CaseStatus values and documented the bootstrap transition map.
- Added one synthetic customer, transaction, merchant/profile and linked case records/messages/report.
- Added 16 tests for fixtures, references/totals, invalid shapes, state transitions and schema export alignment.

## CURRENT INTERFACES

- `@themis/contracts`: named domain types, `<Type>Schema` Zod validators.
- `packages/contracts/schemas.json`: schema-name → standalone JSON Schema document.
- `CASE_STATUS_TRANSITIONS`, `canTransitionCaseStatus`, `assertCaseStatusTransition`.
- Exact schema fields and conventions: `packages/contracts/src/index.ts` and `packages/contracts/README.md`.
- Fixtures are deterministic JSON arrays under `fixtures/{customers,transactions,merchants,cases}`.
- `npm ci`; `npm run build`; `npm test`; `npm run check`.

## KNOWN ISSUES / DECISIONS

- Specification section 14 lists states but not edges; README explicitly documents chosen bootstrap edges.
- State checks do not authorize actions; services must enforce policy and recorded human approval.
- Evidence types/sources, review reasons and risk types are open nonempty labels: spec has no exhaustive lists.
- Auth signal keys follow specification snake_case; absent means unknown.
- Amounts follow spec major units; compute totals using integer minor units.
- Runtime schemas validate shapes; services own cross-record integrity and policy checks.
- No CodeMunch tools were available. Only scoped specification/config discovery was needed.
- No product services, dashboard code, CDK resources or external integrations implemented.
- Original overlay and trailing-space specification remain locally preserved and ignored.

## NEXT 3 TASKS

1. Workers consume these contracts; request boundary changes instead of duplicating domain models.
2. QA/demo expands fixtures to the modest specification target after service requirements settle.
3. Integration pins runtime dependencies as workers need them and creates worker branches/worktrees.

## LAST TEST COMMAND + RESULT

- `npm run check` — build passed, 16 tests passed, 0 failures.
- `git diff --check` — passed. Python `pyproject.toml` parsed with Python 3.12.

## LAST CODE COMMIT

- `04f8fa1` — workspace, contracts and representative fixtures bootstrap.
- Final tests/handoff commit: `git log -1 --oneline -- docs/workstreams/contracts.md`.
