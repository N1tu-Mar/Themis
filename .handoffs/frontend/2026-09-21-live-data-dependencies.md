# Request: root install + lockfile for dashboard live data

From: frontend (`agent/frontend/live-data`) -> integration

`apps/dashboard/package.json` now declares two runtime dependencies (server-side only):

- `@aws-sdk/client-dynamodb` ^3.888.0 (already in the lockfile via messaging)
- `@aws-sdk/client-s3` ^3.888.0 (NEW to the lockfile)

Please run `npm install` at the repo root and commit `package-lock.json`. I did not commit the lockfile
(root/shared file). The dashboard also builds `@themis/contracts` first (`npm run build` at root already orders this).
Verified locally with these versions: `next build`, `vitest run` (36 tests) pass.
