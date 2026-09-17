---
paths:
  - "services/bank-tools/**"
---

# Bank tools workstream

- Tools are narrow, typed, idempotent where possible, and operate only on synthetic data.
- Prefer one conceptual operation per tool.
- Return compact structured JSON; never dump a complete account history by default.
- Required families: transaction lookup, auth signals, case CRUD, merchant lookup, audit persistence, synthetic protected actions.
- Do not expose arbitrary SQL, arbitrary shell, arbitrary HTTP, or generic database-write tools to the runtime agent.
- Every state-changing action needs an idempotency key or equivalent protection.
- Financial/account-impacting actions remain simulated and policy-gated.
- Audit meaningful automated actions with case ID, action, tool, timestamp, and result.
