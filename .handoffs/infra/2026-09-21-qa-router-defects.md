# QA notes on tools-adapter (from qa-demo)

Two defects found on a391623 (profile store `put()` returned None so the first stale-profile read answered NOT_FOUND;
`escalate_case` queued a duplicate review for a fresh key) were fixed by b961271; their e2e tests now pass as normal tests.

Remaining, informational: when the messaging transport raises (`send_customer_message` / `send_case_email`), bank-tools leaves the
idempotency claim IN_PROGRESS, so an immediate retry with the same key returns `IDEMPOTENCY_IN_PROGRESS` until the lease expires.
Safe (never double-sends) but slower than "retry with the same key is safe and sends once" in the messaging handoff. A soft
`{"status": "FAILED"}` (SES rejection) releases the claim and retries fine. Pinned by
`tests/e2e/test_failures.py::test_delivery_failure_never_touches_the_case` and `::test_ses_rejection_...`.
