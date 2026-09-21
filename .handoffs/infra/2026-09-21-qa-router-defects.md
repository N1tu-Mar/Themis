# QA findings in tools-adapter (from qa-demo). Repro: `pytest tests/e2e -k "xfail or twice or refresh"`; each has a strict xfail.

1. `infra/lambda/tools-adapter/dynamo_profile_store.py` `DynamoProfileStore.put()` returns None. `MerchantIntel._merge` returns its
   result, so the first `get_merchant_profile` on a stale profile performs the research, persists it, and answers
   `NOT_FOUND` (`test_stale_profile_refresh_returns_the_refreshed_profile_on_first_call`). The agent's transparent retry hides it
   (second call is a cache hit; research still runs once). Fix: return the stored `CacheRecord`. Note the store also drops the
   optimistic-lock `rev` / ConflictError contract of `merchant_intel.DynamoProfileStore`, so concurrent refreshes can double-research.
2. `router.escalate_case` does not dedupe: two calls with different idempotency keys queue two human-review requests
   (`test_escalating_twice_with_new_keys_queues_one_review`). `orchestrator.workflow.escalate_case` already dedupes by reason.
   Suggest delegating to it.
3. Info: a raising messenger (`send_customer_message`/`send_case_email`) leaves the idempotency claim IN_PROGRESS, so an immediate retry
   with the same key returns `IDEMPOTENCY_IN_PROGRESS` until the lease expires (safe, never double-sends, but not the "retry
   with the same key is safe and sends once" wording in the messaging handoff). Covered by `test_delivery_failure_never_touches_the_case`.
