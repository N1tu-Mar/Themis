"""Deterministic demo data load into DynamoDB. Modes are explicit and guarded:

  --mode local                      in-process fake, no network (prints a content digest; identical on every run)
  --mode local --endpoint URL       DynamoDB Local (localhost/127.0.0.1 only), tables from env
  --mode aws --confirm-aws          real tables from env (TRANSACTIONS_TABLE, CASES_TABLE, MERCHANTS_TABLE, AUDIT_TABLE,
                                    IDEMPOTENCY_TABLE); writes synthetic data only; refuses --endpoint

Re-running is safe: bank-tools rows are overwritten with identical content and merchant-intel keeps durable cache rows.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from urllib.parse import urlparse

from world import DemoDynamo, PROFILES, ROOT, DynamoBankToolsStore, DynamoProfileStore, MerchantIntel, load_demo_store  # noqa: F401
from bank_tools.dynamo_store import Tables  # noqa: E402
from fake_dynamo import TABLES  # noqa: E402


def make_client(mode: str, endpoint: str | None = None, confirm_aws: bool = False):
    """(client, Tables). Raises SystemExit before any boto3 import when a guard fails."""
    if mode == "local" and not endpoint:
        return DemoDynamo(), TABLES
    if mode == "local":
        if urlparse(endpoint).hostname not in ("localhost", "127.0.0.1"):
            raise SystemExit(f"refusing: local mode only talks to localhost, got {endpoint}")
    elif endpoint:
        raise SystemExit("refusing: --endpoint is for local mode; aws mode uses the real service")
    elif not confirm_aws:
        raise SystemExit("refusing: aws mode writes to real tables; re-run with --confirm-aws")
    tables = Tables.from_env()
    import boto3
    if mode == "local":
        return boto3.client("dynamodb", endpoint_url=endpoint, region_name=os.environ.get("AWS_REGION", "us-east-1"),
                            aws_access_key_id="local", aws_secret_access_key="local"), tables
    return boto3.client("dynamodb"), tables


def seed(client, tables) -> dict[str, int]:
    store = load_demo_store(ROOT, DynamoBankToolsStore(client, tables))
    intel = MerchantIntel(DynamoProfileStore(client, tables.merchants))
    intel.load_profiles(json.loads(PROFILES.read_text(encoding="utf-8")))
    return {"customers": len(json.loads((ROOT / "fixtures/customers/demo.json").read_text(encoding="utf-8"))),
            "transactions": len(json.loads((ROOT / "fixtures/transactions/demo.json").read_text(encoding="utf-8"))),
            "merchantProfiles": len(intel.store.all()), "cases": len(json.loads((ROOT / "fixtures/cases/demo.json").read_text(encoding="utf-8")))}


def digest(client: DemoDynamo) -> str:
    """sha256 over every stored row (fake client only), order-independent."""
    rows = sorted(json.dumps([t, sorted(map(str, k)), v], sort_keys=True) for t, r in client.rows.items() for k, v in r.items())
    return hashlib.sha256("\n".join(rows).encode()).hexdigest()


def add_mode_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--mode", choices=["local", "aws"], required=True)
    p.add_argument("--endpoint", help="DynamoDB Local URL (local mode only)")
    p.add_argument("--confirm-aws", action="store_true", help="required for --mode aws")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_mode_args(p)
    a = p.parse_args(argv)
    client, tables = make_client(a.mode, a.endpoint, a.confirm_aws)
    counts = seed(client, tables)
    print(json.dumps({"mode": a.mode, "tables": tables.__dict__ if a.mode == "aws" or a.endpoint else "in-process", **counts,
                      **({"digest": digest(client)} if isinstance(client, DemoDynamo) else {})}, indent=2))


if __name__ == "__main__":
    main()
