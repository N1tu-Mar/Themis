"""Narrow seams between the orchestrator and the outside world. Nothing else may do I/O."""
from __future__ import annotations

from typing import Any, Protocol


class ModelClient(Protocol):
    def analyze(self, system: str, view: dict[str, Any], message: str, tier: str) -> dict[str, Any]:
        """One inference per customer turn. `tier` is "fast" or "reasoning" (IDs live in config).

        Returns extracted signals (see engine.Analysis); never decisions on money/account actions.
        """


class GatewayClient(Protocol):
    def call(self, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Invoke a Gateway tool by name with camelCase arguments.

        Returns the tool's compact JSON: {"status": "ok", ...} or {"status": "error", "error": {...}}.
        May raise on transport failure.
        """


class MemoryClient(Protocol):
    def load(self, conversation_id: str) -> dict[str, Any] | None: ...
    def save(self, conversation_id: str, state: dict[str, Any]) -> None: ...
    def recall(self, query: str, limit: int) -> list[str]:
        """Up to `limit` concise long-term memory records relevant to `query`."""


class MerchantResearch(Protocol):
    def research(self, descriptor: str, max_pages: int) -> dict[str, Any] | None:
        """Concise findings {"summary": str, "pages": int} or None when unavailable."""
