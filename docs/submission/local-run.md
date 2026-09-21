# Local run instructions

Local mode is AWS-free and uses only synthetic fixtures and in-process service doubles.

## Prerequisites

- Node.js 22 or newer
- npm
- Python 3.12

## Install and verify

From the repository root:

```bash
npm ci
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install pytest
npm run check
```

`npm run check` builds all workspaces, runs JavaScript/TypeScript tests, runs the Python suite, and executes the local cross-service composition test. It does not contact AWS or send messages.

## Run a local conversation

With the virtual environment active:

```bash
THEMIS_MODE=local python services/agent/src/orchestrator/main.py
```

Enter one JSON object per line:

```json
{"conversationId":"demo-1","customerId":"customer_demo_001","message":"I do not recognize the Asteria charges."}
```

Plain-text lines also work and use the default demo customer. The process prints one JSON response per turn. Stop it with `Ctrl-C`.

## Run the dashboard

In a second terminal:

```bash
npm run dev --workspace @themis/dashboard
```

Use the URL printed by the development server. The current dashboard intentionally reads fixture data; its review controls update browser state only.

## Refresh synthetic demo data

Only when the fixtures need to be regenerated:

```bash
npm run build --workspace @themis/contracts
node fixtures/scripts/generate-demo.mjs
npm test --workspace @themis/contracts
```

Fixture generation rewrites repository data, so do not run it immediately before a demo unless the result is reviewed and committed separately.
