# themis-merchant-intel

Cache-first merchant resolution, profiles and time-aware risk signals. Synthetic data only.
Profiles are plain dicts validated against `packages/contracts/schemas.json` (`MerchantProfile`);
cache metadata (researchedAt/expiresAt/version/sourceSummary) lives beside the profile, not in it.

Gateway-facing functions: `merchant_intel.tools.{resolve_merchant, get_merchant_profile, get_merchant_risk_signals}`.

    cd services/merchant-intel && python3 -m pytest -q
