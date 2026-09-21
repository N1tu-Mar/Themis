"""No-network deterministic Themis demo: scenarios A-E through the real agent, tools, Cedar policy and Dynamo-shaped store.

  python3 scripts/demo/run_demo.py                 # instant (tests, rehearsal)
  python3 scripts/demo/run_demo.py --duration 180  # paced to ~3 minutes for a live walkthrough

Output is identical on every run (case ids are relabelled; `--show-ids` prints the real ones). Exit 1 if any check fails.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import time
from datetime import UTC, datetime

from world import Config, World, reconcile_case, reconcile_world

SCENES = [
    ("A", "Unrecognized recurring charges", "customer_demo_001", ["9.99 from ASTERIA", "yes I don't recognize it"]),
    ("B", "Charges after cancellation", "customer_demo_002", ["9.99 from ASTERIA SUB", "yes, I canceled it before"]),
    ("C", "Customer recognizes the merchant", "customer_demo_003", ["12.99 from MEADOW SUB", "yes I recognize it"]),
    ("D", "Authentication contradicts the claim", "customer_demo_004", ["49.99 from ASTDIGITAL", "yes I didn't authorize it"]),
]
E_CASES = [("E1", "customer_demo_005", ["9.99 from ASTERIA SUB", "yes I don't recognize it"]),
           ("E2", "customer_demo_001", ["9.99 from ASTERIA", "yes I don't recognize it"])]


def run(duration: float = 0, show_ids: bool = False, out=print, sleep=time.sleep) -> dict:
    lines: list[str] = []
    labels: dict[str, str] = {}

    def say(text: str = "") -> None:
        lines.append(text)

    def mask(text: str, label: str) -> str:
        if show_ids:
            return text
        return re.sub(r"case_[0-9a-f]{12}", lambda m: labels.setdefault(m[0], f"case_{label}"), text)

    def scene(w: World, label: str, customer: str, messages: list[str]):
        for m in messages:
            r = w.chat(customer, m)
            say(f"  customer  > {m}")
            say(f"  themis    > {mask(r.text, label)}")
        case = w.store.get_case(r.case_id)
        rec = reconcile_case(w, r.case_id)
        say(f"  result    : {rec['status']}  total ${rec['total']:.2f}  evidence {rec['evidence']}  policy {rec['policy'] or 'none'}  audit rows {rec['audit']}")
        return r.case_id, case

    w = World(config=Config(structured_tools=True))
    ids: list[str] = []
    say("THEMIS demo - synthetic data, no network, no AWS. Every case is reconciled against ledger, evidence, audit and policy.")
    for sid, title, customer, messages in SCENES:
        say(f"\n== Scenario {sid}: {title}")
        ids.append(scene(w, sid, customer, messages)[0])

    say("\n== Scenario E: same merchant, two customers, one research call")
    w2 = World(config=Config(structured_tools=True))
    w2.clock.t = datetime(2026, 9, 26, tzinfo=UTC)  # the cached Asteria profile has expired
    e_ids = []
    for i, (label, customer, messages) in enumerate(E_CASES):
        if i:
            w2.restart()  # cold start: only the durable tables survive
            say("  -- new process; merchant profile served from the durable cache --")
        e_ids.append(scene(w2, label, customer, messages)[0])
        say(f"  research calls so far: {len(w2.researcher.calls)}")
    verification = [next(e for e in w2.store.evidence_for_case(c) if e.type == "CUSTOMER_MERCHANT_VERIFICATION") for c in e_ids]
    for v in verification:
        say(f"  verified  : {v.claim}")
    ok = len(w2.researcher.calls) == 1 and verification[0].claim != verification[1].claim

    total, e_total = reconcile_world(w, ids), reconcile_world(w2, e_ids)
    say(f"\n== Reconciliation: A-D {total['cases']} cases / {total['transactions']} txns / ${total['total']:.2f}; "
        f"E {e_total['cases']} cases / {e_total['transactions']} txns / ${e_total['total']:.2f}; research calls in E: {len(w2.researcher.calls)}")
    say("RESULT: " + ("PASS" if ok else "FAIL"))

    pause = duration / max(len(lines), 1)
    for line in lines:
        out(line)
        if pause:
            sleep(pause)
    return {"ok": ok, "digest": hashlib.sha256("\n".join(lines).encode()).hexdigest(), "lines": lines}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--duration", type=float, default=0, help="spread output over this many seconds")
    p.add_argument("--show-ids", action="store_true")
    a = p.parse_args()
    result = run(a.duration, a.show_ids)
    print(f"transcript sha256: {result['digest']}")
    raise SystemExit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
