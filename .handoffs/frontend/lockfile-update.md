# Frontend → Integration: lockfile update needed

`apps/dashboard/package.json` now declares real dependencies (next, react,
tailwindcss, vitest, testing-library, etc). I ran `npm install --workspace
apps/dashboard` locally to build/test, which touched root `package-lock.json`.

Per ownership rules I did not commit the lockfile change myself. Please run
`npm install` at repo root and commit `package-lock.json` so other workspaces
get a consistent lockfile.

Also bumped `next` to `15.5.25` (from the version npm's registry initially
resolved) to clear a known CVE in 15.5.3. Left a few remaining `npm audit`
findings (vitest/esbuild/postcss transitive, one in `sharp`) — all dev-tooling
surface, fixes require breaking major bumps (next 16, vitest range change).
Flagging for awareness, not blocking.
