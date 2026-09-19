"""Load services/bank-tools/src as a uniquely-named package.

The directory is named `src` (per prompt.md #40's repository layout), and the
root pytest run collects every service's tests in one process (`testpaths =
["services"]`), so a plain `sys.path` insertion of each service's `src/`
would make every service's package resolve to the same top-level name `src`
and stomp on each other in `sys.modules`. Registering this one under
`bank_tools` keeps it collision-free without renaming the directory.
"""
import importlib.util
import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "src"

if "bank_tools" not in sys.modules:
    spec = importlib.util.spec_from_file_location(
        "bank_tools", _SRC / "__init__.py", submodule_search_locations=[str(_SRC)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["bank_tools"] = module
    spec.loader.exec_module(module)

import pytest  # noqa: E402  (must follow the sys.modules registration above)

from bank_tools.models import Case, CaseStatus, ClaimType, Merchant, MerchantProfile, MerchantRiskSignal, Transaction
from bank_tools.store import BankToolsStore


def seeded_store() -> BankToolsStore:
    """A tiny, fully synthetic dataset: one customer, one merchant (+ alias), a few transactions."""
    store = BankToolsStore()
    store.add_customer({
        "customerId": "customer_001", "name": "Morgan Example",
        "phone": "+15555550123", "email": "morgan@example.test",
    })
    store.add_merchant(Merchant(
        merchantId="merchant_asteria", canonicalName="Asteria Digital",
        aliases=["ASTERIA.IO", "ASTERIA*PREMIUM", "ASTDIGITAL", "ASTERIA SUB"],
    ))
    store.add_merchant_profile(MerchantProfile(
        merchantId="merchant_asteria", canonicalName="Asteria Digital",
        aliases=["ASTERIA.IO"], billingPatterns=[{"amount": 9.99, "cadenceDays": 30}],
        caseStatistics={"totalCases": 1, "resolvedCustomerDisputes": 0, "openCases": 1},
        riskSignals=[MerchantRiskSignal(
            type="UNRECOGNIZED_RECURRING_SPIKE", severity="ELEVATED",
            observedAt="2026-08-01T00:00:00+00:00", expiresAt="2026-12-01T00:00:00+00:00",
            evidenceRefs=[],
        )],
        updatedAt="2026-08-01T00:00:00+00:00",
    ))
    for i, (amount, month) in enumerate([(9.99, "07"), (9.99, "08"), (9.99, "09")], start=1):
        store.add_transaction(Transaction(
            transactionId=f"txn_{i:03d}", customerId="customer_001", merchantId="merchant_asteria",
            descriptor="ASTERIA.IO", amount=amount, currency="USD",
            occurredAt=f"2026-{month}-01T20:00:00+00:00",
            authSignals={"recurring_indicator": True, "prior_merchant_relationship": False},
        ))
    store.add_case(Case(
        caseId="case_seed", customerId="customer_001", status=CaseStatus.NEW,
        createdAt="2026-06-01T00:00:00+00:00", updatedAt="2026-06-01T00:00:00+00:00",
        claimType=ClaimType.UNRECOGNIZED_MERCHANT, merchantId="merchant_asteria",
        transactionIds=[], evidenceIds=[], totalDisputedAmount=0.0, currency="USD",
        confidence=None, recommendedActions=[], requiresHumanReview=False,
    ))
    return store


@pytest.fixture
def store() -> BankToolsStore:
    return seeded_store()
