from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("themis_acceptance", ROOT / "scripts/acceptance.py")
assert SPEC and SPEC.loader
acceptance = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = acceptance
SPEC.loader.exec_module(acceptance)


def test_frozen_contract_parser_matches_repository():
    source = (ROOT / "infra/config/tool-schemas.ts").read_text(encoding="utf-8")
    version, tools, idempotent = acceptance._tool_contract(source)
    assert version == acceptance.EXPECTED_CONTRACT_VERSION
    assert tuple(tools) == acceptance.EXPECTED_TOOLS
    assert tuple(idempotent) == acceptance.EXPECTED_IDEMPOTENT_TOOLS


def test_static_json_report_is_machine_readable_and_manual_gates_are_not_green(tmp_path):
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts/acceptance.py"), "--mode", "static", "--format", "json"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    report = json.loads(proc.stdout)
    assert report["schemaVersion"] == 1
    assert report["summary"]["MANUAL"] >= 4
    assert all(check["status"] == "MANUAL" for check in report["checks"] if check["id"].startswith("live."))
    assert report["overall"] != "PASS"
    # This branch can legitimately be dirty while the test is developed; exit status must
    # still correspond exactly to whether any check reports FAIL.
    assert (proc.returncode != 0) == bool(report["summary"]["FAIL"])


def test_env_parser_counts_commented_deployment_variables():
    source = "THEMIS_MODE=local\n# AGENT_RUNTIME_ARN=\n# prose only\n"
    assert acceptance._documented_env(source) == {"THEMIS_MODE", "AGENT_RUNTIME_ARN"}


def test_root_check_includes_typescript_e2e_suite():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert package["scripts"]["test:python"] == "python3.12 -m pytest -q"
    assert "npm run test:e2e:node" in package["scripts"]["check"]
    assert package["scripts"]["test:e2e:node"] == "node --test tests/e2e/inbound.test.ts"


def test_placeholder_only_directory_fails(tmp_path):
    for relative in acceptance.CRITICAL_DIRECTORIES:
        directory = tmp_path / relative
        directory.mkdir(parents=True)
        (directory / ".gitkeep").touch()
    result = acceptance.check_critical_directories(tmp_path)
    assert result.status == "FAIL"
    assert set(result.details["placeholderOnly"]) == set(acceptance.CRITICAL_DIRECTORIES)


def test_real_file_satisfies_each_critical_directory(tmp_path):
    for relative in acceptance.CRITICAL_DIRECTORIES:
        directory = tmp_path / relative
        directory.mkdir(parents=True)
        (directory / "deliverable.md").write_text("done\n", encoding="utf-8")
    result = acceptance.check_critical_directories(tmp_path)
    assert result.status == "PASS"


def test_python_package_matrix_covers_every_service():
    assert acceptance.PYTHON_PACKAGES == (
        ("bank-tools", "bank_tools"),
        ("merchant-intel", "merchant_intel"),
        ("agent", "orchestrator"),
    )
