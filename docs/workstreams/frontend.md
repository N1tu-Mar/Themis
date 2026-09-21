# Frontend workstream

## STATUS

DONE — 5 routes work on fixtures (default) or live AWS data (THEMIS_DASHBOARD_DATA_SOURCE=aws); AWS IAM/deps pending via handoffs.

## DONE

- Scaffolded Next.js 15 (App Router) + TS + Tailwind in `apps/dashboard` (repo had only empty placeholder dirs).
- Single data boundary: `lib/data/adapter.ts` reads `fixtures/{cases,merchants}/demo*.json`, validates with `@themis/contracts` Zod schemas, exposes typed accessors. No component imports fixtures directly.
- Hand-rolled Tailwind primitives in `components/ui.tsx` (Badge/Card/StatusBadge/SeverityBadge) matching shadcn visual style — skipped the shadcn CLI/Radix stack to avoid dependency weight; swap in if a component needs real interactivity later.
- `/cases` — list + status/review filters (server-rendered via searchParams, no client JS needed).
- `/cases/[caseId]` — full investigation view: complaint → investigation → evidence → policy → outcome progression bar, transactions, merchant identity, timeline, evidence grouped by category with supporting/contradictory tags, missing evidence, merchant intelligence snapshot, resolution proposal, policy decisions, actions taken, audit events.
- `/merchants` — list with descriptors, case counts, recent-90d trend, common dispute type, risk signals (no fraud score).
- `/merchants/[merchantId]` — canonical identity, all aliases, billing patterns, case history aggregate, risk signals, research/cache status, related cases.
- `/review` — human review queue, client-side mock Approve/Reject/Request-more-evidence buttons (no backend write).
- 14 tests (vitest + RTL): adapter typed-data + lookups, case list/detail rendering, merchant aliases/risk signals, review queue, empty state.
- Design pass: IBM Plex Sans/Mono type system, restrained ink/paper/trust(green)/flag(amber)/alert(red) palette — deliberately not the cream+terracotta or near-black+neon AI defaults. Signature element: a bordered "audit stamp" (`components/ui.tsx` → `Stamp`) for policy decisions (ALLOW/DENY/REQUIRE_HUMAN_REVIEW). Mono tabular figures for all IDs/amounts/timestamps (real ledger convention). Responsive grid collapse on detail pages, reduced-motion guard, visible focus rings, styled not-found page.
- Moved all frontend work to a dedicated worktree (`/private/tmp/themis-frontend-dashboard`) after a cross-session isolation incident — see git log for details. Do not work directly in the shared repo root.

## LIVE DATA (agent/frontend/live-data)

- `lib/data/provider.ts`: async `DataProvider` (cases, reports, merchant profiles, review requests, audit events, `status()`).
- `fixtures-provider.ts` is the default; `aws-provider.ts` (+ `aws-access.ts`, `aws-config.ts`) loads only when `aws` is selected.
- AWS reads are server-only, read-only, uncached (`force-dynamic`): new cases and merchant updates show on next request.
- Env reused: `CASES_TABLE`, `MERCHANTS_TABLE`, `AUDIT_TABLE`, `ARTIFACTS_BUCKET`. No browser-visible AWS config.
- States: `app/loading.tsx`, `app/error.tsx` (backend error), empty lists, case-without-report placeholder,
  `DataNotice` for stale (last-known-good after a failed read) and hidden invalid records.
- Review actions are disabled/read-only in every mode (no safe decision API exists).
- Requests: `.handoffs/frontend/2026-09-21-live-data-dependencies.md`, `...-amplify-iam-and-env.md`.

## CURRENT INTERFACES

- `apps/dashboard/lib/data/adapter.ts` — the only consumer of providers; all functions are async now. Components never touch fixtures or AWS.
- Reads `@themis/contracts` schemas: `Case`, `CaseReport`, `MerchantProfile`, `HumanReviewRequest`, `AuditEvent`.

## KNOWN ISSUES

- Root `package-lock.json` needs an integration-owned `npm install` — see `.handoffs/frontend/lockfile-update.md`.
- `npm audit` has a few remaining dev-tooling findings (vitest/esbuild/postcss, sharp) that need breaking major bumps; not app-facing, deferred.
- Review actions are read-only by design until a decision API exists.
- AWS lists use table Scan (ponytail); real AWS reads are unverified live (fakes only).
- Merchant profile rows assumed at `P#<id>` `{doc}`; merchant-intel durable store layout unconfirmed.

## NEXT 3 TASKS

1. Integration installs deps/lockfile; infra grants compute-role read access + env (handoffs above).
2. QA smoke test with `THEMIS_DASHBOARD_DATA_SOURCE=aws` against seeded tables.
3. Decision API (authenticated, policy-gated) before enabling review actions.

## LAST TEST COMMAND + RESULT

- `npx vitest run` (apps/dashboard) — 4 files, 36 tests pass. `npx next build` — all routes dynamic, builds clean.
- No AWS calls; fakes only. Client chunks checked: no aws-sdk / table names.
