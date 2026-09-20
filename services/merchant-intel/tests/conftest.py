import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

HERE = Path(__file__).parent
for p in (HERE, HERE.parent / "src"):  # works under root pytest too, without root config changes
    sys.path.insert(0, str(p))

from intel_fakes import FakeClock, FakeResearcher, load  # noqa: E402
from merchant_intel import InMemoryProfileStore, MerchantIntel  # noqa: E402


@pytest.fixture
def clock():
    return FakeClock(datetime(2026, 9, 20, 12, tzinfo=UTC))  # 3 days after fixture updatedAt


@pytest.fixture
def researcher():
    return FakeResearcher()


@pytest.fixture
def intel(clock, researcher):
    i = MerchantIntel(InMemoryProfileStore(), clock=clock, researcher=researcher)
    i.load_profiles(load("demo-profiles.json"))
    return i
