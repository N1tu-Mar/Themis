"""Read-only post-deploy checks. This module never publishes or invokes workloads."""
from __future__ import annotations

import json
from typing import Any

from .aws import AwsCli, OpsError
from .cli import deployed_preflight
from .seed import discover_seed_tables


FIXTURE_KEYS = {
    "transactions": {"transactionId": {"S": "txn_demo_0001"}},
    "cases": {"caseId": {"S": "case_demo_history_001"}},
    "merchants": {"merchantId": {"S": "C#customer_demo_001"}},
}


def _arn_in_target(arn: str, service: str, aws: AwsCli) -> bool:
    return arn.startswith(f"arn:aws:{service}:{aws.target.region}:{aws.target.account}:")


def read_only_smoke(aws: AwsCli) -> dict[str, Any]:
    """Inspect deployed resources and one row per seeded table; perform no writes or invokes."""
    preflight = deployed_preflight(aws)
    tables = discover_seed_tables(aws)
    for logical, key in FIXTURE_KEYS.items():
        response = aws.json(
            "dynamodb", "get-item", "--table-name", tables[logical],
            "--key", json.dumps(key, separators=(",", ":")), "--consistent-read",
        )
        if not response.get("Item"):
            raise OpsError(f"seed verification failed: {logical} fixture row is absent")

    data = aws.outputs("ThemisData")
    bucket = data["ArtifactsBucketName"]
    location = aws.json("s3api", "get-bucket-location", "--bucket", bucket).get("LocationConstraint")
    actual_region = "us-east-1" if location in (None, "") else location
    if actual_region != aws.target.region:
        raise OpsError(f"artifact bucket region {actual_region} != target {aws.target.region}")
    aws.json("s3api", "list-objects-v2", "--bucket", bucket, "--prefix", "reports/", "--max-items", "1")

    agent = aws.outputs("ThemisAgent")
    function_names = [agent["ToolsAdapterFunctionName"]]
    messaging = aws.outputs("ThemisMessaging")
    function_names.append(messaging["NormalizerFunctionName"])
    for name in function_names:
        config = aws.json("lambda", "get-function-configuration", "--function-name", name)
        if config.get("State") != "Active" or config.get("LastUpdateStatus") not in (None, "Successful"):
            raise OpsError(f"Lambda {name} is not ready: {config.get('State')}/{config.get('LastUpdateStatus')}")

    topics = ("InboundTopicArn", "RcsInboundTopicArn", "DeliveryEventTopicArn")
    for output in topics:
        arn = messaging[output]
        if not _arn_in_target(arn, "sns", aws):
            raise OpsError(f"{output} is outside the target account/region: {arn}")
        attributes = aws.json("sns", "get-topic-attributes", "--topic-arn", arn).get("Attributes", {})
        if attributes.get("TopicArn") != arn:
            raise OpsError(f"SNS did not return expected {output}")

    resources = aws.json("cloudformation", "list-stack-resources", "--stack-name", "ThemisAgent")
    agentcore = [row for row in resources.get("StackResourceSummaries", [])
                 if str(row.get("ResourceType", "")).startswith("AWS::BedrockAgentCore::")]
    if len(agentcore) < 5:
        raise OpsError(f"expected at least 5 AgentCore resources, found {len(agentcore)}")
    bad = [row for row in agentcore if not str(row.get("ResourceStatus", "")).endswith("_COMPLETE")]
    if bad:
        raise OpsError("one or more AgentCore CloudFormation resources are not complete")

    return {
        "ok": True, "mode": "read-only", "target": aws.target.confirmation,
        "checks": {
            "stacks": len(preflight["stacks"]), "seedRows": len(FIXTURE_KEYS), "lambdas": len(function_names),
            "topics": len(topics), "agentCoreResources": len(agentcore), "artifactBucket": bucket,
        },
        "note": "No Lambda/AgentCore invocation, SNS publish, email, SMS, or RCS send was performed.",
    }


def cleanup_plan(aws: AwsCli) -> dict[str, Any]:
    """Return guidance only. Deliberately has no delete/destroy execution path."""
    deployed_preflight(aws)
    return {
        "target": aws.target.confirmation,
        "warning": "ThemisData uses RemovalPolicy.DESTROY and the artifact bucket auto-deletes objects.",
        "beforeDestroy": [
            "Review CloudFormation events and confirm every resource belongs to this synthetic demo.",
            "Export any wanted reports from the ArtifactsBucketName output.",
            "Record CloudWatch dashboard/alarms and delivery telemetry needed for the submission.",
            "Detach manually registered SMS/RCS identities and disconnect the Amplify repository manually.",
        ],
        "manualCommand": "npm exec --workspace=infra -- cdk destroy --all",
        "afterDestroy": [
            "Confirm all five Themis stacks are deleted in the exact account and region above.",
            "Release manually provisioned SMS/RCS identities only after checking carrier obligations.",
            "Remove SES identities only if they are dedicated to this demo.",
        ],
        "executed": False,
    }

