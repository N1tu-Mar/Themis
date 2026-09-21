"""Dynamo-backed merchant-intelligence cache stored in the shared merchants table."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from bank_tools.dynamo_store import from_attr, to_attr
from merchant_intel import CacheRecord

PREFIX = "I#"


def _item(**fields: Any) -> dict[str, Any]:
    return {key: to_attr(value) for key, value in fields.items()}


def _plain(item: dict[str, Any]) -> dict[str, Any]:
    return {key: from_attr(value) for key, value in item.items()}


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class DynamoProfileStore:
    """Persist CacheRecord metadata separately from bank-tools' P# contract-profile rows."""

    def __init__(self, client: Any, table_name: str) -> None:
        self.client = client
        self.table_name = table_name

    def get(self, merchant_id: str) -> CacheRecord | None:
        response = self.client.get_item(
            TableName=self.table_name,
            Key=_item(merchantId=f"{PREFIX}{merchant_id}"),
            ConsistentRead=True,
        )
        return self._record(_plain(response["Item"])) if response.get("Item") else None

    def put(self, record: CacheRecord) -> None:
        self.client.put_item(TableName=self.table_name, Item=_item(
            merchantId=f"{PREFIX}{record.profile['merchantId']}",
            profile=record.profile,
            researchedAt=_iso(record.researched_at),
            expiresAt=_iso(record.expires_at),
            version=record.version,
            sourceSummary=record.source_summary,
            caseStates=record.case_states,
        ))

    def all(self) -> list[CacheRecord]:
        args: dict[str, Any] = {
            "TableName": self.table_name,
            "FilterExpression": "begins_with(merchantId, :prefix)",
            "ExpressionAttributeValues": _item(**{":prefix": PREFIX}),
        }
        records: list[CacheRecord] = []
        while True:
            response = self.client.scan(**args)
            records.extend(self._record(_plain(item)) for item in response.get("Items", []))
            if not response.get("LastEvaluatedKey"):
                return records
            args["ExclusiveStartKey"] = response["LastEvaluatedKey"]

    @staticmethod
    def _record(row: dict[str, Any]) -> CacheRecord:
        return CacheRecord(
            profile=row["profile"],
            researched_at=_parse(row["researchedAt"]),
            expires_at=_parse(row["expiresAt"]),
            version=int(row.get("version", 1)),
            source_summary=row.get("sourceSummary", "internal profile"),
            case_states=dict(row.get("caseStates", {})),
        )
