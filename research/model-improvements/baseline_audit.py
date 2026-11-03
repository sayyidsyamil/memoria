"""Baseline audit (no model): what an empty record scores, measured with the real engine and scorer, against the
cached results, question by question.

    python3.11 baseline_audit.py      # prints the tables; writes results/baseline-audit.json

Empty record: the real `Pipeline` with an extractor that proposes nothing, then October's own answer functions:
`oracle.ledger_answer` with the structured question ("exact routes"), and `router.routed_answer` with the route each
cached run actually used. Cached results are read, never rewritten. The 96 questions are October's AMI test split
(ES2004, ES2014, IS1009, TS3003, TS3007); the 124 are this folder's development set (old-dev + new-dev).
"""
import json
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402
from lm import APP_SYSTEM, LM  # noqa: E402
from memoria_engine.evaluation import baselines, router as routing  # noqa: E402
from memoria_engine.evaluation.oracle import ledger_answer, values_equal  # noqa: E402
from memoria_engine.pipeline import Pipeline, make_policy  # noqa: E402

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent


class Nothing:
    name, last_stats = "empty", {}

    def extract(self, ctx):
        return []


def empty_pipeline(chain):
    pipe = Pipeline(chain.registry, Nothing(), make_policy("immediate"))
    for gm in chain.meetings:
        pipe.ingest(gm.meeting)
    return pipe


def needs_value(q):
    return not (q.gold is None or (q.type == "n_changes" and values_equal(q.gold, 0)))


def sign(a, b):
    a_only = sum(1 for x, y in zip(a, b) if x and not y)
    b_only = sum(1 for x, y in zip(a, b) if y and not x)
    n = a_only + b_only
    tail = sum(math.comb(n, i) for i in range(min(a_only, b_only) + 1)) / 2 ** n if n else 1.0
    return {"system_only": a_only, "empty_only": b_only, "both": sum(1 for x, y in zip(a, b) if x and y),
            "neither": sum(1 for x, y in zip(a, b) if not x and not y), "p_two_sided": round(min(1.0, 2 * tail), 4)}


def route_of(d):
    return routing.Route(d.get("type"), d.get("object_id"), d.get("attribute"), d.get("valid_at"), d.get("tx_at"), d.get("ok", True), d.get("reason", ""))


def table(questions, systems, empty_key):
    """questions: [(chain, q)]; systems: {name: [bool per question]} in the same order."""
    kinds = ("current", "as_of_valid", "n_changes")
    rows = {}
    for name, right in systems.items():
        r = {"all": f"{sum(right)}/{len(right)}"}
        for kind in kinds:
            idx = [i for i, (_, q) in enumerate(questions) if q.type == kind]
            r[kind] = f"{sum(right[i] for i in idx)}/{len(idx)}"
        need = [i for i, (_, q) in enumerate(questions) if needs_value(q)]
        rest = [i for i, (_, q) in enumerate(questions) if not needs_value(q)]
        r["needs_value"] = f"{sum(right[i] for i in need)}/{len(need)}"
        r["empty_answer_is_right"] = f"{sum(right[i] for i in rest)}/{len(rest)}"
        for kind, key in (("n_changes", "real_changes_right"), ("as_of_valid", "past_values_right")):
            idx = [i for i, (_, q) in enumerate(questions) if q.type == kind and needs_value(q)]
            r[key] = f"{sum(right[i] for i in idx)}/{len(idx)}"
        if name != empty_key:
            r["vs_empty"] = sign(right, systems[empty_key])
        rows[name] = r
    return rows


def counts(questions):
    out = {}
    for kind in ("current", "as_of_valid", "n_changes"):
        qs = [q for _, q in questions if q.type == kind]
        out[kind] = {"questions": len(qs), "need_a_value_or_real_change": sum(needs_value(q) for q in qs),
                     "empty_answer_is_right": sum(not needs_value(q) for q in qs)}
    out["all"] = {k: sum(v[k] for v in out.values()) for k in ("questions", "need_a_value_or_real_change", "empty_answer_is_right")}
    return out


def original96():
    oct_ = json.loads((RESEARCH / "ledger-engine/results/ami/memoria_test.json").read_text())["memoria"]["rows"]
    review = json.loads((RESEARCH / "ledger-engine/results/ami/memoria_test_review.json").read_text())["memoria"]["rows"]
    base = json.loads((RESEARCH / "ledger-engine/results/ami/baselines_test.json").read_text())["baselines"]
    ds = json.loads((RESEARCH / "strong-model/results/memoria_test.json").read_text())["memoria"]["rows"]
    ds_base = json.loads((RESEARCH / "strong-model/results/baselines_test.json").read_text())["baselines"]
    parity = [r for r in json.loads((RESEARCH / "app-parity/results-replay.json").read_text())["rows"] if r["ledger"] == "extracted facts"]
    chains = {c.chain_id: c for c in harness.load_series(harness.series_of("old-test"))}
    order = [(r["chain"], r["qid"]) for r in oct_]
    qs = {(c.chain_id, q.qid): (c, q) for c in chains.values() for q in c.questions}
    questions = [qs[k] for k in order]
    empties = {cid: empty_pipeline(c) for cid, c in chains.items()}
    exact = [values_equal(ledger_answer(empties[c.chain_id].ledger, q, c.now), q.gold) for c, q in questions]
    routed = [values_equal(routing.routed_answer(empties[r["chain"]].ledger, route_of(r["route"]), qs[(r["chain"], r["qid"])][0].now), r["gold"]) for r in oct_]

    def by_key(rows, field=None, combo=None):
        found = {(r["chain"], r["qid"]): (r[field] if field else r["answers"][combo]["correct"]) for r in rows}
        return [bool(found[k]) for k in order]
    systems = {
        "empty record, exact routes": exact,
        "empty record, October's routes": routed,
        "October ledger, Qwen3.5-4B (headline 59/96)": by_key(oct_, combo="ext+router"),
        "October ledger + perfect reviewer": by_key(review, combo="ext+router"),
        "app 0.3.0-era Ask on October's ledger (app-parity replay)": by_key(parity, field="app_correct"),
        "October full context + CoT, Qwen3.5-4B": by_key(base["full-context+cot"]["items"], field="correct"),
        "October BM25 k=12, Qwen3.5-4B": by_key(base["bm25-rag(k=12)"]["items"], field="correct"),
        "ledger, DeepSeek V4.1 Flash extractor": by_key(ds, combo="ext+router"),
        "full context + CoT, DeepSeek": by_key(ds_base["full-context+cot"]["items"], field="correct"),
        "gold facts (router only)": by_key(oct_, combo="oracle_ext+router"),
    }
    return questions, systems


def development124():
    chains = harness.load_series(harness.series_of("old-dev,new-dev"))
    questions = [(c, q) for c in chains for q in c.questions]
    lm = LM("4b", HERE / "cache" / "4b.jsonl", offline=True)
    from ask_facts import _complete_attribute
    from memoria_engine.evaluation.router import build_prompt, parse_route
    empty, empty_routed = [], []
    for c in chains:
        pipe = empty_pipeline(c)
        today = baselines.today_iso(c)
        for q in c.questions:
            empty.append(values_equal(ledger_answer(pipe.ledger, q, c.now), q.gold))
            reply = lm.app_generate(build_prompt(c.registry, today, q.ask), 1800, APP_SYSTEM)["text"]
            route = parse_route(_complete_attribute(reply, c.registry, q.ask), c.registry)
            empty_routed.append(values_equal(routing.routed_answer(pipe.ledger, route, c.now), q.gold))
    systems = {"empty record, exact routes": empty, "empty record, the 4B app router's routes": empty_routed}
    for name, mechanism in (("app path at f45bbe549 / 0.3.1 (historical)", "app"),
                            ("request without the system message (nosys)", "app-nosys"),
                            ("candidate A (rejected for default deployment)", "app-nosys-numwords-loopstop+modevalue")):
        systems[name] = [x for c in chains for x in harness.score_chain(c, harness.run_chain(c, lm, mechanism))["qa_exact"]]
    return questions, systems


def window_widths(split):
    widths = []
    for c in harness.load_series(harness.series_of(split)):
        for e in c.events:
            win = [t for t in e.tags if t.startswith("win_")]
            lo, hi = (int(x) for x in win[0][4:].split("_")) if win else (e.turn, e.turn)
            widths.append(max(hi - lo + 1, 5))  # the scorer also accepts +-2 turns
    widths.sort()
    return {"gold_events": len(widths), "median_turns_accepted": widths[len(widths) // 2], "max": widths[-1],
            "over_20_turns": sum(w > 20 for w in widths), "over_50_turns": sum(w > 50 for w in widths)}


def main(out_path=None):
    out = {}
    for label, build, empty_key in (("original96", original96, "empty record, exact routes"),
                                    ("development124", development124, "empty record, exact routes")):
        questions, systems = build()
        out[label] = {"counts": counts(questions), "systems": table(questions, systems, empty_key)}
    out["scorer_windows"] = {split: window_widths(split) for split in ("old-test", "old-dev", "new-dev")}
    (HERE / "results").mkdir(exist_ok=True)
    Path(out_path or HERE / "results" / "baseline-audit.json").write_text(json.dumps(out, indent=1) + "\n")
    for label in ("original96", "development124"):
        print(f"\n## {label}: {json.dumps(out[label]['counts'])}")
        for name, r in out[label]["systems"].items():
            vs = r.get("vs_empty")
            print(f"{name:58s} {r['all']:>7} cur {r['current']:>6} asof {r['as_of_valid']:>6} chg {r['n_changes']:>6} "
                  f"need {r['needs_value']:>6} realchg {r['real_changes_right']:>5} abst {r['empty_answer_is_right']:>6}"
                  + (f"  vs empty {vs['system_only']}/{vs['empty_only']} p={vs['p_two_sided']}" if vs else ""))
    print("\nscorer windows:", json.dumps(out["scorer_windows"]))


if __name__ == "__main__":
    main()
