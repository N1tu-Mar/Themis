"""Lease ownership: a stale worker must never complete/release a successor's lease (both stores)."""
import threading
import time

import pytest

from bank_tools import dispatch as dispatch_mod
from bank_tools.dispatch import _fingerprint, dispatch
from bank_tools.dynamo_store import DynamoBankToolsStore
from bank_tools.errors import LeaseLostError
from bank_tools.store import CLAIMED, CURRENT_LEASE, IN_PROGRESS, MISMATCH, REPLAY, BankToolsStore
from conftest import seed
from fake_dynamo import TABLES, FakeDynamo, FakeClientError

CREATE = {"customerId": "customer_001", "claimType": "UNRECOGNIZED_MERCHANT", "idempotencyKey": "k1"}


@pytest.fixture(params=["memory", "dynamo"])
def db(request):
    return seed(BankToolsStore() if request.param == "memory" else DynamoBankToolsStore(FakeDynamo(), TABLES))


def as_owner(claim):
    CURRENT_LEASE.set(claim.owner)


def test_acquire_and_complete_then_replay(db):
    claim = db.claim_idempotency("t", "k", "fp")
    assert claim.state == CLAIMED and claim.owner
    as_owner(claim)
    db.remember_result("t", "k", {"status": "ok"})
    again = db.claim_idempotency("t", "k", "fp")
    assert (again.state, again.result, again.owner) == (REPLAY, {"status": "ok"}, None)
    assert db.claim_idempotency("t", "k", "other").state == MISMATCH


def test_owner_tokens_are_unique_per_claim(db):
    a = db.claim_idempotency("t", "k", "fp", lease_seconds=-1)
    b = db.claim_idempotency("t", "k", "fp")
    assert a.state == b.state == CLAIMED and a.owner != b.owner


def test_expired_lease_successor_blocks_third_caller(db):
    db.claim_idempotency("t", "k", "fp", lease_seconds=-1)
    assert db.claim_idempotency("t", "k", "fp").state == CLAIMED
    assert db.claim_idempotency("t", "k", "fp").state == IN_PROGRESS


def test_stale_completion_after_successor_is_rejected(db):
    stale = db.claim_idempotency("t", "k", "fp", lease_seconds=-1)
    fresh = db.claim_idempotency("t", "k", "fp")
    as_owner(stale)
    with pytest.raises(LeaseLostError):
        db.remember_result("t", "k", {"status": "ok", "who": "stale"})
    assert db.idempotent_result("t", "k") is None
    as_owner(fresh)
    db.remember_result("t", "k", {"status": "ok", "who": "fresh"})
    assert db.idempotent_result("t", "k") == {"status": "ok", "who": "fresh"}


def test_stale_release_after_successor_keeps_successor_lease(db):
    stale = db.claim_idempotency("t", "k", "fp", lease_seconds=-1)
    fresh = db.claim_idempotency("t", "k", "fp")
    as_owner(stale)
    db.release_idempotency("t", "k")  # no-op
    assert db.claim_idempotency("t", "k", "fp").state == IN_PROGRESS
    as_owner(fresh)
    db.release_idempotency("t", "k")
    assert db.claim_idempotency("t", "k", "fp").state == CLAIMED


def test_stale_worker_cannot_touch_completed_result(db):
    stale = db.claim_idempotency("t", "k", "fp", lease_seconds=-1)
    as_owner(db.claim_idempotency("t", "k", "fp"))
    db.remember_result("t", "k", {"status": "ok"})
    as_owner(stale)
    db.release_idempotency("t", "k")
    with pytest.raises(LeaseLostError):
        db.remember_result("t", "k", {"status": "ok", "who": "stale"})
    assert db.idempotent_result("t", "k") == {"status": "ok"}


def test_owner_may_complete_twice(db):  # tool function and dispatch both call remember_result
    as_owner(db.claim_idempotency("t", "k", "fp"))
    db.remember_result("t", "k", {"status": "ok"})
    db.remember_result("t", "k", {"status": "ok"})


def test_concurrent_claims_have_exactly_one_winner(db):
    barrier, out = threading.Barrier(8), []

    def go():
        barrier.wait()
        out.append(db.claim_idempotency("t", "k", "fp").state)

    threads = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(out) == [CLAIMED] + [IN_PROGRESS] * 7


def test_dispatch_stale_worker_cannot_overwrite_successor(db, monkeypatch):
    """A's lease expires mid-run and B claims; A's result writes (in the tool and in dispatch) are fenced."""
    real_run, fp, taken = dispatch_mod._run, _fingerprint("create_case", CREATE), {}

    def stalled_run(store, spec, kwargs):
        if isinstance(store, BankToolsStore):
            store._claims[("create_case", "k1")] = (0.0, fp, "a")
        else:
            store._c.rows["idem"][("create_case#k1",)]["leaseExpiresAt"] = {"N": "0"}
        taken["b"] = store.claim_idempotency("create_case", "k1", fp)
        return real_run(store, spec, kwargs)  # tool's own remember_result runs under A's stale token

    monkeypatch.setattr(dispatch_mod, "_run", stalled_run)
    first = dispatch(db, "create_case", CREATE)
    assert first["error"]["code"] == "IDEMPOTENCY_IN_PROGRESS"
    assert taken["b"].state == CLAIMED and db.idempotent_result("create_case", "k1") is None
    as_owner(taken["b"])
    db.remember_result("create_case", "k1", {"status": "ok", "who": "B"})
    assert db.idempotent_result("create_case", "k1")["who"] == "B"


def test_dispatch_replay_and_fingerprint_conflict(db):
    first = dispatch(db, "create_case", CREATE)
    assert dispatch(db, "create_case", CREATE) == first
    other = dispatch(db, "create_case", {**CREATE, "claimType": "DUPLICATE_CHARGE"})
    assert other["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_conditional_write_race_between_read_and_complete():
    """A successor wins the row between the owner's claim and its complete: conditional update fails, not clobbers."""
    fake = FakeDynamo()
    db = DynamoBankToolsStore(fake, TABLES)
    a = db.claim_idempotency("t", "k", "fp")
    fake.rows["idem"][("t#k",)]["leaseOwner"] = {"S": "someone-else"}  # successor's put landed first
    as_owner(a)
    with pytest.raises(LeaseLostError):
        db.remember_result("t", "k", {"status": "ok"})
    assert fake.rows["idem"][("t#k",)]["status"] == {"S": "IN_PROGRESS"}


def test_non_conditional_dynamo_errors_propagate():
    class Boom(FakeDynamo):
        def update_item(self, *a, **k):
            raise FakeClientError("ProvisionedThroughputExceededException")

    db = DynamoBankToolsStore(Boom(), TABLES)
    as_owner(db.claim_idempotency("t", "k", "fp"))
    with pytest.raises(FakeClientError):
        db.remember_result("t", "k", {"status": "ok"})


# --- legacy rows (written before owner tokens: no leaseOwner attribute) ---
def _legacy(fake, status, lease_in, result=None):
    row = {"idempotencyKey": {"S": "t#k"}, "fingerprint": {"S": "fp"}, "status": {"S": status},
           "leaseExpiresAt": {"N": str(int(time.time()) + lease_in)}, "expiresAt": {"N": str(int(time.time()) + 999)}}
    if result:
        row["result"] = {"S": result}
    fake.rows["idem"][("t#k",)] = row


def test_legacy_live_in_progress_blocks_then_expired_is_taken_over():
    fake = FakeDynamo()
    db = DynamoBankToolsStore(fake, TABLES)
    _legacy(fake, "IN_PROGRESS", 30)
    assert db.claim_idempotency("t", "k", "fp").state == IN_PROGRESS
    _legacy(fake, "IN_PROGRESS", -1)
    taken = db.claim_idempotency("t", "k", "fp")
    assert taken.state == CLAIMED and fake.rows["idem"][("t#k",)]["leaseOwner"] == {"S": taken.owner}


def test_legacy_complete_row_replays():
    fake = FakeDynamo()
    _legacy(fake, "COMPLETE", 0, '{"status": "ok"}')
    claim = DynamoBankToolsStore(fake, TABLES).claim_idempotency("t", "k", "fp")
    assert (claim.state, claim.result) == (REPLAY, {"status": "ok"})


def test_tokenless_caller_cannot_mutate_owned_lease_but_can_mutate_legacy():
    fake = FakeDynamo()
    db = DynamoBankToolsStore(fake, TABLES)
    db.claim_idempotency("t", "k", "fp")  # owned lease
    with pytest.raises(LeaseLostError):
        db.remember_result("t", "k", {"status": "ok"})
    db.release_idempotency("t", "k")  # no-op
    assert ("t#k",) in fake.rows["idem"]
    fake.rows["idem"].clear()
    _legacy(fake, "IN_PROGRESS", 30)
    db.remember_result("t", "k", {"status": "ok"})
    assert db.idempotent_result("t", "k") == {"status": "ok"}
