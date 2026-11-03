"""Every development table of README.md, recomputed from the call caches with no model (a cache miss stops it).

    python3.11 dev_tables.py            # prints the tables and writes results/dev/summary.json

Development splits only (old-dev + new-dev, 124 questions, 60 gold events). Open loop ("|") means a filter applied to
a finished run's candidates (its prompts fixed); "+" is closed loop (the filter's own beliefs in later prompts).
"""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402
import score  # noqa: E402
from lm import LM  # noqa: E402
from memoria_engine.evaluation.metrics import paired_sign_test  # noqa: E402

HERE = Path(__file__).resolve().parent
DEV = "old-dev,new-dev"
ROWS_4B = [
    ("app", "shipped app path (baseline)"),
    ("app>app-numwords", "+ amounts in words kept (open loop)"),
    ("app>app-loopstop", "+ stop at the first repeated event (open loop)"),
    ("app|support>=0", "support check, tau 0 (open loop)"),
    ("app|lexsupport", "lexical support control (open loop)"),
    ("app|reanchor:10", "re-anchor or drop unsupported quotes (open loop)"),
    ("app|lastvalue", "last value per slot per meeting (open loop)"),
    ("app|modevalue", "commonest value per slot per meeting (open loop)"),
    ("app|consolidate", "model consolidation, thinking off (open loop)"),
    ("app-nosys", "request without the JSON system message"),
    ("app-nosys|modevalue", "nosys + commonest value (open loop)"),
    ("app-nosys|consolidate", "nosys + model consolidation, thinking off (open loop)"),
    ("app-nosys|consolidate-think", "nosys + model consolidation, thinking on (open loop)"),
    ("app-nosys-numwords-loopstop", "nosys + numwords + loopstop (closed loop)"),
    ("app-nosys-numwords-loopstop+modevalue", "**candidate A** (closed loop)"),
]


def empty_ledger(chains):
    return sum(1 for c in chains for q in c.questions if q.gold is None or (q.type == "n_changes" and q.gold == 0))


def row(lm, chains, mechanism):
    harness.CONSOLIDATION_LOG.clear()
    scores = [harness.score_chain(c, harness.run_chain(c, lm, mechanism)) for c in chains]
    s = score.summarise(scores)
    s["model_questions"] = len(harness.CONSOLIDATION_LOG)
    s["qa_flat"] = [x for t in scores for x in t["qa_exact"]]
    return s


def main(out_path=None):
    chains = harness.load_series(harness.series_of(DEV))
    lm = LM("4b", HERE / "cache" / "4b.jsonl", offline=True)
    out = {"empty_ledger_right": empty_ledger(chains), "questions": sum(len(c.questions) for c in chains), "rows": {}}
    base = None
    print(f"empty ledger: {out['empty_ledger_right']}/{out['questions']} right\n")
    print("| configuration | QA /124 | current /43 | as of /38 | changes /43 | gold found /60 | wrong writes | inbox | correct proposals | QA after review | gen s / meeting | vs app (only / only, p) |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for mechanism, label in ROWS_4B:
        s = row(lm, chains, mechanism)
        base = base or s
        t = paired_sign_test(s["qa_flat"], base["qa_flat"])
        by = s["qa_exact_by_type"]
        print(f"| {label} | {s['qa_exact'].split('/')[0]} | {by['current'].split('/')[0]} | {by['as_of_valid'].split('/')[0]} | "
              f"{by['n_changes'].split('/')[0]} | {s['tp']} | {s['values'].get('wrong', 0)} | {s['inbox_confirm_all']['proposals']} | "
              f"{s['inbox_confirm_all']['accepted']} | {s['inbox_confirm_all']['qa_after_review'].split('/')[0]} | {s['meeting_seconds_mean']} | "
              f"{t['a_only']} / {t['b_only']}, {t['p_two_sided']:.3f} |")
        out["rows"][mechanism] = {k: v for k, v in s.items() if k != "qa_flat"} | {"vs_app": t}
    (HERE / "results" / "dev").mkdir(parents=True, exist_ok=True)
    Path(out_path or HERE / "results" / "dev" / "summary.json").write_text(json.dumps(out, indent=1, default=str) + "\n")


if __name__ == "__main__":
    main()
