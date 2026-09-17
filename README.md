# Themis

Repository bootstrap for parallel development. Product requirements are in `prompt.md`; operating rules are in `CLAUDE.md`.

Use Node.js 22 or newer and Python 3.12. Run `npm ci`, then `npm run check`. Python workers can create their environment with `python3.12 -m venv .venv`; runtime dependencies will be pinned centrally when implementations need them.

Consume `@themis/contracts` in TypeScript. Python workers can validate serialized boundaries against `packages/contracts/schemas.json` (JSON Schema 2020-12). See `packages/contracts/README.md` for conventions and state transitions.

Only contracts and representative synthetic fixtures are implemented. Other directories are workstream placeholders. No external services are invoked.
