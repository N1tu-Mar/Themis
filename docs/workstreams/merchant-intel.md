# Merchant Intelligence workstream

## STATUS

DURABLE_STORE_COMPLETE (local branch `agent/merchant-intel/durable-store`, not pushed)

## DONE

- Package `services/merchant-intel` (`merchant_intel`, Python 3.12, no deps).
- Alias resolution: normalized exact / whole-word-prefix match, longest alias wins; ties across merchants are `ambiguous` (never auto-picked).
- Cache-first profiles: default TTL 7d (`ttl=`), hit / miss / expired, injectable `Clock`, injectable `Researcher`.
- Research only when a profile exists and is expired; missing profile => no research. Researcher failure => stale profile + `researchError`.
- Risk signals: evidenceRefs required, observed/expiry timestamps, linear decay (severity drops one level below weight 0.5), expire at expiresAt. `fraudEstablished` always false.
- `record_case`: idempotent per case_id, updates caseStatistics/signals, preserves all other profile data.
- Profiles validated against `packages/contracts/schemas.json` (`MerchantProfile`, `Merchant`) by a tiny built-in validator; cache metadata (researchedAt/expiresAt/version/sourceSummary) kept outside the contract profile.
- Scenario E test proves zero research calls, cached profile, verification still required.

- Durable store: `DynamoProfileStore(client, table)` on ThemisMerchants (`P#id` profile+cache metadata+caseStates+rev, `A#alias`), conditional `rev` writes, `ConflictError` retried in `_merge`/`record_case`; `ProfileStore.put` now returns the stored record. `load_profiles` never overwrites stored data.
- `BoundedResearcher(client, allowed_domains, sources, max_pages, timeout)`; `store_from_env` / `intel_from_env` (see `.handoffs/merchant-intel/20260920-durable-store-wiring.md`).
- `schemas.json` packaged in the wheel (test guards drift vs contracts).

## CURRENT INTERFACES

- `merchant_intel.tools.resolve_merchant(intel, *, descriptor)` -> `{status, resolved, ambiguous, merchantId, canonicalName, candidates}`
- `tools.get_merchant_profile(intel, *, merchant_id, allow_research=True)` -> `{status, profile, cache{status,researchPerformed,researchError,researchedAt,expiresAt,version,sourceSummary,stale}, requiresCustomerVerification}`
- `tools.get_merchant_risk_signals(intel, *, merchant_id, include_expired=False)` -> `{status, riskSignals[+weight,effectiveSeverity,expired], count, asOf, fraudEstablished:false, requiresCustomerVerification:true}`
- `MerchantIntel(store, clock=, researcher=, ttl=, signal_ttl=)`: `load_profiles`, `resolve`, `get_profile`, `risk_signals`, `record_case(merchant_id, case_id, status=OPEN|RESOLVED, dispute_confirmed=, signal=)`.
- Protocols: `Clock.now()`, `Researcher.research(merchant_id, canonical_name)`, `ProfileStore.get/put/all`.

## KNOWN ISSUES

- Contract has no researchedAt/expiresAt/version fields; persisted only in `CacheRecord`. A durable store (DynamoDB) must persist them; loaded fixtures use updatedAt as researchedAt.
- Validator supports only the schema subset used by MerchantProfile/Merchant.
- Failed research retried every read (no negative cache); `resolve()` scans the table.
- Root pytest `pythonpath` lacks merchant-intel src (only its own tests self-configure); see handoff.
- Real browser/LLM researcher and Gateway wiring not built.

## NEXT 3 TASKS

1. Integration: wire tools into Gateway/agent (see `.handoffs/merchant-intel/`).
2. Real PageClient (browser/LLM extraction) + `sources` callable; needs security review.
3. Negative cache for failed research; alias-row resolve.

## LAST TEST COMMAND + RESULT

- `python3 -m pytest -q services/merchant-intel` : `python3 -m pytest -q services/merchant-intel`: 33 passed; wheel+sdist build OK, schemas.json inside both.

## LAST CODE COMMIT

- see `git log -1 agent/merchant-intel/core`.
