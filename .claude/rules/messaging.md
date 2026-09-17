---
paths:
  - "services/messaging/**"
---

# Messaging workstream

- Primary customer channel: AWS End User Messaging RCS with SMS-compatible fallback.
- Formal case communication: Amazon SES.
- Normalize inbound RCS/SMS into one internal message contract before the dispute agent sees it.
- RCS postbacks and SMS numeric/text replies must map to the same internal intent.
- Messaging retries must not create duplicate cases, credits, reports, or notifications.
- Store/process message IDs for idempotency.
- Rich RCS controls are optional enhancements; every required flow must still work through text.
- Mock paid/external messaging calls in routine tests.
- SES messages are generated from structured case data, not invented free-form facts.
