# Three-minute demo script

Prepare one local or deployed happy-path environment and a prerecorded backup. Never imply the backup is live, and never use a real account or transaction.

## 0:00–0:20 — The problem

**Say:** “Disputing a charge makes the customer coordinate the bank, the merchant name, the evidence, and the follow-up. Themis reverses that burden: the customer sends one message, and a governed agent carries the investigation.”

**Show:** The architecture image, briefly highlighting RCS/SMS, AgentCore, Cedar policy, and the operations view.

## 0:20–0:45 — Start where the customer already is

**Do:** Send: “I do not recognize the Asteria charges.”

**Say:** “The messaging Lambda normalizes a trusted inbound event and sends the turn to the AgentCore Runtime. The data is entirely synthetic.”

**Expected:** Themis identifies the customer and asks a concise confirmation question about the related recurring charges.

## 0:45–1:15 — Gather the right scope

**Do:** Confirm that the listed charges are unfamiliar.

**Say:** “Instead of making the customer enumerate statement lines, Themis groups the matching transactions and resolves the statement descriptor to the underlying merchant.”

**Expected:** Six related `$9.99` charges are grouped into the case. If the exact fixture count differs, narrate the visible result rather than claiming six.

## 1:15–1:45 — Investigate with structured evidence

**Show:** The tool/evidence trace or case detail.

**Say:** “The model orchestrates, but typed tools retrieve the ledger, merchant aliases, authorization signals, and prior merchant intelligence. Evidence is structured and attributable; uncertainty is retained.”

**Expected:** A classification and evidence bundle are visible, with no invented external research.

## 1:45–2:05 — Enforce policy

**Show:** A Cedar decision and configured demo threshold.

**Say:** “The model does not approve its own financial action. AgentCore Policy applies deterministic Cedar rules. Only low-value, high-confidence demo outcomes may proceed; ambiguous or higher-risk cases escalate.”

**Expected:** The happy path receives the policy-allowed synthetic outcome. Keep an escalation example ready in a second tab.

## 2:05–2:25 — Close the loop

**Show:** The generated report/evidence reference and customer update. If deployed and verified, show the SES email.

**Say:** “Themis persists the case and evidence, generates the report, and explains the outcome in plain language. All actions are simulated—no real money moves.”

## 2:25–2:45 — Give operations a view

**Show:** The Amplify dashboard with the case and merchant panel.

**Say:** “Operations can inspect cases, merchant aliases, risk signals, and review needs. In this prototype the dashboard is fixture-backed; live DynamoDB integration is a stated next step.”

## 2:45–3:00 — Demonstrate the flywheel

**Show:** A second synthetic customer/case involving the same merchant.

**Say:** “The second case reuses durable merchant intelligence instead of starting from zero. That is the flywheel: faster investigations, consistent policy, and less customer effort—without giving the model uncontrolled financial authority.”

End on the architecture or product title. If any live service fails, switch visibly to the prerecorded/local run and state what is being shown.
