import json
from pathlib import Path

from bank_tools import tools
from bank_tools.fixtures import load_demo_store
from bank_tools.models import ActionType, CaseOutcome, CaseStatus, ClaimType, EvidenceCategory


ROOT = Path(__file__).resolve().parents[3]


def test_python_enums_match_exported_contract_schemas():
    schemas = json.loads((ROOT / "packages/contracts/schemas.json").read_text(encoding="utf-8"))
    expected = {
        "CaseStatus": CaseStatus,
        "CaseOutcome": CaseOutcome,
        "ClaimType": ClaimType,
        "Action": ActionType,
        "EvidenceCategory": EvidenceCategory,
    }
    for schema_name, enum_type in expected.items():
        assert schemas[schema_name]["enum"] == [member.value for member in enum_type]


def test_canonical_demo_fixtures_load_and_drive_tools():
    store = load_demo_store(ROOT)
    assert len(store.transactions_for_customer("customer_demo_001")) == 30
    assert len(store.cases_for_customer("customer_demo_001")) == 1
    assert tools.resolve_merchant(store, descriptor="asteria*premium")["merchantId"] == "merchant_demo_001"
    case = tools.get_case(store, case_id="case_demo_a")["case"]
    assert case["transactionIds"] == [f"txn_demo_{index:04d}" for index in range(1, 7)]
    assert len(store.evidence_for_case("case_demo_a")) == len(case["evidenceIds"])
