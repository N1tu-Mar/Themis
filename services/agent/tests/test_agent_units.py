from datetime import date

import pytest

from orchestrator.config import Config
from orchestrator.engine import clean_analysis
from orchestrator.prefilter import prefilter
from orchestrator.state import TRANSITIONS, CaseState

TODAY = date(2026, 9, 20)


def txn(tid, desc, amount, day, recurring=True):
    return {"id": tid, "merchantDescriptor": desc, "amount": amount, "date": day, "recurring": recurring}


def test_prefilter_keeps_recurring_cluster_and_drops_unrelated_amount():
    rows = [txn(f"t{i}", "ASTERIA.IO", 9.99, f"2026-09-{i + 1:02d}") for i in range(6)]
    rows += [txn("big", "ASTERIA.IO", 19.99, "2026-09-10", False), txn("other", "GROCER", 9.99, "2026-09-12")]
    out = prefilter(rows, {"descriptor": "Asteria", "amount": 10.0}, today=TODAY)
    assert [t["id"] for t in out] == ["t5", "t4", "t3", "t2", "t1", "t0"]


def test_prefilter_caps_window_and_needs_hints():
    rows = [txn(f"t{i}", "ASTERIA", 5.0, "2026-09-01") for i in range(30)] + [txn("old", "ASTERIA", 5.0, "2025-01-01")]
    assert len(prefilter(rows, {"descriptor": "asteria"}, today=TODAY)) == 20
    assert prefilter(rows, {}, today=TODAY) == []


def test_state_machine_rejects_skipped_states_and_round_trips():
    st = CaseState("c1", "cust")
    st.move("INTAKE")
    with pytest.raises(ValueError):
        st.move("RESOLVED")
    assert CaseState.from_dict(st.to_dict()) == st
    assert all(t in TRANSITIONS for ts in TRANSITIONS.values() for t in ts)


def test_clean_analysis_drops_untrusted_fields():
    a = clean_analysis({"hints": {"amount": "10", "descriptor": " Foo "}, "selection": [1], "canceled": "yes", "recognizes_merchant": False, "run": "sql"})
    assert a == {"hints": {"descriptor": "Foo"}, "claim": {"recognizes_merchant": False}, "selection": None}


def test_config_from_env_validates():
    assert Config.from_env({"THEMIS_MODE": "aws", "ENABLE_BROWSER_RESEARCH": "true"}).browser_research
    with pytest.raises(ValueError):
        Config.from_env({"THEMIS_MODE": "prod"})
    with pytest.raises(ValueError):
        Config.from_env({"THEMIS_ESCALATION_CONFIDENCE": "2"})
