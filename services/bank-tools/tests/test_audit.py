from bank_tools import tools
from bank_tools.models import Case, CaseStatus, ClaimType


def test_search_transactions_writes_audit_record_when_case_id_given(store):
    tools.search_transactions(store, customer_id="customer_001", case_id="case_seed")
    events = tools.get_audit_log(store, case_id="case_seed")["events"]
    assert events[-1]["action"] == "SEARCH_TRANSACTIONS"
    assert events[-1]["tool"] == "search_transactions"
    assert events[-1]["result"] == "SUCCESS"


def test_propose_action_audit_includes_policy_fields(store):
    store.add_case(Case(
        caseId="case_audit", customerId="customer_001", status=CaseStatus.INVESTIGATING,
        createdAt="2026-06-01T00:00:00+00:00", updatedAt="2026-06-01T00:00:00+00:00",
        claimType=ClaimType.UNAUTHORIZED_TRANSACTION, merchantId="merchant_asteria",
        transactionIds=["txn_001"], evidenceIds=[], totalDisputedAmount=9.99, currency="USD",
        confidence=None, recommendedActions=[], requiresHumanReview=False,
    ))
    tools.propose_dispute_creation(store, case_id="case_audit", idempotency_key="k1")
    events = tools.get_audit_log(store, case_id="case_audit")["events"]
    assert events[-1]["policyOutcome"] == "ALLOW"
    assert events[-1]["humanApprovalRequired"] is False


def test_get_audit_log_for_unknown_case_is_empty_not_error(store):
    result = tools.get_audit_log(store, case_id="never_existed")
    assert result["status"] == "ok"
    assert result["events"] == []
