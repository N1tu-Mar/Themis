"""Optional AWS adapters. boto3 is imported lazily, so tests and THEMIS_MODE=local never touch AWS.

UNVERIFIED against live services (no paid/live AWS calls are made by this workstream): the Gateway
MCP wire format, tool-name prefixing, and the AgentCore Memory data-plane calls.
"""
from __future__ import annotations

import json
import re
import urllib.request
from typing import Any

from .config import Config


class BedrockModel:
    def __init__(self, cfg: Config):
        import boto3
        self.client, self.ids = boto3.client("bedrock-runtime"), {"fast": cfg.model_id_fast, "reasoning": cfg.model_id_reasoning}

    def analyze(self, system: str, view: dict[str, Any], message: str, tier: str) -> dict[str, Any]:
        r = self.client.converse(
            modelId=self.ids[tier] or self.ids["fast"], system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": json.dumps({"case": view, "customerMessage": message})}]}],
            inferenceConfig={"maxTokens": 400, "temperature": 0},
        )
        text = r["output"]["message"]["content"][0]["text"]
        return json.loads(re.search(r"\{.*\}", text, re.S).group(0))


class GatewayHTTPClient:
    """AgentCore Gateway is an MCP endpoint (AWS_IAM auth): SigV4-signed JSON-RPC tools/call."""
    def __init__(self, url: str):
        import boto3
        self.url, self.session = url, boto3.Session()

    def call(self, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": arguments}})
        req = AWSRequest(method="POST", url=self.url, data=body, headers={"Content-Type": "application/json"})
        SigV4Auth(self.session.get_credentials().get_frozen_credentials(), "bedrock-agentcore", self.session.region_name).add_auth(req)
        with urllib.request.urlopen(urllib.request.Request(self.url, data=body.encode(), headers=dict(req.headers), method="POST"), timeout=20) as resp:
            result = json.load(resp).get("result", {})
        text = result["content"][0]["text"]
        if result.get("isError"):
            return {"status": "error", "error": {"code": "GATEWAY_ERROR", "message": text[:200]}}
        return json.loads(text)


class AgentCoreMemory:
    """Case state as the latest event in a per-conversation session; recall via memory-record search."""
    def __init__(self, memory_id: str):
        import boto3
        self.client, self.memory_id = boto3.client("bedrock-agentcore"), memory_id

    def load(self, conversation_id: str) -> dict[str, Any] | None:
        events = self.client.list_events(memoryId=self.memory_id, actorId="themis", sessionId=conversation_id, includePayloads=True)["events"]
        if not events:
            return None
        latest = max(events, key=lambda e: e["eventTimestamp"])
        return json.loads(latest["payload"][0]["blob"])

    def save(self, conversation_id: str, state: dict[str, Any]) -> None:
        from datetime import datetime, timezone
        self.client.create_event(memoryId=self.memory_id, actorId="themis", sessionId=conversation_id,
                                 eventTimestamp=datetime.now(timezone.utc), payload=[{"blob": json.dumps(state)}])

    def recall(self, query: str, limit: int) -> list[str]:
        r = self.client.retrieve_memory_records(memoryId=self.memory_id, namespace="/themis/", searchCriteria={"searchQuery": query, "topK": limit})
        return [rec["content"]["text"] for rec in r.get("memoryRecordSummaries", [])][:limit]


class NoResearch:
    """Browser research lives with merchant-intel; until that is wired the agent reports it unavailable."""
    def research(self, descriptor: str, max_pages: int) -> dict[str, Any] | None:
        return None
