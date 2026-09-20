# Request: integration wiring for merchant-intel (owner: integration / agentcore / infra)

1. Root pytest already collects merchant-intel (tests/conftest.py adds src to sys.path); optional: add `services/merchant-intel/src` to root `pythonpath` for other services importing it.
2. agentcore: register `merchant_intel.tools.{resolve_merchant,get_merchant_profile,get_merchant_risk_signals}` with Gateway; construct `MerchantIntel(store, researcher=...)`. Reply shape `{status: ok|error}` matches bank-tools.
3. infra: durable `ProfileStore` must persist CacheRecord (researched_at, expires_at, version, source_summary, case_states) beside the contract profile.
4. Optionally reconcile with bank-tools' own `resolve_merchant`/risk-signal tools (duplicate logic; merchant-intel adds decay, ambiguity, cache).
