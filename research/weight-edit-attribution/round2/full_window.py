"""Small full-window transfer screen of the shadow procedure; explicit open-loop replay."""
import json
import resource
import signal
import time

from r2_common import HERE, R1, harness, load_dev, sha, verify_round1, write_json
from build_cases import pick_prompt
from experiment import Runtime, preflight, timeout
from generation import request, effective_text
from common import offline_lm
from score import summarise
from memoria_engine.extractors import parse_events
from memoria_engine.evaluation.oracle import ledger_answer, values_equal

# Two actual attribution errors and two actual correctly extracted control
# windows. No synthetic wording; initial cached beliefs and full transcript
# window preserved. Frozen before this transfer run.
WINDOWS = [("ES2003b", 175, 178), ("ES2003c", 101, 103), ("TS3004c", 116, 119), ("TS3004c", 184, 187)]
FOCUS = [
    ("ES2003b", 177, "case_curve", "double curved", False),
    ("ES2003c", 102, "battery", "lithium", True),
    ("ES2003c", 102, "case_curve", "double curved", True),
    ("ES2003c", 102, "case_material", "rubber", True),
    ("TS3004c", 117, "case_material", "rubber", False),
    ("TS3004c", 185, "case_material", "plastic", True),
]


def main():
    verify_round1()
    prompts = json.loads((R1 / "data/prompts.json").read_text())["app"]
    selected = [pick_prompt(prompts, *spec) for spec in WINDOWS]
    write_json(HERE / "data/full-window-freeze.json", {"windows": [{"key": p["key"], "meeting": p["meeting"], "prompt_sha256": p["prompt_sha256"]} for p in selected],
                                                      "focus": FOCUS, "code_sha256": sha(__import__("pathlib").Path(__file__).read_bytes()),
                                                      "scope": "four unchanged original app windows; open-loop replacements only"})
    check = preflight()
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(450)
    rt = Runtime()
    generated = []
    try:
        for p in selected:
            row = request(rt, p["prompt"], p["system"], "shadow", p["meeting"])
            generated.append({**row, "original_key": p["key"]})
            print(json.dumps({k: row[k] for k in ("id", "seconds", "output_tokens")}), flush=True)
        write_json(HERE / "results/full-window-outputs.json", {"preflight": check, "rows": generated,
                                                               "peak_process_rss_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e9})
    finally:
        rt.close()
        signal.alarm(0)
    replaced = {r["original_key"]: {**r, "text": effective_text(r)} for r in generated}
    baseline_scores, changed_scores, changes = [], [], []
    for chain in load_dev():
        base = harness.run_chain(chain, offline_lm(), "app")
        records = {m: [replaced.get(r["key"], r) for r in rs] for m, rs in base["records"].items()}
        changed = harness.run_chain(chain, harness._Recorded(records), "app")
        baseline_scores.append(harness.score_chain(chain, base))
        changed_scores.append(harness.score_chain(chain, changed))
        for q in chain.questions:
            before = ledger_answer(base["pipeline"].ledger, q, chain.now)
            after = ledger_answer(changed["pipeline"].ledger, q, chain.now)
            if values_equal(before, q.gold) != values_equal(after, q.gold):
                changes.append({"series": chain.chain_id, "qid": q.qid, "type": q.type, "slot": q.object_id,
                                "gold": q.gold, "before": before, "after": after})
    focus = []
    for meeting, turn, obj, value, expected in FOCUS:
        candidates = [c for row in generated if row["id"] == meeting for c in parse_events(effective_text(row))[0]]
        found = [c for c in candidates if c.turn == turn and c.object_id == obj and str(c.value) == str(value) and not c.unresolved]
        focus.append({"meeting": meeting, "turn": turn, "object_id": obj, "value": value, "should_write": expected,
                      "present": bool(found), "quotes": [c.quote for c in found], "passed": bool(found) == expected})
    write_json(HERE / "results/full-window-summary.json", {"scope": "four-window open-loop transfer; not full-dev closed-loop inference",
                                                           "baseline": summarise(baseline_scores), "shadow": summarise(changed_scores),
                                                           "question_flips": changes, "source_focus": focus})
    print(json.dumps({"source_focus": focus, "question_flips": changes,
                      "shadow": {k: summarise(changed_scores)[k] for k in ("qa_exact", "qa_exact_by_type", "tp", "values", "inbox_confirm_all")}}, indent=2))


if __name__ == "__main__":
    main()
