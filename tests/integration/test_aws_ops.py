from __future__ import annotations

import json
import subprocess

import pytest

from scripts.themis_ops.aws import AwsCli, OpsError, Target, require_confirmation
from scripts.themis_ops.cli import REQUIRED_OUTPUTS, deployed_preflight


class FakeRunner:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, command, **kwargs):
        self.calls.append((command, kwargs))
        response = self.responses.pop(0)
        return subprocess.CompletedProcess(command, response.get("code", 0), json.dumps(response.get("json", {})), response.get("stderr", ""))


def stack_response(name):
    outputs = [{"OutputKey": key, "OutputValue": f"value-{key}"} for key in REQUIRED_OUTPUTS.get(name, ())]
    return {"Stacks": [{"StackName": name, "StackStatus": "CREATE_COMPLETE", "Outputs": outputs}]}


def test_target_requires_explicit_synthetic_demo_scope():
    Target("123456789012", "us-east-1", "demo").validate()
    with pytest.raises(OpsError, match="12-digit"):
        Target("1234", "us-east-1", "demo").validate()
    with pytest.raises(OpsError, match="only permits"):
        Target("123456789012", "us-east-1", "prod").validate()


def test_apply_confirmation_must_exactly_match_target():
    target = Target("123456789012", "us-east-1", "demo")
    require_confirmation(target, False, None)
    with pytest.raises(OpsError, match="123456789012:us-east-1:demo"):
        require_confirmation(target, True, "yes")
    require_confirmation(target, True, target.confirmation)


def test_preflight_checks_caller_and_every_stack_without_mutation():
    responses = [{"json": {"Account": "123456789012", "Arn": "arn:aws:iam::123456789012:user/test"}}]
    responses.extend({"json": stack_response(name)} for name in ("ThemisData", "ThemisAgent", "ThemisMessaging", "ThemisObservability", "ThemisWeb"))
    runner = FakeRunner(responses)
    aws = AwsCli(Target("123456789012", "us-east-1", "demo"), runner=runner)
    result = deployed_preflight(aws)
    assert result["ok"] is True
    assert len(runner.calls) == 6
    assert all("--region" in command and "--no-cli-pager" in command for command, _ in runner.calls)


def test_preflight_refuses_wrong_live_account_before_stack_reads():
    runner = FakeRunner([{"json": {"Account": "999999999999"}}])
    aws = AwsCli(Target("123456789012", "us-east-1", "demo"), runner=runner)
    with pytest.raises(OpsError, match="refusing target"):
        deployed_preflight(aws)
    assert len(runner.calls) == 1
