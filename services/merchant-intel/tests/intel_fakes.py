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
