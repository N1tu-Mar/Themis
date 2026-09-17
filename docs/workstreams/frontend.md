# Frontend workstream

## STATUS

DONE — all 5 required routes working against shared-contract fixtures, visual identity pass complete, demo-ready.

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

## CURRENT INTERFACES

- `apps/dashboard/lib/data/adapter.ts` — the only consumer of `fixtures/**`. Swap fixture reads for real API calls here later without touching components.
- Reads `@themis/contracts` schemas: `Case`, `CaseReport`, `MerchantProfile`, `HumanReviewRequest`, `AuditEvent`.

## KNOWN ISSUES

- Root `package-lock.json` needs an integration-owned `npm install` — see `.handoffs/frontend/lockfile-update.md`.
- `npm audit` has a few remaining dev-tooling findings (vitest/esbuild/postcss, sharp) that need breaking major bumps; not app-facing, deferred.
- Review queue actions are local `useState` only (no persistence) — fine for demo, per spec.

## NEXT 3 TASKS

1. Nothing required — stop condition met. If time remains: swap `/review` mock actions for a small client store so a decision persists across nav (still no backend).
2. Add a settings/admin page only if time remains — explicitly deprioritized per prompt.
3. Once integration wires a real API, replace fixture imports in `lib/data/adapter.ts` with fetch calls, keep function signatures stable.

## LAST TEST COMMAND + RESULT

- `npx vitest run` → 2 files, 14 tests, all passed.
- `npx next build` → compiles clean, all 7 routes generated (5 required + `/` redirect + not-found).

## LAST CODE COMMIT

- `d4dd764` feat(frontend): distinctive audit-ledger visual identity for the console
