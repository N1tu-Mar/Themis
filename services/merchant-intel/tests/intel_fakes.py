import json
from datetime import UTC, datetime, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


class FakeClock:
    def __init__(self, now: datetime) -> None:
        self.t = now

    def now(self) -> datetime:
        return self.t

    def advance(self, **kw) -> None:
        self.t += timedelta(**kw)


class FakeResearcher:
    """No network: canned findings, counts calls."""

    def __init__(self, findings=None, fail=False) -> None:
        self.calls, self.findings, self.fail = [], findings or {"sourceSummary": "canned"}, fail

    def research(self, merchant_id, canonical_name):
        self.calls.append(merchant_id)
        if self.fail:
            raise RuntimeError("browser down")
        return self.findings


def load(name):
    return json.loads((ROOT / "fixtures/merchants" / name).read_text(encoding="utf-8"))


class FakeDynamo:
    """Just enough low-level DynamoDB: get_item, put_item (the conditions merchant_intel uses), scan."""

    def __init__(self, page_size=100) -> None:
        self.items, self.page_size, self.before_put = {}, page_size, None

    def get_item(self, *, TableName, Key, ConsistentRead=False):
        item = self.items.get(Key["merchantId"]["S"])
        return {"Item": item} if item else {}

    def put_item(self, *, TableName, Item, ConditionExpression=None, ExpressionAttributeValues=None,
                 ExpressionAttributeNames=None):
        if self.before_put:
            hook, self.before_put = self.before_put, None
            hook()
        key, cur = Item["merchantId"]["S"], self.items.get(Item["merchantId"]["S"])
        ok = True
        if ConditionExpression == "attribute_not_exists(merchantId)":
            ok = cur is None
        elif ConditionExpression == "attribute_not_exists(#r) OR #r = :r":
            ok = cur is not None and ("rev" not in cur or cur["rev"] == ExpressionAttributeValues[":r"])
        elif ConditionExpression == "attribute_not_exists(merchantId) OR target = :t":
            ok = cur is None or cur["target"] == ExpressionAttributeValues[":t"]
        if not ok:
            err = Exception("conditional")
            err.response = {"Error": {"Code": "ConditionalCheckFailedException"}}
            raise err
        self.items[key] = Item

    def scan(self, *, TableName, FilterExpression, ExpressionAttributeValues, ConsistentRead=False,
             ExclusiveStartKey=None):
        prefix = ExpressionAttributeValues[":p"]["S"]
        rows = [i for k, i in sorted(self.items.items()) if k.startswith(prefix)]
        start = int(ExclusiveStartKey["n"]["S"]) if ExclusiveStartKey else 0
        page = rows[start:start + self.page_size]
        more = start + self.page_size < len(rows)
        return {"Items": page, **({"LastEvaluatedKey": {"n": {"S": str(start + self.page_size)}}} if more else {})}
