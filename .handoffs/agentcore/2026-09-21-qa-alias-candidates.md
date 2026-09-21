# QA finding: Scenario A matches 5 of 6 charges (from qa-demo)

Repro: `python3 scripts/demo/run_demo.py` (Scenario A) or `pytest tests/e2e/test_scenarios.py -k spec_totals`.

Customer says "9.99 from ASTERIA". `_match` searches `descriptorContains = first token of the descriptor`, so txn_demo_0003
(descriptor `ASTDIGITAL`, an alias of the same merchant) is missing: case has 5 charges / $49.95, not the fixture's 6 / $59.94
(`fixtures/scenarios.json` scenario A). The reply then offers it as one of "2 other charges ($29.98)", together with the unrelated $19.99.

Ask: after `resolve_merchant`, widen the candidate search to every alias of the resolved merchant (same amount/window filters), so
the proposal lists all six weekly $9.99 charges and still excludes txn_demo_0007 ($19.99).

`test_scenario_a_spec_totals_six_weekly_charges` is `xfail(strict=True)`; it fails the build when fixed, so remove the marker then.
