# Request: Amplify compute role + env for the dashboard live data source

From: frontend (`agent/frontend/live-data`) -> infra (`infra/stacks/web-stack.ts`)

The dashboard stays on fixtures unless `THEMIS_DASHBOARD_DATA_SOURCE=aws`. Reads happen only in server
components through the SDK default credential chain (the Amplify compute role). No credential or table name
is ever sent to the browser; no `NEXT_PUBLIC_*` variables are used.

## Environment (Amplify app)
- Add `THEMIS_DASHBOARD_DATA_SOURCE=aws` (only when data should be live).
- Already present and reused unchanged: `CASES_TABLE`, `MERCHANTS_TABLE`, `AUDIT_TABLE`, `ARTIFACTS_BUCKET`.
- Amplify WEB_COMPUTE only exposes app env vars to the SSR runtime if the build writes them to
  `.env.production` (e.g. `env | grep -E '^(THEMIS_|CASES_|MERCHANTS_|AUDIT_|ARTIFACTS_)' >> apps/dashboard/.env.production`
  in the build spec). Please confirm the build spec does this.
- The region comes from `AWS_REGION` in the runtime; if Amplify does not set it, set it explicitly.

## Compute role grants (read-only; replace the log-only role comment in web-stack.ts)
- `dynamodb:Scan`, `dynamodb:GetItem`, `dynamodb:Query` on the cases, merchants and audit tables
  (`table.grantReadData` covers this). No write actions.
- `s3:GetObject` on `arn:<artifacts bucket>/reports/*`.
- `s3:ListBucket` on the artifacts bucket, conditioned on `s3:prefix = reports/*`. Without it S3 returns
  AccessDenied instead of NoSuchKey for a not-yet-written report, which the dashboard would show as a backend error.
- No KMS grant needed while the bucket uses S3-managed encryption.

## Data-layout assumptions (owned by bank-tools / agentcore; tell me if they change)
- cases table: flat Case rows keyed `caseId`; `E#...` rows are evidence and are skipped.
- merchants table: `P#<merchantId>` rows with `{doc: MerchantProfile}`. If merchant-intel's durable store
  writes profiles elsewhere or wraps them in a cache record, the dashboard will not see updates.
- audit table: `{caseId, eventId, doc}`; `audit_*` = AuditEvent, `review_*` = HumanReviewRequest.
- S3 `reports/<caseId>.json` = CaseReport.
- The dashboard uses table Scan for the case, merchant and review lists (full scan + filter). Fine for
  demo/pilot volume; add a GSI or a record-type index before tables reach thousands of rows.

## Review actions
Read-only: the dashboard has no review-decision API and its buttons are disabled. A decision write path needs
a separate authenticated API; do not grant the compute role write access.
