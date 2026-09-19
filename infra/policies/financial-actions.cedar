// Gate the money/account-impacting tools from prompt.md #11 and #24.
// The Gateway arguments named here are fixed by config/tool-schemas.ts.
// Bank-tools re-evaluates the same conditions from stored case state before
// simulating an action, so model-supplied arguments are never authoritative.

permit(
  principal,
  action == Action::"propose_dispute_creation",
  resource
) when {
  context.hasConfirmedTransactions == true
};

permit(
  principal,
  action == Action::"propose_payment_block",
  resource
) when {
  context.customerRequested == true
};

// No permit is granted for propose_card_replacement. Its deterministic
// result is human review; the orchestrator escalates the policy denial.

// Auto-approve small provisional credits; anything above the
// configured limit must go to a human. The limit is injected at deploy time
// via infra/config/env.ts (DEMO_AUTONOMOUS_CREDIT_LIMIT) and
// substituted into this statement by agent-stack.ts before upload.
permit(
  principal,
  action == Action::"propose_provisional_credit",
  resource
) when {
  context.amount <= __DEMO_AUTONOMOUS_CREDIT_LIMIT__ &&
  context.confidence >= __DEMO_CREDIT_CONFIDENCE_THRESHOLD__ &&
  (
    context.claimType == "UNAUTHORIZED_TRANSACTION" ||
    context.claimType == "UNRECOGNIZED_MERCHANT" ||
    context.claimType == "DUPLICATE_TRANSACTION" ||
    context.claimType == "WRONG_AMOUNT"
  )
};
