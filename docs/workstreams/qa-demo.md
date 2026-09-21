# QA / Demo workstream

## STATUS

COMPLETE (local); AWS smoke script written, never run live.

## DONE

- `scripts/demo/world.py`: deterministic no-network world (real orchestrator, tools adapter, Cedar text, bank-tools + merchant-intel over a Dynamo fake, fixed clock) plus per-case/total reconciliation.
- `seed.py` / `reset.py`: explicit `--mode local|aws` (+ `--endpoint` DynamoDB Local), guarded, idempotent, digest-checked.
- `run_demo.py` + `demo.sh` + `RUNBOOK.md`: three-minute deterministic demo, identical transcript every run.
- `aws_smoke.py`: dry plan by default; `--run` needs `THEMIS_AWS_SMOKE=1` and `--expect-account`.
- `tests/e2e`: scenarios A-D, E (two customers, durable cache, zero second research, customer-specific verification), duplicate mutating tools, duplicate inbound (TS), failures (Bedrock, tool, policy, messaging, SES, partial), scripts/guards. conftest blocks boto3 and sockets.

## CURRENT INTERFACES

- Python: `world.World(permits, model, researcher, clock, config)`, `.chat()`, `.restart()`, `.gateway.fail(tool, n, kind)`, `.messenger.fail`, `reconcile_case`, `reconcile_world`.
- Reuses (does not edit): `tests/integration/harness.py` (CedarGate), `services/bank-tools/tests/fake_dynamo.py`, `infra/lambda/tools-adapter`.
- Scenarios run with `Config(structured_tools=True)`; with it off, Scenario C stays CLASSIFYING_DISPUTE server-side (schema must be deployed first).

## KNOWN ISSUES (filed, each a strict xfail that flips when fixed)

- agentcore `2026-09-21-qa-alias-candidates.md`: Scenario A matches 5 of 6 charges.
- agentcore `2026-09-21-qa-report-failure.md`: failed report swallowed, customer told it was prepared.
- infra `2026-09-21-qa-router-defects.md`: profile store `put()` returns None (first stale read = NOT_FOUND); `escalate_case` not deduped across keys; raising messenger leaves IN_PROGRESS claim.
- messaging `2026-09-21-qa-stuck-claims.md`: failed agent invoke leaves customer unanswered (reconciler unwired).
- Root `npm test` does not run `tests/e2e`; integration should add `pytest tests/e2e` and `node --test tests/e2e/*.test.ts`.
- Base was local `main` (has Wave 2A merges); `origin/main` is 8 commits behind.

## NEXT 3 TASKS

1. Integration: wire e2e commands into root `check`.
2. After defects land, drop the xfail markers.
3. Run `aws_smoke.py --run` once against a deployed stack and record the result.

## LAST TEST COMMAND + RESULT

- `python3 -m pytest -q tests/e2e` -> 37 passed, 4 xfailed; `node --test tests/e2e/*.test.ts` -> 5 passed; `tests/integration` 13 passed.

## LAST CODE COMMIT

- See `git log -1` on agent/qa/demo-complete.
