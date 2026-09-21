# Demo runbook

All synthetic data. Nothing here moves money or contacts a real customer.

## 1. Three-minute local demo (no network, no AWS)

```sh
scripts/demo/demo.sh            # paced to 180 s; `scripts/demo/demo.sh 0` runs instantly
```

Same output every run (case ids are relabelled `case_A`…; transcript sha256 printed last). Exit code 1 if any check fails.

| Time | Scene | What to say |
| --- | --- | --- |
| 0:00 | Intro | Real agent, real tool adapter, real Cedar policy text, Dynamo-shaped store; only the LLM is a keyword stub. |
| 0:20 | A | Five unrecognized recurring $9.99 charges → dispute allowed by policy; unrelated $19.99 offered, not disputed. |
| 0:55 | B | Charges after the customer's cancellation → `RECURRING_PAYMENT_AFTER_CANCELLATION`. |
| 1:15 | C | Customer recognizes the merchant → closed, no dispute opened. |
| 1:30 | D | 3DS-authenticated charge contradicts the claim → human review, no action, no accusation. |
| 1:55 | E | Asteria profile expired: case 1 pays for one research call. Process restarts. Case 2 (different customer) reads the durable cache: zero research, and its own ledger verification. |
| 2:40 | Reconciliation | Every case: ledger total = report total = case total; evidence, policy and audit rows agree. |

Known deviation to mention only if asked: Scenario A shows 5 of the 6 fixture charges (alias candidate defect,
`.handoffs/agentcore/2026-09-21-qa-alias-candidates.md`).

## 2. Verify (no paid calls)

```sh
python3 -m pytest -q tests/e2e            # 37 pass, 4 strict xfails = filed defects (see .handoffs/*/2026-09-21-qa-*)
node --test tests/e2e/*.test.ts           # messaging-boundary duplicates / failures
```

The e2e conftest blocks `boto3` and socket connects, so these cannot spend money.

## 3. Seed / reset

```sh
python3 scripts/demo/seed.py  --mode local                                  # in-process, prints digest
python3 scripts/demo/seed.py  --mode local --endpoint http://localhost:8000 # DynamoDB Local (tables from env)
python3 scripts/demo/reset.py --mode local --endpoint http://localhost:8000 # purge + reseed
```

AWS (real tables; export the five `*_TABLE` vars as in `infra/README.md`):

```sh
python3 scripts/demo/seed.py  --mode aws --confirm-aws
python3 scripts/demo/reset.py --mode aws --confirm-aws --i-know-this-deletes-all-rows   # only on a demo stack
```

## 4. AWS smoke test (manual, paid)

```sh
export INBOUND_TOPIC_ARN=… IDEMPOTENCY_TABLE=…
python3 scripts/demo/aws_smoke.py                                  # dry plan, calls nothing
THEMIS_AWS_SMOKE=1 python3 scripts/demo/aws_smoke.py --run --expect-account 123456789012
```

Publishes one inbound SNS message and waits for the messaging Lambda to claim it. Not executed by this workstream; live behavior is unverified.

## 5. If the live demo breaks

Run `scripts/demo/demo.sh` instead: it needs nothing external and produces the identical story.
