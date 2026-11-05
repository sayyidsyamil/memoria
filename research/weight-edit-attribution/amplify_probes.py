"""Opposite-sign causal follow-up, with the original direction/neurons frozen."""
import json
import signal

from common import HERE, write_json
from experiment import Runtime, install, preflight, timeout, summarize
from cases import probe


def main():
    check = preflight()
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(450)
    rt = Runtime()
    cases = json.loads((HERE / "data/cases.json").read_text())
    rows = []
    restore = install(rt, -.5)
    try:
        for case in cases:
            row, _ = rt.score(probe(case, context=True))
            rows.append({**row, "id": case["id"], "condition": "amplify"})
    finally:
        restore()
        rt.close()
        signal.alarm(0)
    result = {"preflight": check, "rows": rows, "summary": summarize(rows, cases)}
    write_json(HERE / "results/amplify-probes.json", result)
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    main()
