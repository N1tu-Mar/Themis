"""Runtime configuration. Budgets follow prompt.md #13.3; model IDs and thresholds come from env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class Config:
    mode: str = "local"
    max_model_turns: int = 8
    max_candidates: int = 20
    max_history_cases: int = 5
    max_memory_records: int = 3
    max_research_pages: int = 5
    max_research_calls: int = 1
    max_auth_lookups: int = 3
    match_window_days: int = 90
    escalation_confidence: float = 0.7
    browser_research: bool = False
    structured_tools: bool = True   # integrated Gateway supports update_case.outcome and escalation summary/evidenceRefs
    model_id_fast: str = ""
    model_id_reasoning: str = ""
    gateway_url: str = ""
    memory_id: str = ""

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "Config":
        mode = env.get("THEMIS_MODE", "local")
        if mode not in ("local", "aws"):
            raise ValueError("THEMIS_MODE must be local or aws")
        conf = float(env.get("THEMIS_ESCALATION_CONFIDENCE", cls.escalation_confidence))
        if not 0 <= conf <= 1:
            raise ValueError("THEMIS_ESCALATION_CONFIDENCE must be between 0 and 1")
        return cls(
            mode=mode,
            escalation_confidence=conf,
            browser_research=env.get("ENABLE_BROWSER_RESEARCH", "false").lower() == "true",
            structured_tools=env.get("THEMIS_STRUCTURED_TOOLS", "true").lower() == "true",
            model_id_fast=env.get("BEDROCK_MODEL_ID_FAST", ""),
            model_id_reasoning=env.get("BEDROCK_MODEL_ID_REASONING", ""),
            gateway_url=env.get("GATEWAY_URL", ""),
            memory_id=env.get("MEMORY_ID", ""),
        )
