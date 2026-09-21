# Definition of done

This checklist maps directly to the final success criteria in `prompt.md` section 76 and to the submission material requested in sections 69–75. Statuses are evidence levels, not aspirations:

- **Locally verified** — exercised by repository tests or the local composition.
- **Implemented; live verification pending** — infrastructure/application path exists but has not been proven in a deployed account.
- **Partial** — useful prototype exists, with the named gap still open.

## Product success criteria (`prompt.md` §76)

| Criterion | Status | Evidence or remaining proof |
| --- | --- | --- |
| AWS Communication Developer Services is genuinely used at runtime | Implemented; live verification pending | AWS End User Messaging ingress/egress is defined; complete identity registration and prove a live handset exchange. |
| A real RCS/SMS message reaches the agent | Implemented; live verification pending | Inbound topics, channel role, and normalizer exist; register identities and run a handset test. |
| The agent investigates synthetic transactions | Locally verified | Python and cross-service composition tests exercise the synthetic ledger. |
| Merchant aliases are resolved | Locally verified | Deterministic merchant tools and fixtures cover alias resolution. |
| The claim is classified | Locally verified | Scenario and policy compatibility tests cover supported classifications. |
| Structured evidence is collected | Locally verified | Evidence/tool mapping is exercised locally. |
| Policy constrains consequential outcomes | Locally verified; live verification pending | Cedar behavior is tested locally; prove AgentCore Policy context/enforcement live. |
| Ambiguous cases escalate to human review | Locally verified | Ambiguity/review paths are covered by tests and fixtures. |
| A report is generated and persisted | Implemented; live verification pending | S3 report/evidence path and grants exist; inspect a deployed object. |
| SES sends the customer communication | Implemented; live verification pending | Send path exists; verify identity and receive a live email. |
| Merchant intelligence persists across cases | Locally verified; live verification pending | Dynamo-backed profile store is tested; verify deployed persistence. |
| A second related case reuses intelligence | Locally verified | Run the two-pass scenario and show the retained merchant profile/cache behavior. |
| The internal dashboard shows cases and merchant intelligence | Partial | Fixture UI plus server-side DynamoDB/S3 provider (`THEMIS_DASHBOARD_DATA_SOURCE=aws`); live verification pending. |
| Tests pass | Locally verified | JavaScript/TypeScript workspaces: 138 tests; Python: 202 tests; cross-service integration: 3 tests. |
| AWS deployment is reproducible | Implemented; live verification pending | Follow the ordered checklist and capture stack outputs in a clean account. |
| The demo is predictable | Partial | Script and deterministic fixtures exist; complete a timed live dress rehearsal and backup recording. |
| No real account is affected | Locally verified by design | Only synthetic fixtures and simulated actions are connected. |

## Submission requirements (`prompt.md` §§69–75)

- [x] Three-minute happy-path and second-case script is documented.
- [x] The 23-step end-to-end path in §69 is represented across the architecture, demo, deployment, and live-verification checklists.
- [x] The §70 second pass explicitly demonstrates reused merchant identity/history while preserving a customer-specific investigation.
- [x] Architecture source and judge-friendly export are included.
- [x] AWS services and their roles are enumerated.
- [x] Security and financial-safety boundaries are explicit.
- [x] Local run and test order is reproducible.
- [x] AWS synth, package, preflight, deploy, seed, and smoke order is documented.
- [x] Manual RCS, SMS, SES, Bedrock/AgentCore, and Amplify steps are separated from automation.
- [x] Submission-ready product copy is included.
- [x] Known limitations are stated without hiding live-verification gaps.
- [ ] Verify the root README against every required heading in §74 on the integration branch. It is intentionally not edited on this documentation-owned branch.
- [ ] Run all final validation commands and record a clean result.
- [ ] Complete manual provider registrations and a live AWS dress rehearsal.

## Final repository validation

From the repository root:

```bash
npm test --workspace=infra
npm run package:aws --workspace=infra
npm run synth --workspace=infra
npm run check
git diff --check
```

The branch is documentation-complete when those commands pass, the Mermaid source matches its exported SVG, and the submission links resolve. The live demo is ready only after every item marked “live verification pending” that will be shown to judges has been exercised in the target account.
