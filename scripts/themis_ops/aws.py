"""Small, injectable AWS CLI boundary used by the operational commands."""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from typing import Any, Callable, Sequence


ACCOUNT_RE = re.compile(r"^[0-9]{12}$")
REGION_RE = re.compile(r"^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]+$")
STACKS = ("ThemisData", "ThemisAgent", "ThemisMessaging", "ThemisObservability", "ThemisWeb")


class OpsError(RuntimeError):
    """An actionable, safely printable operations error."""


@dataclass(frozen=True)
class Target:
    account: str
    region: str
    stage: str

    def validate(self) -> None:
        if not ACCOUNT_RE.fullmatch(self.account):
            raise OpsError("--account must be an explicit 12-digit AWS account ID")
        if not REGION_RE.fullmatch(self.region):
            raise OpsError("--region must be an explicit AWS region such as us-east-1")
        if self.stage != "demo":
            raise OpsError("this tooling only permits --stage demo (the stacks destroy synthetic data)")

    @property
    def confirmation(self) -> str:
        return f"{self.account}:{self.region}:{self.stage}"


class AwsCli:
    """JSON-only AWS CLI wrapper. Tests inject a fake runner; no SDK is required."""

    def __init__(self, target: Target, runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run):
        target.validate()
        self.target = target
        self._runner = runner

    def json(self, *args: str, input_json: Any | None = None) -> Any:
        command = ["aws", *args, "--region", self.target.region, "--output", "json", "--no-cli-pager"]
        stdin = None if input_json is None else json.dumps(input_json, separators=(",", ":"))
        try:
            completed = self._runner(command, input=stdin, capture_output=True, text=True, check=False)
        except FileNotFoundError as exc:
            raise OpsError("AWS CLI v2 is required and was not found on PATH") from exc
        if completed.returncode:
            detail = completed.stderr.strip() or completed.stdout.strip() or "unknown AWS CLI error"
            raise OpsError(f"AWS CLI command failed ({' '.join(args[:2])}): {detail}")
        try:
            return json.loads(completed.stdout or "{}")
        except json.JSONDecodeError as exc:
            raise OpsError(f"AWS CLI returned invalid JSON for {' '.join(args[:2])}") from exc

    def verify_identity(self) -> dict[str, Any]:
        identity = self.json("sts", "get-caller-identity")
        actual = str(identity.get("Account", ""))
        if actual != self.target.account:
            raise OpsError(f"refusing target: caller account {actual or '<missing>'} != {self.target.account}")
        return identity

    def stack(self, name: str) -> dict[str, Any]:
        response = self.json("cloudformation", "describe-stacks", "--stack-name", name)
        stacks = response.get("Stacks", [])
        if len(stacks) != 1:
            raise OpsError(f"expected exactly one deployed {name} stack, found {len(stacks)}")
        stack = stacks[0]
        status = str(stack.get("StackStatus", ""))
        if not status.endswith("_COMPLETE") or "ROLLBACK" in status or "DELETE" in status:
            raise OpsError(f"{name} is not healthy: {status or '<missing status>'}")
        return stack

    def outputs(self, name: str) -> dict[str, str]:
        outputs: dict[str, str] = {}
        for row in self.stack(name).get("Outputs", []):
            key, value = row.get("OutputKey"), row.get("OutputValue")
            if key and value:
                outputs[str(key)] = str(value)
        return outputs


def require_outputs(actual: dict[str, str], required: Sequence[str], stack: str) -> dict[str, str]:
    missing = sorted(set(required) - actual.keys())
    if missing:
        raise OpsError(f"{stack} is missing outputs: {', '.join(missing)}")
    return actual


def require_confirmation(target: Target, apply: bool, confirmation: str | None) -> None:
    if apply and confirmation != target.confirmation:
        raise OpsError(f"--apply requires --confirm {target.confirmation}")

