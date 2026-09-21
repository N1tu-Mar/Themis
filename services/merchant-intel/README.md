# themis-merchant-intel

Cache-first merchant resolution, profiles and time-aware risk signals. Synthetic data only.
Profiles are plain dicts validated against `packages/contracts/schemas.json` (`MerchantProfile`);
cache metadata (researchedAt/expiresAt/version/sourceSummary) lives beside the profile, not in it.

## Browser research

Research is off by default. It can run only for a missing/expired cache record with a known merchant,
and only when `MERCHANT_RESEARCH_ENABLED=true`, `MERCHANT_RESEARCH_APPROVED=true`, an approved page
provider, application-controlled source function, and `MERCHANT_RESEARCH_DOMAINS` are all supplied.
The provider contract is `BrowserProvider.fetch(url, timeout, max_bytes) -> BrowserPage`; it is vendor
neutral and returns the final URL, redirect chain, content type, bounded transient body, and retrieval time.

`BoundedResearcher` allows HTTPS only, caps at five pages, applies per-page and total deadlines, validates
allowlisted public DNS destinations before every request and redirect, limits response bytes, and accepts
only HTML/plain-text content. It persists summarized facts plus `{url, retrievedAt, contentType}` in cache
metadata (`researchSources` in Dynamo), never full page bodies. Page text is untrusted data and cannot add
URLs, select tools, change policy, or establish fraud.

Gateway-facing functions: `merchant_intel.tools.{resolve_merchant, get_merchant_profile, get_merchant_risk_signals}`.

    cd services/merchant-intel && python3 -m pytest -q
