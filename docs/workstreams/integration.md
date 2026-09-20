# Integration workstream

## STATUS

WORKERS_MERGED_AND_COMPOSED (local; no live AWS calls made)

## DONE

- Merged in order: bank-tools/dynamo-dispatch, merchant-intel/core, agentcore/runtime, messaging/runtime-composition. No conflicts.
- Root `npm install` done (messaging deps + `@aws-sdk/client-sesv2`, `@aws-sdk/client-pinpoint-sms-voice-v2` for outbound); lockfile committed.
- 20-tool ownership frozen in `infra/lambda/tools-adapter/router.py::TOOL_OWNERS`, checked against `infra/config/tool-schemas.ts` by `tests/integration/test_tool_mapping.py` (owner, every camelCase argument + required flag, idempotencyKey).
- Tools adapter (`infra/lambda/tools-adapter/{handler,router}.py`): every tool goes through `bank_tools.dispatch` (validation + idempotency); bank tools -> bank-tools, 3 merchant tools -> merchant-intel, `generate_case_report`/`escalate_case` -> `orchestrator/workflow.py`, `send_*` -> messaging Lambda invoke.
- Messaging Lambda is the Node bundle (`services/messaging/dist`); placeholder Python normalizer deleted. It now sends the agent's reply outbound and serves direct `{themisTool}` events from the adapter.
- Agent runtime accepts the shared `InboundMessage` (sender phone -> customerId via bundled `customers.json`; unknown sender -> UNVERIFIED reply, no case). Gateway calls use the `themis-tools___<tool>` name; Cedar denial on `propose_*` becomes REQUIRE_HUMAN_REVIEW so the engine calls `escalate_case`.
- Schema/argument fix: `get_customer_dispute_history.limit` (agent sent it; Gateway/bank rejected it) now declared in both.
- Assets: `scripts/build_assets.py` stages `infra/build/{tools-adapter,agent-runtime}` (run by infra `build`; `package:aws` vendors boto3).
- Policy: Cedar text and Python policy agree on thresholds/claim types/gates (`test_policy_compat.py`, evaluates the real .cedar).
- Local composition: `tests/integration/composition.test.ts` (SNS -> messaging -> orchestrator -> tools -> policy -> report/escalation -> outbound capture).

## CURRENT INTERFACES

- Runtime `POST /invocations`: InboundMessage in, `{reply,status,caseId}` out; messaging sends `reply` (`messageId=reply:<inbound id>`, `caseId` falls back to `no-case-yet`).
- Messaging direct events: `{themisTool:"send_customer_message",message}` / `{themisTool:"send_case_email",case,report,recipient,nextSteps}` -> `{messageId}`.
- Reports: S3 `reports/<caseId>.json`. Idempotency: table PK `idempotencyKey`; bank rows `<tool>#<key>`, messaging rows SHA-256 of key.

## KNOWN ISSUES / REMAINING PLACEHOLDERS

- Merchant-intel cache is per-Lambda-container, seeded from synthetic profiles; no durable ProfileStore, no researcher (`NoResearch`).
- Customer directory is a bundled fixture file (phone -> customerId); no identity service.
- Gateway wire format (tool-name prefix, Lambda target context key, policy-denial text) is unverified live.
- SMS ConfigurationSet delivery events publish to the inbound SMS topic; the normalizer rejects them as malformed (needs its own topic).
- Agent replies during an open case menu are plain text (no RCS suggestions); active-menu store is not written by the workflow.
- Escalations double-queue review requests when policy escalates (bank-tools writes one, `escalate_case` another).
- `merchant_intel` wheel does not carry `schemas.json` (assets stage it beside the package).

## BLOCKING A REAL AWS DEPLOY

- Needs `THEMIS_MODE=aws`, Bedrock model IDs, and manually provisioned RCS pool / SMS identity / SES sender (`THEMIS_RCS_POOL_ID` etc.).
- `npm run package:aws` (boto3 vendoring) for the Runtime zip; verify CFN enums (`PYTHON_3_12`, `AWS_IAM`) and Gateway/Runtime wire behavior on first deploy.
- Demo data must be seeded into DynamoDB (`load_demo_store(..., store=DynamoBankToolsStore(...))`).

## LAST TEST COMMAND + RESULT

`npm run check` + `git diff --check`: pass. contracts 35, dashboard 14, messaging 30, infra 30, Python 166 (bank 108, merchant 14, agent 31, integration 13), integration TS 2. Wheels built for all 3 Python services.

## LAST CODE COMMIT

See `git log -1` on main.
