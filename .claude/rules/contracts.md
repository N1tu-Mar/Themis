---
paths:
  - "packages/contracts/**"
  - "fixtures/**"
---

# Contracts and fixtures workstream

- Shared contracts are authoritative boundaries between workstreams.
- Keep schemas compact, explicit, and versionable.
- Core types: Transaction, TransactionAuthSignals, Merchant, MerchantProfile, MerchantRiskSignal, Case, CaseStatus, Evidence, ResolutionProposal, PolicyDecision, HumanReviewRequest, InboundMessage, OutboundMessage, CaseReport.
- Do not duplicate domain definitions inside services.
- Fixture data must be fictional and synthetic.
- Demo merchant: Asteria Digital; aliases may include `ASTERIA.IO`, `ASTERIA*PREMIUM`, `ASTDIGITAL`, `ASTERIA SUB`.
- Dataset target is modest: roughly 50 customers, 1k–2k transactions, 40 merchants, 10–15 historical disputes.
- Do not generate benchmark-scale fixture data.
