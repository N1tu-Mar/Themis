// Gate the money/account-impacting tools from prompt.md #11 and #24.
// context.amount is provided by the Gateway invocation context for
// propose_provisional_credit (see tool-schemas.ts); other gated tools carry
// no amount and are allowed outright but still pass through the policy
// engine so every invocation gets an ALLOW/DENY/REQUIRE_HUMAN_REVIEW audit
// record (prompt.md #45).

permit(
  principal,
  action in [
    Action::"propose_payment_block",
    Action::"propose_card_replacement",
    Action::"propose_dispute_creation"
  ],
  resource
);

// Auto-approve small provisional credits; anything at or above the
// configured limit must go to a human. The limit is injected at deploy time
// via infra/config/env.ts (PROVISIONAL_CREDIT_AUTO_APPROVE_LIMIT) and
// substituted into this statement by agent-stack.ts before upload.
permit(
  principal,
  action == Action::"propose_provisional_credit",
  resource
) when {
  context.amount < __PROVISIONAL_CREDIT_AUTO_APPROVE_LIMIT__
};
