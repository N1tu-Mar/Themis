"""Reset demo state to the deterministic seed. Same explicit modes/guards as seed.py.

  --mode local                      rebuilds the in-process world and proves it equals the seed digest (nothing persists)
  --mode local --endpoint URL       deletes every row in the five tables on DynamoDB Local, then reseeds
  --mode aws --confirm-aws          same on the real tables; additionally needs --i-know-this-deletes-all-rows
"""
from __future__ import annotations

import argparse
import json

from seed import DemoDynamo, add_mode_args, digest, make_client, seed


def purge(client, tables) -> int:
    n = 0
    for table in (tables.transactions, tables.cases, tables.merchants, tables.audit, tables.idempotency):
        keys = [k["AttributeName"] for k in client.describe_table(TableName=table)["Table"]["KeySchema"]]
        args = {"TableName": table}
        while True:
            page = client.scan(**args)
            for item in page.get("Items", []):
                client.delete_item(TableName=table, Key={k: item[k] for k in keys})
                n += 1
            if not page.get("LastEvaluatedKey"):
                break
            args["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return n


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_mode_args(p)
    p.add_argument("--i-know-this-deletes-all-rows", action="store_true")
    a = p.parse_args(argv)
    if a.mode == "aws" and not a.i_know_this_deletes_all_rows:
        raise SystemExit("refusing: aws reset deletes every row in the five tables; add --i-know-this-deletes-all-rows")
    client, tables = make_client(a.mode, a.endpoint, a.confirm_aws)
    deleted = purge(client, tables)
    counts = seed(client, tables)
    print(json.dumps({"mode": a.mode, "deleted": deleted, **counts, **({"digest": digest(client)} if isinstance(client, DemoDynamo) else {})}, indent=2))


if __name__ == "__main__":
    main()
