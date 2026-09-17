# Synthetic fixtures

All identities, merchants, transactions, evidence and decisions are fictional. Phone numbers use the reserved fictional 555-0100–0149 range, and emails use `example.test`. No real account data or external research is included.

Two independent fixture sets are available. Do not concatenate them when calculating profile statistics:

| Set | Files | Purpose |
| --- | --- | --- |
| Representative | Original descriptive filenames (`customers.json`, `transactions.json`, etc.) | One-record schema examples from bootstrap |
| Demo | `demo.json` and `demo-*.json` in the four domain directories | 50 customers, 1,200 transactions, 40 merchants/profiles, 12 historical disputes and five scenario cases |

The demo includes four alias groups, three ordinary legitimate recurring merchants with stable billing cadences, one synthetic emerging-risk profile with expiring signals, and one ambiguous authentication case. Profile statistics reconcile with the fixture cases. The recognized purchase contributes to total cases but not resolved customer disputes.

`scenarios.json` is fixture-only metadata identifying expected inputs/results for specification scenarios A–E:

- A: six weekly Asteria charges of $9.99, total $59.94, plus an unrelated $19.99 Asteria charge to exclude.
- B: a cancellation date before subsequent subscription charges; classification is `RECURRING_PAYMENT_AFTER_CANCELLATION`.
- C: canonical merchant recognition, `CUSTOMER_RECOGNIZED_MERCHANT`, closed without opening a dispute.
- D: strong authentication contradicts the claim; human review, no action taken.
- E: a new customer charge after multiple historical Asteria disputes, cached profile available, customer verification still pending. Expected cache/no-research behavior must be implemented by service workers.

Inbound fixtures cover RCS/SMS. Outbound fixtures cover RCS/SMS and an informational EMAIL summary, without sending anything. Linked audit events cover each demo case and contain only concise action/tool/result fields. IDs and times are deterministic. Historical case timestamps predate all active scenarios. Actions are synthetic snapshots, with matching policy allowances for actions already taken.

From the repository root:

```sh
npm run build --workspace @themis/contracts
node fixtures/scripts/generate-demo.mjs
npm test --workspace @themis/contracts
```

The generator uses no randomness, network or new dependencies. It validates shapes, unique IDs, ownership, references, totals, report snapshots, policy allowances, aliases, profile counts and risk-signal expiry before writing. Tests compare committed JSON with regenerated output and deliberately corrupt references/totals to verify rejection. Fixture integrity validation is fixture-only; service workers must implement their own persistence and policy guarantees.

QA/demo owns loading/reset scripts and service-level scenario execution. Contracts owns fixture data and generator changes.
