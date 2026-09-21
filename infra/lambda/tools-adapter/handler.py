"""AgentCore Gateway Lambda target for the 20 Themis tools. Routing lives in router.py.

Deployed asset layout is produced by scripts/build_assets.py (handler + router + bank_tools,
merchant_intel, orchestrator packages + merchant-profiles.json + schemas.json).

Gateway Lambda targets receive the tool arguments as the event and the tool name in the invocation client
context (`bedrockAgentCoreToolName`, "<target>___<tool>"). The legacy {toolName|name, input|arguments}
envelope is also accepted so the adapter can be invoked directly.
"""
import json
import logging
import os
from pathlib import Path

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_adapter = None


class LambdaMessenger:
    """Synchronous invoke of the messaging Lambda; any failure raises (delivery outcome unknown)."""
    def __init__(self, client, function_name):
        self.client, self.function_name = client, function_name

    def __call__(self, request):
        out = self.client.invoke(FunctionName=self.function_name, InvocationType="RequestResponse",
                                 Payload=json.dumps(request).encode())
        body = json.loads(out["Payload"].read() or b"{}")
        if out.get("FunctionError") or not body.get("messageId"):
            raise RuntimeError(f"messaging invoke failed: {body.get('errorMessage', 'no messageId')}")
        return body


def _build():
    import boto3
    from bank_tools.dynamo_store import DynamoBankToolsStore, Tables
    from dynamo_profile_store import DynamoProfileStore
    from merchant_intel import MerchantIntel
    from orchestrator.workflow import S3ReportStore
    from router import ToolAdapter

    here = Path(__file__).parent
    dynamo = boto3.client("dynamodb")
    profile_store = DynamoProfileStore(dynamo, os.environ["MERCHANT_PROFILE_TABLE"])
    intel = MerchantIntel(profile_store)
    for profile in json.loads((here / "merchant-profiles.json").read_text(encoding="utf-8")):
        if profile_store.get(profile["merchantId"]) is None:
            intel.load_profiles([profile])
    return ToolAdapter(
        DynamoBankToolsStore(dynamo, Tables.from_env()), intel,
        S3ReportStore(boto3.client("s3"), os.environ["ARTIFACTS_BUCKET"]),
        LambdaMessenger(boto3.client("lambda"), os.environ["MESSAGING_FUNCTION_NAME"]))


def parse_event(event, context):
    custom = getattr(getattr(context, "client_context", None), "custom", None) or {}
    name = custom.get("bedrockAgentCoreToolName")
    if name:
        return name.split("___", 1)[-1], event
    return (event.get("toolName") or event.get("name") or "unknown"), event.get("input", event.get("arguments", {}))


def handler(event, context):
    global _adapter
    tool, arguments = parse_event(event, context)
    try:
        _adapter = _adapter or _build()
        return _adapter.call(tool, arguments)
    except Exception as exc:  # noqa: BLE001 - never leak internals to the model
        logger.exception("tool %s failed", tool)
        return {"status": "error", "error": {"code": "INTERNAL_ERROR", "message": type(exc).__name__}}
