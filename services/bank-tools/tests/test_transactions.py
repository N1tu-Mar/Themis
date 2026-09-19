from bank_tools import tools


def test_search_transactions_matches_customer_and_merchant(store):
    result = tools.search_transactions(store, customer_id="customer_001")
    assert result["status"] == "ok"
    assert result["count"] == 3
    assert result["total"] == 29.97
    assert all(t["merchantDescriptor"] == "ASTERIA.IO" for t in result["transactions"])


def test_search_transactions_respects_limit_but_counts_all_matches(store):
    result = tools.search_transactions(store, customer_id="customer_001", limit=1)
    assert len(result["transactions"]) == 1
    assert result["count"] == 3


def test_search_transactions_date_range_filter(store):
    result = tools.search_transactions(
        store, customer_id="customer_001", since="2026-08-01T00:00:00+00:00",
    )
    assert result["count"] == 2


def test_search_transactions_unknown_customer_is_not_found(store):
    result = tools.search_transactions(store, customer_id="nope")
    assert result["status"] == "error"
    assert result["error"]["code"] == "NOT_FOUND"


def test_get_transaction_details_excludes_auth_signals(store):
    result = tools.get_transaction_details(store, transaction_id="txn_001")
    assert result["status"] == "ok"
    assert "authSignals" not in result["transaction"]
    assert result["transaction"]["amount"] == 9.99


def test_get_transaction_auth_signals(store):
    result = tools.get_transaction_auth_signals(store, transaction_id="txn_001")
    assert result["authSignals"]["recurring_indicator"] is True


def test_find_related_transactions_groups_by_customer_and_merchant(store):
    result = tools.find_related_transactions(store, transaction_id="txn_001")
    assert result["count"] == 3
    assert result["seedTransactionId"] == "txn_001"
