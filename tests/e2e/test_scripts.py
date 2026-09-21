"""Seed/reset scripts: deterministic, idempotent, and guarded (no AWS, no network, boto3 never imported)."""
import json
import sys

import pytest
import reset  # scripts/demo (conftest puts it on sys.path)
import seed
from seed import digest, make_client


def test_seed_is_deterministic_and_idempotent():
    c1, t = make_client("local")
    a = seed.seed(c1, t)
    d1 = digest(c1)
    seed.seed(c1, t)  # re-run over existing rows
    c2, _ = make_client("local")
    seed.seed(c2, t)
    assert digest(c1) == digest(c2) == d1
    assert a == {"customers": 50, "transactions": 1200, "merchantProfiles": 40, "cases": 17}


def test_reset_returns_a_dirty_store_to_the_seed_digest(capsys):
    client, tables = make_client("local")
    seed.seed(client, tables)
    clean = digest(client)
    from bank_tools.dynamo_store import DynamoBankToolsStore
    store = DynamoBankToolsStore(client, tables)  # dirty the store
    store.record_audit(case_id="case_demo_a", action="X", tool="x")
    assert digest(client) != clean
    assert reset.purge(client, tables) > 1000
    assert all(not rows for rows in client.rows.values())
    seed.seed(client, tables)
    assert digest(client) == clean


def test_cli_local_runs_print_the_same_digest(capsys):
    outs = []
    for _ in range(2):
        seed.main(["--mode", "local"])
        outs.append(json.loads(capsys.readouterr().out)["digest"])
    reset.main(["--mode", "local"])
    outs.append(json.loads(capsys.readouterr().out)["digest"])
    assert len(set(outs)) == 1


@pytest.mark.parametrize("argv, message", [
    (["--mode", "aws"], "--confirm-aws"),
    (["--mode", "aws", "--confirm-aws", "--endpoint", "http://localhost:8000"], "--endpoint"),
    (["--mode", "local", "--endpoint", "https://dynamodb.us-east-1.amazonaws.com"], "localhost"),
])
def test_seed_guards_refuse_before_touching_aws(argv, message, monkeypatch):
    monkeypatch.setitem(sys.modules, "boto3", None)  # any import attempt raises
    with pytest.raises(SystemExit, match=message):
        seed.main(argv)


def test_aws_reset_needs_the_extra_flag(monkeypatch):
    monkeypatch.setitem(sys.modules, "boto3", None)
    with pytest.raises(SystemExit, match="deletes every row"):
        reset.main(["--mode", "aws", "--confirm-aws"])


def test_demo_runner_is_deterministic_and_passes():
    import run_demo
    a, b = (run_demo.run(out=lambda _: None) for _ in range(2))
    assert a["ok"] and a["digest"] == b["digest"] and a["lines"][-1] == "RESULT: PASS"
    assert "research calls in E: 1" in a["lines"][-2]


def test_demo_runner_paces_to_the_requested_duration():
    import run_demo
    slept = []
    lines = run_demo.run(duration=180, out=lambda _: None, sleep=slept.append)["lines"]
    assert abs(sum(slept) - 180) < 1e-6 and len(slept) == len(lines)


def test_aws_smoke_is_a_dry_plan_by_default_and_guarded(monkeypatch, capsys):
    import aws_smoke
    monkeypatch.setitem(sys.modules, "boto3", None)
    monkeypatch.setenv("INBOUND_TOPIC_ARN", "arn:aws:sns:us-east-1:123456789012:t")
    monkeypatch.setenv("IDEMPOTENCY_TABLE", "idem")
    monkeypatch.delenv("THEMIS_AWS_SMOKE", raising=False)
    assert aws_smoke.main([]) == 0 and "nothing called" in capsys.readouterr().out
    with pytest.raises(SystemExit, match="THEMIS_AWS_SMOKE"):
        aws_smoke.main(["--run", "--expect-account", "123456789012"])
    monkeypatch.setenv("THEMIS_AWS_SMOKE", "1")
    with pytest.raises(SystemExit, match="12-digit"):
        aws_smoke.main(["--run"])
    with pytest.raises(SystemExit, match="12-digit"):
        aws_smoke.main(["--run", "--expect-account", "abc"])


def test_normal_tests_cannot_reach_aws_or_network():
    import socket
    with pytest.raises(ImportError):
        import boto3  # noqa: F401
    with pytest.raises(RuntimeError, match="network access"):
        socket.socket().connect(("127.0.0.1", 9))
