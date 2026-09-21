# Request: wire durable merchant intelligence (owner: integration / agentcore / infra)

## Constructor
```python
from merchant_intel import intel_from_env, tools
intel = intel_from_env(client=boto3.client("dynamodb"), page_client=my_page_client, sources=my_sources)
# or explicitly:
MerchantIntel(DynamoProfileStore(client, os.environ["MERCHANTS_TABLE"]), researcher=BoundedResearcher(...), ttl=...)
```
`client` is injected (low-level dynamodb client). If omitted and `MERCHANTS_TABLE` is set, the factory lazily calls `boto3.client("dynamodb")`.
Build ONE `MerchantIntel` per process and reuse it; any number of instances/processes may share the table.

## Env variables
| var | meaning | default |
|---|---|---|
| `MERCHANTS_TABLE` | ThemisMerchants table name (same var bank-tools uses). Unset => in-memory store | unset |
| `MERCHANT_STORE` | `memory` forces in-memory | - |
| `MERCHANT_PROFILE_TTL_SECONDS` | profile freshness | 604800 |
| `MERCHANT_RESEARCH_ENABLED` | `true` to allow research | off |
| `MERCHANT_RESEARCH_DOMAINS` | comma list; https only, exact host or subdomain | required if enabled |
| `MERCHANT_RESEARCH_MAX_PAGES` / `MERCHANT_RESEARCH_TIMEOUT_SECONDS` | page cap / per-page timeout (total deadline = pages x timeout) | 3 / 10 |
Research also needs `page_client` (`fetch(url, *, timeout) -> {summary, aliases, billingPatterns, riskSignals}`) and `sources(merchant_id, canonical_name) -> [urls]`; without both the researcher is None. Nothing in this package performs live calls.

## Dynamo layout (table ThemisMerchants, pk `merchantId`; matches bank-tools)
- `P#<merchantId>`: `{merchantId, doc (MerchantProfile incl. aliases/caseStatistics/riskSignals), researchedAt, expiresAt (ISO), version, sourceSummary, caseStates {caseId: OPEN|RESOLVED|RESOLVED+DISPUTE}, rev}`
- `A#<NORMALIZED ALIAS>`: `{merchantId, target}` (written only if absent or same target)
- Writes are conditional on `rev` (optimistic lock); ConflictError => re-read + retry (3x). bank-tools-seeded `P#` rows (no `rev`/`researchedAt`) are read as rev 0, researchedAt = doc.updatedAt.
- bank-tools' `add_merchant_profile` does an unconditional put: do not re-seed over live rows with it (it would drop cache metadata/caseStates). `MerchantIntel.load_profiles` never overwrites.

## IAM (agent/gateway Lambda role)
`dynamodb:GetItem`, `PutItem`, `Scan` on the ThemisMerchants table ARN. Scan is used by `resolve()` (filter `begins_with(merchantId,"P#")`); no GSI, no TTL attribute needed.

## Router wiring
1. Register `tools.resolve_merchant`, `tools.get_merchant_profile`, `tools.get_merchant_risk_signals` (unchanged; bind `intel`).
2. Call `intel.record_case(merchant_id, case_id, status=OPEN|RESOLVED, dispute_confirmed=, signal=)` when a case opens/resolves; idempotent per case_id, safe to replay.
3. Cache hit => zero research; tool replies always carry `requiresCustomerVerification: true`. Research failure returns the stale profile with `cache.researchError`.
4. Root pytest `pythonpath` still lacks `services/merchant-intel/src` for other services importing it.

## Known limits
- Failed research is retried on every read of an expired profile (no negative cache).
- `resolve()` scans; move to `A#` lookups if the table grows.
- `src/merchant_intel/schemas.json` is a packaged copy of packages/contracts/schemas.json; a test fails on drift. Re-copy when contracts change.
