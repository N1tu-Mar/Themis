---
paths:
  - "services/merchant-intel/**"
---

# Merchant intelligence workstream

- Resolve descriptor aliases to a canonical synthetic merchant identity.
- Prefer cached merchant intelligence; do not browse the same merchant repeatedly.
- Default demo cache TTL is configurable; initial target is 7 days.
- External research is supporting evidence, never automatic proof of fraud.
- Limit external research to facts that can change the current case.
- Store source summary, aliases, billing patterns, risk signals, researched timestamp, expiry, and version.
- Merchant risk must be time-aware and capable of decaying.
- A prior complaint never makes every future transaction fraudulent.
- New cases still require customer-specific verification.
