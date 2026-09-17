# Themis — Claude Code Operating Rules

`prompt.md` is the master product specification. Do **not** read it automatically. Read only the relevant section when the current task cannot be resolved from this file, the assigned workstream handoff, path-scoped rules, or existing interfaces.

## Start every work session
1. Run `git branch --show-current` and `git status --short`.
2. Confirm you are on your assigned `agent/<workstream>/<task>` branch, never `main` or `integration`.
3. Read only `docs/workstreams/<assigned-workstream>.md`.
4. Inspect only files required for the current task.
5. Implement; do not restate the architecture.

## Code discovery
- Call the `jcodemunch_guide` tool and strictly follow its instructions.
- For source-code discovery, prefer jCodeMunch symbol/outlines/context retrieval before whole-file reads.
- Fetch exact symbols or a token-budgeted context bundle instead of reading large files.
- Use `rg` directly for exact text in Markdown, config, fixtures, or files not represented well as symbols.
- Do not recursively inspect the repository.
- Do not read `node_modules`, `.next`, `dist`, `build`, coverage output, generated CDK output, binaries, lockfiles, or large fixtures unless the task specifically requires them.
- Never read a complete large source file merely to understand one function/class/symbol.

## Context discipline
- One concrete coding objective per session whenever practical.
- Do not reread files or instructions already known unless they materially changed.
- Do not paste large command output into context. Scope commands: `git log -5 --oneline`, `git diff -- <file>`, `tail -100`, targeted tests.
- Never load all of `prompt.md` just for a local implementation question.
- When prior conversation is no longer useful, prefer a fresh session or `/clear`; use `/compact` only when continuing the same objective.
- Persist durable state in the workstream handoff, not in long chat history.
- Do not add MCP servers, plugins, hooks, or dependencies solely for convenience without user approval.

## Git / parallel-agent rules
- Never push unless the user explicitly instructs you to push.
- Never work directly on `main` or `integration`.
- Prefer one Git worktree per concurrently running coding agent.
- Commit coherent local progress approximately every 3–5 minutes of active modification.
- Never create empty commits or commit syntactically broken half-edits just to satisfy the cadence.
- Stage only files you own; avoid `git add -A`.
- Never rebase, reset, amend, merge, or rewrite another worker's branch/history.
- Only the designated integration agent merges worker branches.
- If another workstream must change, create `.handoffs/<your-workstream>/<timestamp>-<request>.md`; do not edit its owned files.

## Ownership
- `packages/contracts/**`, `fixtures/**` → contracts
- `apps/dashboard/**` → frontend
- `services/bank-tools/**` → bank-tools
- `services/agent/**` → agentcore
- `services/merchant-intel/**` → merchant-intel
- `services/messaging/**` → messaging
- `infra/**` → infra
- `tests/e2e/**`, `scripts/demo/**` → qa-demo
- Root/shared files, lockfiles, architecture/submission docs → integration

## Testing
- During implementation, run the narrowest relevant test only.
- Before handoff, run the complete test set for your workstream.
- The integration agent runs the repository-wide suite.
- Mock paid/external AWS calls in normal automated tests.

## Product safety
- Synthetic banking data only.
- No real bank/card/account integrations or real money movement.
- LLMs may propose actions; deterministic policy must gate money/account-impacting actions.
- Do not label a real merchant fraudulent from public complaints alone.
- Never store hidden chain-of-thought; store evidence, structured decisions, and concise rationale.

## Stop conditions
Once the assigned acceptance criteria pass:
1. stop adding features,
2. run workstream tests,
3. update the workstream handoff to <=80 lines,
4. create a final local commit,
5. stop. Do not push.
