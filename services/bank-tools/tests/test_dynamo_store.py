import sys

import pytest

from bank_tools.dispatch import dispatch
from bank_tools.dynamo_store import DynamoBankToolsStore, Tables, from_attr, to_attr
from bank_tools.errors import ConflictError, NotFoundError
from bank_tools.store import CLAIMED, IN_PROGRESS, MISMATCH, REPLAY
from conftest import seed
from fake_dynamo import TABLES, FakeDynamo

CREATE = {"customerId": "customer_001", "claimType": "UNRECOGNIZED_MERCHANT", "idempotencyKey": "k1"}


@pytest.fixture
def fake():
    return FakeDynamo()


@pytest.fixture
def db(fake):
    return seed(DynamoBankToolsStore(fake, TABLES))


def test_no_boto3_needed():
    assert "boto3" not in sys.modules


def test_attribute_roundtrip():
    value = {"a": 1, "b": 9.99, "c": None, "d": [True, "x", 0.0], "e": {"n": -3}}
    assert from_attr(to_attr(value)) == value


def test_tables_from_env():
    env = {"TRANSACTIONS_TABLE": "t", "CASES_TABLE": "c", "MERCHANTS_TABLE": "m", "AUDIT_TABLE": "a", "IDEMPOTENCY_TABLE": "i"}
    assert Tables.from_env(env) == Tables("t", "c", "m", "a", "i")


def test_records_roundtrip_through_dynamo(db):
    assert db.get_transaction("txn_002").amount == 9.99
    assert [t.transactionId for t in db.transactions_for_customer("customer_001", since="2026-08-01T00:00:00+00:00")] == ["txn_002", "txn_003"]
    assert db.get_case("case_seed").confidence is None
    assert db.get_merchant_profile("merchant_asteria").riskSignals[0].type == "UNRECOGNIZED_RECURRING_SPIKE"
    assert db.resolve_merchant_id("asteria.io") == "merchant_asteria"
    with pytest.raises(NotFoundError):
        db.get_customer("nobody")


def test_create_case_conditional_conflict(db):
    case = db.get_case("case_seed")
    with pytest.raises(ConflictError):
        db.create_case(case)


def test_replace_missing_case_is_not_found(db):
    case = db.get_case("case_seed")
    case.caseId = "case_missing"
    with pytest.raises(NotFoundError):
        db.replace_case(case)


def test_claim_is_atomic_and_exclusive(db):
    assert db.claim_idempotency("t", "k", "fp").state == CLAIMED
    assert db.claim_idempotency("t", "k", "fp").state == IN_PROGRESS  # second caller loses the conditional put
    assert db.claim_idempotency("t", "k", "other").state == MISMATCH
    db.remember_result("t", "k", {"status": "ok", "n": 1})
    replay = db.claim_idempotency("t", "k", "fp")
    assert (replay.state, replay.result) == (REPLAY, {"status": "ok", "n": 1})


def test_expired_lease_can_be_taken_over_but_only_with_same_fingerprint(db):
    assert db.claim_idempotency("t", "k", "fp", lease_seconds=-1).state == CLAIMED
    assert db.claim_idempotency("t", "k", "other").state == MISMATCH
    assert db.claim_idempotency("t", "k", "fp").state == CLAIMED


def test_release_only_removes_in_progress_claims(db, fake):
    db.claim_idempotency("t", "k", "fp")
    db.release_idempotency("t", "k")
    assert fake.count("idem") == 0
    db.claim_idempotency("t", "k", "fp")
    db.remember_result("t", "k", {"status": "ok"})
    db.release_idempotency("t", "k")  # conditional failure swallowed; completed result kept
    assert db.idempotent_result("t", "k") == {"status": "ok"}


def test_live_claim_by_another_worker_blocks_dispatch_without_side_effects(db, fake):
    from bank_tools.dispatch import _fingerprint
    db.claim_idempotency("create_case", "k1", _fingerprint("create_case", CREATE))
    result = dispatch(db, "create_case", CREATE)
    assert result["error"]["code"] == "IDEMPOTENCY_IN_PROGRESS"
    assert len(db.cases_for_customer("customer_001")) == 1


def test_replay_writes_nothing(db, fake):
    dispatch(db, "create_case", CREATE)
    before = {t: dict(rows) for t, rows in fake.rows.items()}
    dispatch(db, "create_case", CREATE)
    assert fake.rows == before


def test_audit_policy_and_review_are_separate_ordered_lists(db):
    ok = dispatch(db, "propose_card_replacement", {"caseId": "case_seed", "idempotencyKey": "k"})
    assert ok["decision"]["outcome"] == "REQUIRE_HUMAN_REVIEW"
    assert len(db.audit_for_case("case_seed")) == 1
    assert len(db.policy_decisions_for_case("case_seed")) == 1
    assert len(db.human_review_requests_for_case("case_seed")) == 1
