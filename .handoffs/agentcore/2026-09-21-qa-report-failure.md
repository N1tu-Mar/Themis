# QA finding: failed `generate_case_report` is swallowed (from qa-demo)

Repro: `pytest tests/e2e/test_failures.py -k report_failure`. Inject a persistent failure (error or raise) on `generate_case_report`.

Result: case is RESOLVED, no report exists, no escalation/human-review request, and the customer is told
"I've recorded your case and prepared a report". A later customer turn does not retry (state is terminal).

Ask: treat a failed report as a required-tool failure once the case exists (escalate like other required tools), or retry it on the
next turn, and never claim a report was prepared unless the tool returned ok.
`test_report_failure_is_never_reported_as_success` is `xfail(strict=True)`.
