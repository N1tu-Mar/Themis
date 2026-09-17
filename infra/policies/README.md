# AgentCore policy source

Cedar policy statements enforced by the AgentCore Policy Engine
(`infra/stacks/agent-stack.ts`) in front of the Gateway. These are the
deterministic gate referenced by prompt.md #24/#25: the LLM can *propose* a
financial/account-impacting action, but the action only executes if a policy
here allows it.

Each `.cedar` file is loaded verbatim as one `AWS::BedrockAgentCore::Policy`
resource's Cedar statement. Keep one file per policy concern so a diff shows
exactly which rule changed.

## Verify before first deploy

`Action::"..."` identifiers below assume Cedar action names match the Gateway
tool names in `infra/config/tool-schemas.ts` 1:1 (this is the natural mapping,
but AgentCore Policy is a very new service and the exact entity/action type
namespace it expects is set by the Gateway's registered tool schema, not by
this file). Before the first `cdk deploy`, confirm the actual action entity
IDs in the AWS console/docs for the deployed Gateway and adjust these
statements if the naming differs. `cdk synth` does not validate Cedar syntax
against a live schema, so a naming mismatch will surface as a deploy-time or
runtime policy-evaluation error, not a synth error.

## Policies

- `financial-actions.cedar` - gates the four money/account-impacting tools
  (`propose_provisional_credit`, `propose_payment_block`,
  `propose_card_replacement`, `propose_dispute_creation`). Provisional credit
  above `provisionalCreditAutoApproveLimit` (see `infra/config/env.ts`,
  default $50) requires human review instead of auto-allow; the others are
  allowed but always produce an audit record.
- `deny-arbitrary-actions.cedar` - default-deny fallback so an unrecognized
  action never silently passes.
