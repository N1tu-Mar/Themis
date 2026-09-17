---
paths:
  - "services/agent/**"
---

# AgentCore workstream

- The MVP uses one Themis orchestrator, not an LLM debate/swarm.
- Agentic behavior = reasoning + narrow tools + memory + multi-step execution + deterministic policy.
- Keep case state structured and typed; chat history is not the source of truth.
- Target one model inference per conversational turn when practical.
- Do deterministic transaction filtering before giving candidates to the model.
- Do not send full account histories, full transcripts, or raw processor payloads to the model.
- Default automated investigation budget: <=8 model turns, <=20 candidate transactions, <=5 historical case summaries, <=3 relevant memory records.
- External merchant research only when internal/cached evidence is insufficient.
- Model IDs and thresholds come from configuration.
- Escalate ambiguity instead of adding self-critique/debate loops.
- Meaningful financial/account actions must pass deterministic policy.
- Store concise evidence and decision rationale, never hidden chain-of-thought.
