"""Build and apply a deterministic, synthetic-only DynamoDB seed plan."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .aws import AwsCli, OpsError, require_outputs


DATA_OUTPUTS = {
    "transactions": "TransactionsTableName",
    "cases": "CasesTableName",
    "merchants": "MerchantsTableName",
}
EXPECTED_TABLES = {
    "transactions": "ThemisTransactions",
    "cases": "ThemisCases",
    "merchants": "ThemisMerchants",
}


def attr(value: Any) -> dict[str, Any]:
    if value is None:
        return {"NULL": True}
    if isinstance(value, bool):
        return {"BOOL": value}
    if isinstance(value, (int, float)):
        return {"N": repr(value)}
    if isinstance(value, str):
        return {"S": value}
    if isinstance(value, list):
        return {"L": [attr(item) for item in value]}
    if isinstance(value, dict):
        return {"M": {key: attr(item) for key, item in value.items()}}
    raise OpsError(f"unsupported fixture value: {type(value).__name__}")


def item(value: dict[str, Any]) -> dict[str, Any]:
    return {key: attr(field) for key, field in value.items()}


def normalize_alias(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


@dataclass(frozen=True)
class SeedPlan:
    items: dict[str, list[dict[str, Any]]]
    digest: str

    @property
    def counts(self) -> dict[str, int]:
        return {name: len(rows) for name, rows in self.items.items()}


def _load(path: Path) -> list[dict[str, Any]]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OpsError(f"cannot read fixture {path}: {exc}") from exc
    if not isinstance(value, list) or not all(isinstance(row, dict) for row in value):
        raise OpsError(f"fixture must be an array of objects: {path}")
    return value


def build_seed_plan(repo_root: Path) -> SeedPlan:
    fixtures = repo_root / "fixtures"
    customers = _load(fixtures / "customers" / "demo.json")
    transactions = _load(fixtures / "transactions" / "demo.json")
    merchants = _load(fixtures / "merchants" / "demo.json")
    profiles = _load(fixtures / "merchants" / "demo-profiles.json")
    cases = _load(fixtures / "cases" / "demo.json")
    evidence = _load(fixtures / "cases" / "demo-evidence.json")

    merchant_rows: list[dict[str, Any]] = []
    for customer in customers:
        merchant_rows.append({"merchantId": f"C#{customer['customerId']}", "doc": customer})
    for merchant in merchants:
        merchant_rows.append({"merchantId": f"M#{merchant['merchantId']}", "doc": merchant})
        for alias in [merchant["canonicalName"], *merchant["aliases"]]:
            normalized = normalize_alias(alias)
            if normalized:
                merchant_rows.append({"merchantId": f"A#{normalized}", "target": merchant["merchantId"]})
    for profile in profiles:
        merchant_rows.append({"merchantId": f"P#{profile['merchantId']}", "doc": profile})

    plain = {
        "transactions": transactions,
        "cases": [*cases, *({"caseId": f"E#{row['evidenceId']}", "doc": row} for row in evidence)],
        "merchants": merchant_rows,
    }
    encoded = {name: [item(row) for row in rows] for name, rows in plain.items()}
    canonical = json.dumps(encoded, sort_keys=True, separators=(",", ":"))
    return SeedPlan(encoded, hashlib.sha256(canonical.encode()).hexdigest())


def discover_seed_tables(aws: AwsCli) -> dict[str, str]:
    outputs = require_outputs(aws.outputs("ThemisData"), DATA_OUTPUTS.values(), "ThemisData")
    tables = {name: outputs[output] for name, output in DATA_OUTPUTS.items()}
    for logical, table_name in tables.items():
        if table_name != EXPECTED_TABLES[logical]:
            raise OpsError(f"refusing unexpected {logical} table name: {table_name}")
        description = aws.json("dynamodb", "describe-table", "--table-name", table_name).get("Table", {})
        arn = str(description.get("TableArn", ""))
        expected_prefix = f"arn:aws:dynamodb:{aws.target.region}:{aws.target.account}:table/{table_name}"
        if arn != expected_prefix:
            raise OpsError(f"refusing table outside target account/region: {arn or '<missing ARN>'}")
        if description.get("TableStatus") != "ACTIVE":
            raise OpsError(f"refusing inactive table {table_name}: {description.get('TableStatus')}")
    return tables


def apply_seed(aws: AwsCli, plan: SeedPlan, tables: dict[str, str]) -> int:
    written = 0
    for logical, rows in plan.items.items():
        table = tables[logical]
        for offset in range(0, len(rows), 25):
            pending = {table: [{"PutRequest": {"Item": row}} for row in rows[offset:offset + 25]]}
            for attempt in range(8):
                response = aws.json(
                    "dynamodb", "batch-write-item", "--cli-input-json", "file:///dev/stdin",
                    input_json={"RequestItems": pending},
                )
                pending = response.get("UnprocessedItems", {})
                if not pending:
                    written += len(rows[offset:offset + 25])
                    break
            else:
                raise OpsError(f"DynamoDB still returned unprocessed {logical} items after 8 attempts")
    return written

