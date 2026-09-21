"""Safe operational entry point for Themis's synthetic AWS demo."""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Sequence

from .aws import AwsCli, OpsError, STACKS, Target, require_outputs


REQUIRED_OUTPUTS = {
    "ThemisData": (
        "TransactionsTableName", "CasesTableName", "MerchantsTableName", "AuditTableName",
        "IdempotencyTableName", "ArtifactsBucketName",
    ),
    "ThemisAgent": ("GatewayIdentifier", "GatewayUrl", "MemoryId", "AgentRuntimeArn", "PolicyEngineId"),
    "ThemisMessaging": (
        "InboundTopicArn", "RcsInboundTopicArn", "DeliveryEventTopicArn", "NormalizerFunctionName",
    ),
    "ThemisWeb": ("AmplifyAppId", "AmplifyDefaultDomain"),
}


def target_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--account", required=True, help="exact 12-digit target account")
    parser.add_argument("--region", required=True, help="exact target region")
    parser.add_argument("--stage", required=True, help="must be demo")


def deployed_preflight(aws: AwsCli) -> dict[str, object]:
    identity = aws.verify_identity()
    outputs: dict[str, dict[str, str]] = {}
    for stack_name in STACKS:
        stack_outputs = aws.outputs(stack_name)
        if stack_name in REQUIRED_OUTPUTS:
            require_outputs(stack_outputs, REQUIRED_OUTPUTS[stack_name], stack_name)
        outputs[stack_name] = stack_outputs
    return {
        "ok": True,
        "account": aws.target.account,
        "region": aws.target.region,
        "stage": aws.target.stage,
        "callerArn": identity.get("Arn"),
        "stacks": {name: sorted(values) for name, values in outputs.items()},
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    preflight = commands.add_parser("preflight", help="validate identity, stacks, and outputs (read-only)")
    target_arguments(preflight)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        target = Target(args.account, args.region, args.stage)
        aws = AwsCli(target)
        if args.command == "preflight":
            print(json.dumps(deployed_preflight(aws), indent=2, sort_keys=True))
        return 0
    except OpsError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

