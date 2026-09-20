"""Cedar (infra/policies/financial-actions.cedar) and bank-tools' Python policy must agree on every gate."""
import itertools

import harness
from bank_tools.models import ActionType, Case, CaseStatus, ClaimType, PolicyOutcome
from bank_tools.policy import evaluate_policy


def case(confidence, claim, txns=("t1",)):
    return Case(caseId="c", customerId="u", status=CaseStatus.POLICY_REVIEW, createdAt="t", updatedAt="t", claimType=claim,
                merchantId=None, transactionIds=list(txns), evidenceIds=[], totalDisputedAmount=1.0, currency="USD",
                confidence=confidence, recommendedActions=[], requiresHumanReview=False)


def permit(permits, tool, **ctx):
    return bool(tool in permits and eval(permits[tool], {"__builtins__": {}}, {"context": ctx}))


def test_provisional_credit_thresholds_and_claim_types_agree():
    permits = harness.cedar_permits()
    for amount, conf, claim in itertools.product((0, 10, 50, 50.01, 500), (0.5, 0.79, 0.8, 0.95), ClaimType):
        py = evaluate_policy(ActionType.PROVISIONAL_CREDIT, case(conf, claim), amount=amount).outcome
        assert (py is PolicyOutcome.ALLOW) == permit(permits, "propose_provisional_credit", amount=amount, confidence=conf, claimType=str(claim)), (amount, conf, claim)


def test_dispute_and_block_agree():
    permits = harness.cedar_permits()
    for has in (True, False):
        py = evaluate_policy(ActionType.CREATE_DISPUTE, case(0.9, ClaimType.UNRECOGNIZED_MERCHANT, ("t1",) if has else ())).outcome
        assert (py is PolicyOutcome.ALLOW) == permit(permits, "propose_dispute_creation", hasConfirmedTransactions=has)
    for asked in (True, False):
        py = evaluate_policy(ActionType.BLOCK_RECURRING_MERCHANT, case(0.9, ClaimType.UNRECOGNIZED_MERCHANT), customer_requested=asked).outcome
        assert (py is PolicyOutcome.ALLOW) == permit(permits, "propose_payment_block", customerRequested=asked)


def test_card_replacement_is_never_permitted_by_either_layer():
    assert "propose_card_replacement" not in harness.cedar_permits()
    assert evaluate_policy(ActionType.REPLACE_CARD, case(1.0, ClaimType.UNAUTHORIZED_TRANSACTION)).outcome is PolicyOutcome.REQUIRE_HUMAN_REVIEW
