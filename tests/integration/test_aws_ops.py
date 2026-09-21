from __future__ import annotations

import json
from pathlib import Path
import subprocess

import pytest

from scripts.themis_ops.aws import AwsCli, OpsError, Target, require_confirmation
from scripts.themis_ops.cli import REQUIRED_OUTPUTS, deployed_preflight
from scripts.themis_ops.seed import DATA_OUTPUTS, apply_seed, build_seed_plan, discover_seed_tables
from scripts.themis_ops.smoke import cleanup_plan, read_only_smoke


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


def test_seed_plan_is_deterministic_and_contains_only_expected_fixture_layout():
    root = Path(__file__).resolve().parents[2]
    first, second = build_seed_plan(root), build_seed_plan(root)
    assert first.digest == second.digest
    assert first.counts["transactions"] == 1200
    assert first.counts["cases"] == 51  # 17 cases + 34 evidence rows
    assert any(row["merchantId"] == {"S": "C#customer_demo_001"} for row in first.items["merchants"])
    assert any(row["merchantId"] == {"S": "A#ASTERIAIO"} for row in first.items["merchants"])


def test_seed_discovers_only_active_exact_account_region_tables():
    outputs = [{"OutputKey": output, "OutputValue": table} for (_, output), table in zip(
        DATA_OUTPUTS.items(),
        ("ThemisTransactions", "ThemisCases", "ThemisMerchants"), strict=True,
    )]
    responses = [{"json": {"Stacks": [{"StackStatus": "UPDATE_COMPLETE", "Outputs": outputs}]}}]
    for table in ("ThemisTransactions", "ThemisCases", "ThemisMerchants"):
        responses.append({"json": {"Table": {"TableStatus": "ACTIVE", "TableArn": f"arn:aws:dynamodb:us-east-1:123456789012:table/{table}"}}})
    runner = FakeRunner(responses)
    aws = AwsCli(Target("123456789012", "us-east-1", "demo"), runner=runner)
    assert discover_seed_tables(aws)["cases"] == "ThemisCases"


def test_seed_batches_writes_and_retries_unprocessed_items():
    plan = build_seed_plan(Path(__file__).resolve().parents[2])
    small = type(plan)({"transactions": plan.items["transactions"][:2]}, "digest")
    pending = {"ThemisTransactions": [{"PutRequest": {"Item": plan.items["transactions"][0]}}]}
    runner = FakeRunner([{"json": {"UnprocessedItems": pending}}, {"json": {"UnprocessedItems": {}}}])
    aws = AwsCli(Target("123456789012", "us-east-1", "demo"), runner=runner)
    assert apply_seed(aws, small, {"transactions": "ThemisTransactions"}) == 2
    assert len(runner.calls) == 2
    assert all(call[1]["input"] for call in runner.calls)


def test_cleanup_is_a_read_only_plan_with_no_automatic_destroy():
    responses = [{"json": {"Account": "123456789012", "Arn": "arn:test"}}]
    responses.extend({"json": stack_response(name)} for name in ("ThemisData", "ThemisAgent", "ThemisMessaging", "ThemisObservability", "ThemisWeb"))
    runner = FakeRunner(responses)
    aws = AwsCli(Target("123456789012", "us-east-1", "demo"), runner=runner)
    plan = cleanup_plan(aws)
    assert plan["executed"] is False
    assert "cdk destroy --all" in plan["manualCommand"]
    assert all(command[1] in ("sts", "cloudformation") for command, _ in runner.calls)


def test_post_deploy_smoke_is_read_only_and_checks_seeded_resources():
    class StubAws:
        target = Target("123456789012", "us-east-1", "demo")

        def __init__(self):
            self.calls = []

        def verify_identity(self):
            self.calls.append(("sts", "get-caller-identity"))
            return {"Account": self.target.account, "Arn": "arn:test"}

        def outputs(self, name):
            values = {key: f"value-{key}" for key in REQUIRED_OUTPUTS.get(name, ())}
            if name == "ThemisData":
                values.update(TransactionsTableName="ThemisTransactions", CasesTableName="ThemisCases",
                              MerchantsTableName="ThemisMerchants", ArtifactsBucketName="themis-artifacts-test")
            if name == "ThemisAgent":
                values["ToolsAdapterFunctionName"] = "ThemisToolsAdapter"
            if name == "ThemisMessaging":
                values.update(
                    NormalizerFunctionName="ThemisMessageNormalizer",
                    InboundTopicArn="arn:aws:sns:us-east-1:123456789012:inbound",
                    RcsInboundTopicArn="arn:aws:sns:us-east-1:123456789012:rcs",
                    DeliveryEventTopicArn="arn:aws:sns:us-east-1:123456789012:delivery",
                )
            return values

        def stack(self, name):
            self.calls.append(("cloudformation", "describe-stacks"))
            return {"StackStatus": "CREATE_COMPLETE", "Outputs": [
                {"OutputKey": key, "OutputValue": value} for key, value in self.outputs(name).items()
            ]}

        def json(self, *args, input_json=None):
            self.calls.append((args[0], args[1]))
            if args[:2] == ("dynamodb", "describe-table"):
                table = args[args.index("--table-name") + 1]
                return {"Table": {"TableStatus": "ACTIVE", "TableArn": f"arn:aws:dynamodb:us-east-1:123456789012:table/{table}"}}
            if args[:2] == ("dynamodb", "get-item"):
                return {"Item": {"fixture": {"BOOL": True}}}
            if args[:2] == ("s3api", "get-bucket-location"):
                return {"LocationConstraint": None}
            if args[:2] == ("lambda", "get-function-configuration"):
                return {"State": "Active", "LastUpdateStatus": "Successful"}
            if args[:2] == ("sns", "get-topic-attributes"):
                arn = args[args.index("--topic-arn") + 1]
                return {"Attributes": {"TopicArn": arn}}
            if args[:2] == ("cloudformation", "list-stack-resources"):
                return {"StackResourceSummaries": [
                    {"ResourceType": f"AWS::BedrockAgentCore::Type{i}", "ResourceStatus": "CREATE_COMPLETE"}
                    for i in range(5)
                ]}
            return {}

    aws = StubAws()
    result = read_only_smoke(aws)
    assert result["ok"] is True
    assert result["checks"]["topics"] == 3
    assert not any(service in ("bedrock-agentcore", "lambda-invoke") or operation == "publish"
                   for service, operation in aws.calls)
