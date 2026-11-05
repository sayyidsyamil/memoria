"""0.8B against the 4B on Memoria's tasks, development data only, from the caches (no model).

    python3.11 small_tables.py

Extraction coverage is partial (the 0.8B comparison was stopped on the user's steering): each extraction row is
computed on the series every listed variant completed, with the 4B on the same series.
"""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
import guard_summary  # noqa: E402
import harness  # noqa: E402
import route_summary  # noqa: E402
import score  # noqa: E402
from lm import LM  # noqa: E402

HERE = Path(__file__).resolve().parent
VARIANTS = ["4b", "0.8b-bf16", "0.8b-edit-bf16", "0.8b-q4", "0.8b-edit-q4"]
SERIES = harness.series_of("old-dev,new-dev")


def covered(variant):
    lm, out = LM(variant, HERE / "cache" / f"{variant}.jsonl", offline=True), []
    for name in SERIES:
        try:
            harness.run_chain(harness.load_series([name])[0], lm, "app")
            out.append(name)
        except SystemExit:
            pass
    return out


def extraction(variant, names):
    lm = LM(variant, HERE / "cache" / f"{variant}.jsonl", offline=True)
    chains = harness.load_series(names)
    s = score.summarise([harness.score_chain(c, harness.run_chain(c, lm, "app")) for c in chains])
    return {"series": names, "qa": s["qa_exact"], "by_type": s["qa_exact_by_type"], "gold_found": f"{s['tp']}/{s['gold_events']}",
            "wrong_writes": s["values"].get("wrong", 0), "writes_per_meeting": s["writes_per_meeting"], "filtered": s["filtered"],
            "replies_at_budget": f"{s['hit_budget']}/{s['windows']}", "unclean": s["unclean"],
            "gen_seconds_per_meeting": s["meeting_seconds_mean"], "peak_gb": s["peak_gb_max"]}


def main():
    out = {"guard": [guard_summary.summary(v) for v in VARIANTS], "routing": [route_summary.summary(v) for v in VARIANTS]}
    coverage = {v: covered(v) for v in VARIANTS}
    out["coverage"] = coverage
    pairs = {"stock vs edited, bf16": ["0.8b-bf16", "0.8b-edit-bf16"], "stock vs edited, 4-bit": ["0.8b-q4", "0.8b-edit-q4"]}
    out["extraction"] = {}
    for label, pair in pairs.items():
        common = [s for s in SERIES if all(s in coverage[v] for v in pair)]
        out["extraction"][label] = {v: extraction(v, common) for v in ["4b", *pair]} if common else {}
    print(json.dumps(out, indent=1))
    (HERE / "results" / "dev").mkdir(parents=True, exist_ok=True)
    (HERE / "results" / "dev" / "small_models.json").write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
