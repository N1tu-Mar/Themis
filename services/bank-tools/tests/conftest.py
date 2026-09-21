"""Synthetic test store fixtures for the installable ``bank_tools`` package."""
import pytest

from bank_tools.models import Case, CaseStatus, ClaimType, Merchant, MerchantProfile, MerchantRiskSignal, Transaction
from bank_tools.store import BankToolsStore


def seed(store):
    """A tiny, fully synthetic dataset: one customer, one merchant (+ alias), a few transactions."""
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


def seeded_store() -> BankToolsStore:
    return seed(BankToolsStore())


@pytest.fixture
def store() -> BankToolsStore:
    return seeded_store()


@pytest.fixture(autouse=True)
def _reset_lease():
    """CURRENT_LEASE is a ContextVar; keep one test's lease from leaking into the next."""
    from bank_tools.store import CURRENT_LEASE
    token = CURRENT_LEASE.set(None)
    yield
    CURRENT_LEASE.reset(token)
