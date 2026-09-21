"""MANUAL AWS smoke test. Never run by tests or CI; it invokes real (paid) AWS services: SNS, Lambda, AgentCore, Bedrock,
DynamoDB and, if the messaging Lambda replies, End User Messaging SMS to a reserved fictional number.

It publishes ONE synthetic inbound SMS for customer_demo_001 to the inbound SNS topic and waits for the messaging Lambda
to claim it in the idempotency table. It does not read or write bank data and moves no money.

Default is a dry plan (no boto3, no network). To run for real, all three are required:
  THEMIS_AWS_SMOKE=1  INBOUND_TOPIC_ARN=... IDEMPOTENCY_TABLE=...  (region from AWS_REGION)
  --expect-account <12-digit id>   must equal the caller's account, else abort before any call
  --run
Prerequisite: seed first (`seed.py --mode aws --confirm-aws`). See scripts/demo/RUNBOOK.md.
"""
from __future__ import annotations

import argparse
import json
import os
import time
import uuid
from datetime import UTC, datetime

CUSTOMER_PHONE = "+15555550100"  # fixtures/customers/demo.json customer_demo_001 (reserved fictional range)


def plan(topic: str, table: str) -> list[str]:
    return [f"sts:GetCallerIdentity (must equal --expect-account)", f"sns:Publish 1 message to {topic}",
            f"dynamodb:Scan {table} for a row claimed after the publish (<= --wait seconds)"]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run", action="store_true", help="actually call AWS")
    p.add_argument("--expect-account")
    p.add_argument("--wait", type=int, default=60)
    a = p.parse_args(argv)
    topic, table = os.environ.get("INBOUND_TOPIC_ARN", ""), os.environ.get("IDEMPOTENCY_TABLE", "")
    if not (topic and table):
        raise SystemExit("set INBOUND_TOPIC_ARN and IDEMPOTENCY_TABLE (see infra/README.md)")
    if not a.run:
        print("DRY PLAN (nothing called). Add --run with THEMIS_AWS_SMOKE=1 and --expect-account to execute:")
        print("\n".join(f"  - {s}" for s in plan(topic, table)))
        return 0
    if os.environ.get("THEMIS_AWS_SMOKE") != "1":
        raise SystemExit("refusing: set THEMIS_AWS_SMOKE=1 to acknowledge this calls real, paid AWS services")
    if not (a.expect_account and a.expect_account.isdigit() and len(a.expect_account) == 12):
        raise SystemExit("refusing: --expect-account must be the 12-digit AWS account id you intend to test")
    import boto3

    account = boto3.client("sts").get_caller_identity()["Account"]
    if account != a.expect_account:
        raise SystemExit(f"refusing: caller account {account} != --expect-account {a.expect_account}")
    started = datetime.now(UTC).isoformat()
    message_id = f"smoke-{uuid.uuid4().hex[:12]}"
    boto3.client("sns").publish(TopicArn=topic, Message=json.dumps({
        "originationNumber": CUSTOMER_PHONE, "inboundMessageId": message_id, "messageBody": "9.99 from ASTERIA"}))
    print(f"published {message_id} at {started}")
    ddb, deadline = boto3.client("dynamodb"), time.time() + a.wait
    while time.time() < deadline:
        for item in ddb.scan(TableName=table).get("Items", []):
            if item.get("claimedAt", {}).get("S", "") >= started:
                print(f"PASS: messaging Lambda claimed the message, state={item.get('state', {}).get('S')}")
                return 0
        time.sleep(3)
    print("FAIL: no claim row appeared; check `aws logs tail /aws/lambda/ThemisMessageNormalizer --since 5m`")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
