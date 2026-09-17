---
paths:
  - "tests/e2e/**"
  - "scripts/demo/**"
---

# QA / demo workstream

- Preserve a deterministic 3-minute demo path.
- Cover: unknown recurring merchant, canceled subscription, forgotten legitimate subscription, conflicting evidence -> human review, and institutional-memory/cache reuse.
- The second Asteria case must reuse stored merchant intelligence and skip duplicate external research.
- Normal tests mock paid/external AWS network calls.
- Demo reset/load scripts must restore deterministic synthetic state.
- Validate idempotency for repeated inbound messages and state-changing operations.
- Prefer high-value scenario tests over huge low-value test matrices.
