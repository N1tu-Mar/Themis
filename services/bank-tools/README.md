# Themis bank tools

Installable Python 3.12 package containing the typed, idempotent synthetic
banking tool surface and deterministic financial-action policy.

```sh
python3 -m pip install -e services/bank-tools
python3 -m pytest -q services/bank-tools/tests
```

`bank_tools.fixtures.load_demo_store()` loads the canonical committed demo
fixtures. No real account integration or money movement is implemented.
