#!/usr/bin/env bash
# Three-minute deterministic demo (no network, no AWS). Usage: scripts/demo/demo.sh [seconds=180]
set -euo pipefail
cd "$(dirname "$0")/../.."
exec python3 scripts/demo/run_demo.py --duration "${1:-180}"
