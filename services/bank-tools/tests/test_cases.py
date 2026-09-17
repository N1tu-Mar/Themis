from bank_tools import tools


def test_create_case_is_idempotent(store):
    first = tools.create_case(
        store, customer_id="customer_001", claim_type="UNRECOGNIZED_MERCHANT", idempotency_key="key-1",
    )
    second = tools.create_case(
        store, customer_id="customer_001", claim_type="UNRECOGNIZED_MERCHANT", idempotency_key="key-1",
    )
    assert first == second
    assert len(store.cases_for_customer("customer_001")) == 2  # seed case + one created, not two


def test_create_case_requires_idempotency_key(store):
    result = tools.create_case(store, customer_id="customer_001", claim_type="UNRECOGNIZED_MERCHANT", idempotency_key="")
    assert result["status"] == "error"
    assert result["error"]["code"] == "VALIDATION_ERROR"


def test_create_case_sums_disputed_amount_from_transactions(store):
    result = tools.create_case(
        store, customer_id="customer_001", claim_type="DUPLICATE_TRANSACTION", idempotency_key="key-2",
        transaction_ids=["txn_001", "txn_002"],
    )
    assert result["case"]["totalDisputedAmount"] == 19.98


def test_update_case_valid_transition(store):
    result = tools.update_case(store, case_id="case_seed", patch={"status": "INTAKE"})
    assert result["status"] == "ok"
    assert result["case"]["status"] == "INTAKE"


def test_update_case_rejects_invalid_transition(store):
    result = tools.update_case(store, case_id="case_seed", patch={"status": "RESOLVED"})
    assert result["status"] == "error"
    assert result["error"]["code"] == "INVALID_TRANSITION"


def test_update_case_cannot_change_identity(store):
    result = tools.update_case(store, case_id="case_seed", patch={"customerId": "someone_else"})
    assert result["status"] == "error"
    assert result["error"]["code"] == "VALIDATION_ERROR"


def test_save_evidence_appends_and_is_idempotent_by_id(store):
    first = tools.save_evidence(
        store, case_id="case_seed", category="TRANSACTION_EVIDENCE", evidence_type="RECURRING_PATTERN",
        claim="Charge repeats monthly.", source="BANK_LEDGER", reliability="HIGH",
        transaction_ids=["txn_001"], evidence_id="ev_fixed",
    )
    again = tools.save_evidence(
        store, case_id="case_seed", category="TRANSACTION_EVIDENCE", evidence_type="RECURRING_PATTERN",
        claim="Charge repeats monthly.", source="BANK_LEDGER", reliability="HIGH",
        transaction_ids=["txn_001"], evidence_id="ev_fixed",
    )
    assert first["evidence"]["evidenceId"] == again["evidence"]["evidenceId"]
    assert tools.get_case(store, case_id="case_seed")["case"]["evidenceIds"] == ["ev_fixed"]
