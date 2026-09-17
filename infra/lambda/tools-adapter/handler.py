"""Placeholder AgentCore Gateway tool-adapter Lambda.

Infra owns this file only as a bootstrap so `cdk deploy` produces a working
Lambda before the real tool implementations land. It must be replaced (or
this directory's contents swapped) by the agentcore/bank-tools/merchant-intel
workstreams per .handoffs/infra/tools-adapter-contract.md - infra does not
implement tool business logic.

It never claims a financial/account-impacting action succeeded: unknown or
unimplemented tools return status "not_implemented", never "ok".
"""
import json


def handler(event, context):
    tool_name = event.get("toolName") or event.get("name") or "unknown"
    return {
        "status": "not_implemented",
        "tool": tool_name,
        "message": "Tool adapter placeholder - see .handoffs/infra/tools-adapter-contract.md",
    }
