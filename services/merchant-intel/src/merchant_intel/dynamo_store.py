"""DynamoDB ProfileStore over an injected low-level client (anything shaped like boto3.client("dynamodb")).

Layout in the existing ThemisMerchants table (pk merchantId), same keys as bank-tools' DynamoBankToolsStore:
- "P#<merchantId>": {merchantId, doc: MerchantProfile, researchedAt, expiresAt (ISO strings), version,
  sourceSummary, researchSources: bounded URL/retrieval metadata, caseStates: {caseId: state}, rev}.
  Rows seeded by bank-tools (only merchantId+doc) read fine: researchedAt := doc.updatedAt, expiry := +default_ttl.
- "A#<normalized alias>": {merchantId, target}; written only if absent or already pointing at the same merchant.
The table has no TTL attribute, so expiresAt is data, not deletion.

ponytail: all() is a filtered Scan (small synthetic table) and each put() rewrites the alias rows without a
transaction; upgrade to alias-row lookup / TransactWriteItems if the table grows.
"""
from datetime import timedelta
from typing import Any

from .service import DEFAULT_TTL, CacheRecord, ConflictError, iso, normalize, parse


def _attr(v: Any) -> dict[str, Any]:
    if v is None:
        return {"NULL": True}
    if isinstance(v, bool):
        return {"BOOL": v}
    if isinstance(v, (int, float)):
        return {"N": repr(v)}
    if isinstance(v, str):
        return {"S": v}
    if isinstance(v, (list, tuple)):
        return {"L": [_attr(x) for x in v]}
    if isinstance(v, dict):
        return {"M": {k: _attr(x) for k, x in v.items()}}
    raise TypeError(f"cannot serialize {type(v).__name__}")


def _plain(a: dict[str, Any]) -> Any:
    (kind, v), = a.items()
    if kind == "NULL":
        return None
    if kind == "N":
        return float(v) if any(c in v for c in ".eEn") else int(v)
    if kind == "L":
        return [_plain(x) for x in v]
    if kind == "M":
        return {k: _plain(x) for k, x in v.items()}
    return v  # S, BOOL


def _failed(exc: Exception) -> bool:
    return getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"


class DynamoProfileStore:
    def __init__(self, client: Any, table: str, *, default_ttl: timedelta = DEFAULT_TTL) -> None:
        self._c, self._table, self._ttl = client, table, default_ttl

    def _record(self, row: dict[str, Any]) -> CacheRecord:
        profile = row["doc"]
        researched = parse(row.get("researchedAt") or profile["updatedAt"])
        return CacheRecord(
            profile, researched, parse(row["expiresAt"]) if row.get("expiresAt") else researched + self._ttl,
            row.get("version", 1), row.get("sourceSummary", "internal profile"), row.get("caseStates", {}),
            row.get("rev", 0), row.get("researchSources", []))

    def get(self, merchant_id: str) -> CacheRecord | None:
        resp = self._c.get_item(TableName=self._table, Key={"merchantId": {"S": f"P#{merchant_id}"}}, ConsistentRead=True)
        return self._record({k: _plain(v) for k, v in resp["Item"].items()}) if resp.get("Item") else None

    def all(self) -> list[CacheRecord]:
        args: dict[str, Any] = {
            "TableName": self._table, "ConsistentRead": True, "FilterExpression": "begins_with(merchantId, :p)",
            "ExpressionAttributeValues": {":p": {"S": "P#"}}}
        out: list[CacheRecord] = []
        while True:
            resp = self._c.scan(**args)
            out += [self._record({k: _plain(v) for k, v in i.items()}) for i in resp.get("Items", [])]
            if not resp.get("LastEvaluatedKey"):
                return out
            args["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    def put(self, record: CacheRecord) -> CacheRecord:
        p, rev = record.profile, record.rev
        item = {
            "merchantId": f"P#{p['merchantId']}", "doc": p, "researchedAt": iso(record.researched_at),
            "expiresAt": iso(record.expires_at), "version": record.version, "sourceSummary": record.source_summary,
            "researchSources": record.sources,
            "caseStates": record.case_states, "rev": rev + 1}
        cond = ({"ConditionExpression": "attribute_not_exists(merchantId)"} if rev < 0 else
                {"ConditionExpression": "attribute_not_exists(#r) OR #r = :r", "ExpressionAttributeNames": {"#r": "rev"},
                 "ExpressionAttributeValues": {":r": _attr(rev)}})  # no rev attr = bank-tools-seeded row = rev 0
        try:
            self._c.put_item(TableName=self._table, Item={k: _attr(v) for k, v in item.items()}, **cond)
        except Exception as exc:
            if _failed(exc):
                raise ConflictError(p["merchantId"]) from exc
            raise
        for alias in [p["canonicalName"], *p["aliases"]]:
            self._alias(normalize(alias), p["merchantId"])
        return CacheRecord(p, record.researched_at, record.expires_at, record.version, record.source_summary,
                           record.case_states, rev + 1, record.sources)

    def _alias(self, alias: str, merchant_id: str) -> None:
        if not alias:
            return
        try:
            self._c.put_item(
                TableName=self._table, Item={k: _attr(v) for k, v in
                                             {"merchantId": f"A#{alias}", "target": merchant_id}.items()},
                ConditionExpression="attribute_not_exists(merchantId) OR target = :t",
                ExpressionAttributeValues={":t": _attr(merchant_id)})
        except Exception as exc:
            if not _failed(exc):  # taken by another merchant: leave it, resolve() reports the ambiguity
                raise
