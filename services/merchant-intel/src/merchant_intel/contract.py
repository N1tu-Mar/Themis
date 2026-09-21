"""Minimal validator for the JSON-Schema subset used by packages/contracts/schemas.json."""
import json
from functools import cache
from pathlib import Path
from typing import Any

SCHEMAS = Path(__file__).with_name("schemas.json")  # packaged copy; tests assert it equals packages/contracts/schemas.json


class ContractError(ValueError):
    pass


@cache
def _schemas() -> dict[str, Any]:
    return json.loads(SCHEMAS.read_text(encoding="utf-8"))


def _check(v: Any, s: dict[str, Any], path: str) -> None:
    t = s.get("type")
    ok = {"object": dict, "array": list, "string": str, "integer": int, "number": (int, float)}.get(t)
    if ok and (not isinstance(v, ok) or isinstance(v, bool)):
        raise ContractError(f"{path}: expected {t}")
    if "enum" in s and v not in s["enum"]:
        raise ContractError(f"{path}: {v!r} not in {s['enum']}")
    if t == "string" and len(v) < s.get("minLength", 0):
        raise ContractError(f"{path}: too short")
    if t in ("integer", "number"):
        if v < s.get("minimum", v) or v <= s.get("exclusiveMinimum", v - 1):
            raise ContractError(f"{path}: out of range")
    if t == "string" and s.get("format") == "date-time" and "pattern" in s:
        import re
        if not re.match(s["pattern"], v):
            raise ContractError(f"{path}: bad date-time {v!r}")
    if t == "array":
        for i, item in enumerate(v):
            _check(item, s.get("items", {}), f"{path}[{i}]")
    if t == "object":
        props = s.get("properties", {})
        for k in s.get("required", []):
            if k not in v:
                raise ContractError(f"{path}: missing {k}")
        for k, item in v.items():
            if k in props:
                _check(item, props[k], f"{path}.{k}")
            elif s.get("additionalProperties") is False:
                raise ContractError(f"{path}: unexpected {k}")


def validate(name: str, value: Any) -> Any:
    _check(value, _schemas()[name], name)
    return value
