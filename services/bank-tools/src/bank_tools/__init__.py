"""Bank tools: narrow, typed, idempotent tools over synthetic banking records.

See docs/workstreams/bank-tools.md and .claude/rules/bank-tools.md for scope.
No external network/AWS calls happen from this package; storage is in-memory,
seeded from fixtures/. Financial actions are simulated only (see prompt.md #48).
"""
