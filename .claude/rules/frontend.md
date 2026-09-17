---
paths:
  - "apps/dashboard/**"
---

# Dashboard workstream

- Stack: Next.js + React + TypeScript + Tailwind + shadcn/ui + Zod.
- Required routes: `/cases`, `/cases/[caseId]`, `/merchants`, `/merchants/[merchantId]`, `/review`.
- Dashboard is secondary to the customer messaging experience.
- Prioritize case/evidence/policy/audit clarity over decorative charts.
- Show interpretable merchant risk signals, not a simplistic 'fraud score'.
- Use existing shared contracts; do not create competing domain models.
- Do not add Redux or a large state library unless a demonstrated need exists.
- Visual direction: calm, professional, high-information-density financial operations product.
- Avoid cyberpunk/neon/hacker aesthetics and unnecessary animation.
