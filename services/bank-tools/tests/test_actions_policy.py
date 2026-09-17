from bank_tools import tools
from bank_tools.models import Case, CaseStatus, ClaimType


def _add_case(store, case_id, **overrides):
    fields = dict(
        caseId=case_id, customerId="customer_001", status=CaseStatus.INVESTIGATING,
        createdAt="2026-06-01T00:00:00+00:00", updatedAt="2026-06-01T00:00:00+00:00",
        claimType=ClaimType.UNAUTHORIZED_TRANSACTION, merchantId="merchant_asteria",
        transactionIds=[], evidenceIds=[], totalDisputedAmount=0.0, currency="USD",
        confidence=None, recommendedActions=[], requiresHumanReview=False,
    )
    fields.update(overrides)
    store.add_case(Case(**fields))
    return store.get_case(case_id)


def test_propose_dispute_creation_allows_with_confirmed_transactions(store):
    _add_case(store, "case_disp", transactionIds=["txn_001"])
    result = tools.propose_dispute_creation(store, case_id="case_disp", idempotency_key="k1")
    assert result["decision"]["outcome"] == "ALLOW"
    assert result["simulated"] is True


def test_propose_dispute_creation_needs_human_review_without_transactions(store):
    _add_case(store, "case_no_txn", transactionIds=[])
    result = tools.propose_dispute_creation(store, case_id="case_no_txn", idempotency_key="k1")
    assert result["decision"]["outcome"] == "REQUIRE_HUMAN_REVIEW"
    assert result["simulated"] is False
    assert len(store.human_review_requests_for_case("case_no_txn")) == 1


def test_propose_provisional_credit_allows_within_thresholds(store):
    _add_case(store, "case_credit", claimType=ClaimType.DUPLICATE_TRANSACTION, confidence=0.9)
    result = tools.propose_provisional_credit(store, case_id="case_credit", amount=10.0, idempotency_key="k1")
    assert result["decision"]["outcome"] == "ALLOW"


def test_propose_provisional_credit_requires_review_over_limit(store):
    _add_case(store, "case_big", claimType=ClaimType.DUPLICATE_TRANSACTION, confidence=0.9)
    result = tools.propose_provisional_credit(store, case_id="case_big", amount=999.0, idempotency_key="k1")
    assert result["decision"]["outcome"] == "REQUIRE_HUMAN_REVIEW"


def test_propose_payment_block_denies_without_customer_request(store):
    _add_case(store, "case_block")
    result = tools.propose_payment_block(store, case_id="case_block", customer_requested=False, idempotency_key="k1")
    assert result["decision"]["outcome"] == "DENY"


def test_propose_payment_block_allows_with_customer_request(store):
    _add_case(store, "case_block_ok")
    result = tools.propose_payment_block(store, case_id="case_block_ok", customer_requested=True, idempotency_key="k1")
    assert result["decision"]["outcome"] == "ALLOW"


def test_propose_card_replacement_always_needs_human_review(store):
    _add_case(store, "case_card")
    result = tools.propose_card_replacement(store, case_id="case_card", idempotency_key="k1")
    assert result["decision"]["outcome"] == "REQUIRE_HUMAN_REVIEW"


def test_closed_case_denies_any_proposed_action(store):
    _add_case(store, "case_closed", status=CaseStatus.CLOSED, transactionIds=["txn_001"])
    result = tools.propose_dispute_creation(store, case_id="case_closed", idempotency_key="k1")
    assert result["decision"]["outcome"] == "DENY"


def test_propose_action_is_idempotent_and_does_not_double_decide(store):
    _add_case(store, "case_repeat", transactionIds=["txn_001"])
    first = tools.propose_dispute_creation(store, case_id="case_repeat", idempotency_key="same-key")
    second = tools.propose_dispute_creation(store, case_id="case_repeat", idempotency_key="same-key")
    assert first == second
    assert len(store.policy_decisions_for_case("case_repeat")) == 1
