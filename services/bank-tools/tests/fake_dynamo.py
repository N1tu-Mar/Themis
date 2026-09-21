"""In-memory stand-in for boto3.client("dynamodb"): only the calls/expressions DynamoBankToolsStore uses."""
import operator
import re
from typing import Any

from bank_tools.dynamo_store import Tables, from_attr

TABLES = Tables(transactions="txns", cases="cases", merchants="merchants", audit="audit", idempotency="idem")
KEYS = {"txns": ("transactionId", None), "cases": ("caseId", None), "merchants": ("merchantId", None),
        "audit": ("caseId", "eventId"), "idem": ("idempotencyKey", None)}
OPS = {"=": operator.eq, "<": operator.lt, ">": operator.gt}


class FakeClientError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeDynamo:
    def __init__(self) -> None:
        self.rows: dict[str, dict[tuple, dict]] = {name: {} for name in KEYS}
        self.calls: list[str] = []

    def _key(self, table: str, item: dict) -> tuple:
        return tuple(from_attr(item[k]) for k in KEYS[table] if k)

    def _check(self, item: dict | None, cond: str | None, names: dict, values: dict) -> None:
        if not cond:
            return
        cond = cond.replace("#s", "status")
        cur = {k: from_attr(v) for k, v in (item or {}).items()}

        def atom(a: str) -> bool:
            a = a.strip()
            if a.startswith("("):
                a = a[1:]
            if a.endswith(")") and a.count(")") > a.count("("):
                a = a[:-1]
            m = re.fullmatch(r"attribute_(not_)?exists\((\w+)\)", a)
            if m:
                return (m[2] not in cur) == bool(m[1])
            left, op, right = a.split()
            return left in cur and OPS[op](cur[left], from_attr(values[right]))

        if not any(all(atom(a) for a in part.split(" AND ")) for part in cond.split(" OR ")):
            raise FakeClientError("ConditionalCheckFailedException")

    def get_item(self, TableName, Key, **_):
        self.calls.append("get_item")
        item = self.rows[TableName].get(self._key(TableName, Key))
        return {"Item": item} if item else {}

    def put_item(self, TableName, Item, ConditionExpression=None, ExpressionAttributeValues=None, ExpressionAttributeNames=None):
        self.calls.append("put_item")
        key = self._key(TableName, Item)
        self._check(self.rows[TableName].get(key), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues)
        self.rows[TableName][key] = Item

    def delete_item(self, TableName, Key, ConditionExpression=None, ExpressionAttributeValues=None, ExpressionAttributeNames=None):
        self.calls.append("delete_item")
        key = self._key(TableName, Key)
        self._check(self.rows[TableName].get(key), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues)
        self.rows[TableName].pop(key, None)

    def update_item(self, TableName, Key, UpdateExpression, ExpressionAttributeValues, ExpressionAttributeNames, ConditionExpression=None):
        self.calls.append("update_item")
        self._check(self.rows[TableName].get(self._key(TableName, Key)), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues)
        item = self.rows[TableName].setdefault(self._key(TableName, Key), dict(Key))
        for assign in UpdateExpression.removeprefix("SET ").split(", "):
            left, right = (x.strip() for x in assign.split(" = "))
            item[ExpressionAttributeNames.get(left, left)] = ExpressionAttributeValues[right]

    def query(self, TableName, KeyConditionExpression, ExpressionAttributeValues, IndexName=None, **_):
        self.calls.append("query")
        m = re.fullmatch(r"(\w+) = (:\w+)(?: AND begins_with\((\w+), (:\w+)\))?", KeyConditionExpression)
        attr, val = m[1], from_attr(ExpressionAttributeValues[m[2]])
        prefix = from_attr(ExpressionAttributeValues[m[4]]) if m[3] else None
        assert IndexName in (None, "byCustomer")
        return {"Items": [
            i for i in self.rows[TableName].values()
            if attr in i and from_attr(i[attr]) == val and (prefix is None or from_attr(i[m[3]]).startswith(prefix))
        ]}

    def count(self, table: str, prefix: str = "") -> int:
        """Rows in `table` whose sort key (audit) or partition key starts with prefix."""
        return sum(1 for k in self.rows[table] if str(k[-1]).startswith(prefix))
