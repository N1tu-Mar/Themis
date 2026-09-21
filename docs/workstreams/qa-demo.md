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
- World pins `Config(structured_tools=True)` (now the default after b961271).

## KNOWN ISSUES (agentcore items are strict xfails that flip when fixed)

- agentcore `2026-09-21-qa-alias-candidates.md`: Scenario A matches 5 of 6 charges.
- agentcore `2026-09-21-qa-report-failure.md`: failed report swallowed, customer told it was prepared.
- infra `2026-09-21-qa-router-defects.md`: profile-store/escalate defects fixed by b961271; raising messenger still leaves an IN_PROGRESS claim until lease expiry (info).
- messaging `2026-09-21-qa-stuck-claims.md`: failed agent invoke leaves customer unanswered (reconciler unwired).
- Root `npm test` does not run `tests/e2e`; integration should add `pytest tests/e2e` and `node --test tests/e2e/*.test.ts`.
- Based on local `main` b961271 (Wave 2A complete); `origin/main` is behind and was not used.

## NEXT 3 TASKS

1. Integration: wire e2e commands into root `check`.
2. After defects land, drop the xfail markers.
3. Run `aws_smoke.py --run` once against a deployed stack and record the result.

## LAST TEST COMMAND + RESULT

- `python3 -m pytest -q tests/e2e tests/integration` -> 58 passed, 2 xfailed (strict, filed defects); `node --test tests/e2e/*.test.ts` -> 5 passed.

## LAST CODE COMMIT

- See `git log -1` on agent/qa/demo-complete.
