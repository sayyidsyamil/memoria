"""Tables for the README: Qwen3.5-9B next to October's Qwen3.5-4B and DeepSeek V4.1 Flash (../strong-model), on every split
that has a 9B run. No model is called: every number comes from the stored runs, their call caches and the run logs.

Reused, not rewritten: October's paired_sign_test and scorer outputs, strong-model's why() for the failure table, and
firmness-gate's replay.run() for the review inbox: a finished run is replayed from its cache and each meeting's candidates
are handed to a confirm_conflicts or confirm_all ledger with the perfect reviewer (open loop: a live run would have
prompted later meetings with that ledger's beliefs; "drift" counts the meetings where they differ). Where a closed-loop
review run exists (October's and DeepSeek's test runs) it is shown too, as the calibration of the open-loop measure.

    python3.11 summarize.py            # -> results/summary.md, results/summary.json
"""
import importlib.util
import json
import re
import statistics
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # a release build packages the engine folder ../ledger-engine links to: no .pyc there

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
LEDGER, STRONG, GATE = RESEARCH / "ledger-engine", RESEARCH / "strong-model", RESEARCH / "firmness-gate"
sys.path[:0] = [str(HERE), str(STRONG), str(GATE), str(LEDGER / "scripts" / "ami"), str(LEDGER)]

import replay as fg  # noqa: E402  firmness-gate/replay.py (imports run_ami_review: October's reviewer)
import replay_offline  # noqa: E402
import run as local  # noqa: E402  this folder's run.py
import run_ami  # noqa: E402
from memoria_engine.evaluation import run_eval  # noqa: E402
from memoria_engine.evaluation.metrics import paired_sign_test, wilson  # noqa: E402
from memoria_engine.extractors import OracleExtractor  # noqa: E402
from memoria_engine.windowed import WindowedExtractor  # noqa: E402
from openrouter import CachingOpenRouter, load_cache  # noqa: E402
from replay_offline import comparable  # noqa: E402

run_ami.run_pipeline = run_eval.run_pipeline  # importing run_ami_review set confirm_conflicts; this script names each policy itself
_spec = importlib.util.spec_from_file_location("strong_summarize", STRONG / "summarize.py")
strong = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(strong)  # for why(): the strong-model study's failure classifier

R = HERE / "results"
TYPES = (("overall", "All"), ("current", "Current"), ("as_of_valid", "Past date"), ("n_changes", "Changes"))
SHORT = {"current": "current", "as_of_valid": "past date", "n_changes": "changes"}
LABEL = {"qwen4b": "Qwen3.5-4B (October)", "deepseek": "DeepSeek V4.1 Flash", "qwen9b": "**Qwen3.5-9B (local)**"}
PATHS = {  # immediate run, its cache, closed-loop review run, its cache, review burden
    "qwen4b": ("results/ami/memoria_{s}.json", "results/cache/ami_{s}_memoria.jsonl", "results/ami/memoria_{s}_review.json",
               "results/cache/ami_{s}_memoria_review.jsonl", "results/ami/review_burden_{s}.json"),
    "deepseek": ("results/memoria_{s}.json", "cache/{s}_memoria.jsonl", "results/memoria_{s}_review.json", "cache/{s}_memoria_review.jsonl",
                 "results/review_burden_{s}.json"),
    "qwen9b": ("results/memoria_{s}.json", "cache/{s}_memoria.jsonl", "results/memoria_{s}_review.json", "cache/{s}_memoria_review.jsonl",
               "results/review_burden_{s}.json"),
}
ROOT = {"qwen4b": LEDGER, "deepseek": STRONG, "qwen9b": HERE}
MAKE = {"qwen4b": replay_offline.CacheOnly, "deepseek": lambda p: CachingOpenRouter(p, run="replay", offline=True),
        "qwen9b": lambda p: local.Local(p, offline=True)}
APP_WORKERS_GB = {"speech": 1.817, "embedding": 1.132}  # docs/MODEL-LIFECYCLE.md, measured simultaneous worker smoke (MLX active)


def path(name, i, split):
    return ROOT[name] / PATHS[name][i].format(s=split)


def load(p):
    return json.loads(p.read_text()) if p.exists() else None


def flags(rows, combo="ext+router"):
    return {(r["chain"], r["qid"]): r["answers"][combo]["correct"] for r in rows}


def table(head, rows):
    return ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]


def qa_cells(qa):
    out = []
    for k, _ in TYPES:
        c = qa[k]
        lo, hi = wilson(c["correct"], c["n"])
        out.append(f"{c['correct']}/{c['n']} ({100 * c['accuracy']:.0f}%, {100 * lo:.0f}–{100 * hi:.0f})" if k == "overall" else f"{c['correct']}/{c['n']}")
    return out


def sign(a, b, kinds=None, kind=None):
    keys = sorted(k for k in set(a) & set(b) if kind in (None, "overall") or kinds[k] == kind)
    t = paired_sign_test([a[k] for k in keys], [b[k] for k in keys])
    p = t["p_two_sided"]
    return {**t, "p": "<0.001" if p < 0.001 else f"{p:.3f}"}


def pct(x, ci=None):
    return "–" if x is None else f"{100 * x:.0f}%" + (f" [{100 * ci[0]:.0f}–{100 * ci[1]:.0f}]" if ci else "")


def secs(xs):
    return f"{statistics.median(xs):.1f} ({statistics.fmean(xs):.1f})" if xs else "–"


# ---- replays (no model) -------------------------------------------------------------------------------------------------

def replayed(name, split, policy, gated_policy=None):
    """firmness-gate replay.run on this model's cache: the `policy` run replayed, its candidates handed to a `gated_policy` ledger."""
    original = replay_offline.CacheOnly
    fg.CACHE[(split, policy)] = str(path(name, 1 if policy == "immediate" else 3, split))
    replay_offline.CacheOnly = MAKE[name]
    try:
        return fg.run(split, policy, gated_policy=gated_policy)
    finally:
        replay_offline.CacheOnly = original


def check_replay(name, split, policy):
    """The run replayed from its cache with nothing changed must equal the stored run."""
    stored = load(path(name, 0 if policy == "immediate" else 2, split))
    report, _ = replayed(name, split, policy)
    assert comparable(stored) == comparable(json.loads(json.dumps({"memoria": report}, default=str))), f"{name} {split} {policy}: replay differs"


def inbox(name, split, policy, gated_policy):
    report, trace = replayed(name, split, policy, gated_policy)
    per = [sum(d.status == "proposed" for d in res.dispositions) for t in trace.values() for res in t["gated"]["results"]]
    reviewer = {}
    for t in trace.values():
        for res in t["gated"]["results"]:
            for d in res.dispositions:
                if d.status == "proposed":
                    reviewer[d.review] = reviewer.get(d.review, 0) + 1
    return {"qa": report["qa"]["ext+router"], "flags": flags(report["rows"]), "total": sum(per), "per_meeting": round(sum(per) / len(per), 2),
            "max": max(per), "meetings": len(per), "reviewer": reviewer, "drift_meetings": sorted(m for t in trace.values() for m in t["drift"])}


def ledger_pipes(name, split):
    llm = MAKE[name](str(path(name, 1, split)))
    return {c.chain_id: (c, run_eval.run_pipeline(c, WindowedExtractor(llm), "immediate")["pipeline"],
                         run_eval.run_pipeline(c, OracleExtractor(c), "immediate")["pipeline"]) for c in local.chains_of(split)}


# ---- seconds, tokens, memory --------------------------------------------------------------------------------------------

def records_9b(report, split):
    cache = load_cache(path("qwen9b", 1, split))
    return [dict(cache[c["key"]], tag=c["tag"]) for c in report["local_model"]["calls"]]


def records_4b(split):
    return [{"tag": c["tag"], "max_tokens": c["max_tokens"], **c["october"]} for c in local.october_calls(split)]


def per_meeting(recs):
    out = {}
    for r in recs:
        if r["tag"]:
            m = out.setdefault(r["tag"], {"seconds": 0.0, "in": 0, "out": 0, "windows": 0, "at_cap": 0, "empty": 0})
            m["seconds"] += r["seconds"]; m["in"] += r["prompt_tokens"]; m["out"] += r["output_tokens"]; m["windows"] += 1
            m["at_cap"] += r["output_tokens"] >= r["max_tokens"]
            m["empty"] += r["output_tokens"] <= 15  # '{"events":[]}' and its formatting variants
    return out


def time_l(log):
    """Max RSS, peak memory footprint (bytes -> GB) and real seconds that /usr/bin/time -l printed into a run log."""
    text = log.read_text() if log.exists() else ""
    get = lambda label: (int(m.group(1)) / 1e9) if (m := re.search(rf"(\d+)\s+{label}", text)) else None  # noqa: E731
    real = re.search(r"([\d.]+) real", text)
    return {"max_rss_gb": get("maximum resident set size"), "peak_footprint_gb": get("peak memory footprint"), "real_s": float(real.group(1)) if real else None}


def gb(x):
    return "–" if x is None else f"{x:.2f}"


# ---- one split ----------------------------------------------------------------------------------------------------------

def section(split, md, js):
    imm = {n: load(path(n, 0, split)) for n in PATHS}
    imm = {n: r["memoria"] for n, r in imm.items() if r}
    if "qwen9b" not in imm:
        md += [f"## {split.capitalize()} split: no 9B run", "", "The 9B was not run on this split (see the README).", ""]
        js[split] = {"run": False}
        return
    models = [n for n in PATHS if n in imm]
    out = js[split] = {"models": models}
    rows0 = imm["qwen4b"]["rows"]
    n_q, n_m = len(rows0), sum(len(c.meetings) for c in local.chains_of(split))
    kinds = {(r["chain"], r["qid"]): r["type"] for r in rows0}
    for n in models:
        check_replay(n, split, "immediate")
        if path(n, 2, split).exists():
            check_replay(n, split, "confirm_conflicts")
    md += [f"## {split.capitalize()} split ({', '.join(imm['qwen4b']['extraction_by_chain'])}: {n_m} meetings, {n_q} questions, "
           f"{imm['qwen4b']['extraction']['gold_events']} gold events)", "",
           f"Every stored run below was replayed from its call cache with no model and reproduced exactly ({', '.join(LABEL[n].strip('*') for n in models)}).", ""]

    # inbox measures (no model): open loop from the immediate run, for every model; closed loop where it was run
    box = {n: {g: inbox(n, split, "immediate", g) for g in ("confirm_conflicts", "confirm_all")} for n in models}
    closed = {}
    for n in models:
        rev, bur = load(path(n, 2, split)), load(path(n, 4, split))
        if rev and bur:
            closed[n] = {"confirm_conflicts": {"qa": rev["memoria"]["qa"]["ext+router"], "per_meeting": bur["proposals_per_meeting_mean"],
                                               "total": bur["proposals_total"], "max": bur["proposals_per_meeting_max"], "reviewer": bur["oracle_reviewer_outcomes"]},
                         "confirm_all": inbox(n, split, "confirm_conflicts", "confirm_all")}

    # question answering
    rows = []
    for title, get in (("Ledger (extract + route)", lambda n: imm[n]["qa"]["ext+router"]),
                       ("Ledger, gold facts (router only)", lambda n: imm[n]["qa"]["oracle_ext+router"]),
                       ("Perfect reviewer, confirm_conflicts (open loop)", lambda n: box[n]["confirm_conflicts"]["qa"]),
                       ("Perfect reviewer, confirm_all (open loop)", lambda n: box[n]["confirm_all"]["qa"]),
                       ("Perfect reviewer, confirm_conflicts (closed loop, as run)", lambda n: closed[n]["confirm_conflicts"]["qa"] if n in closed else None),
                       ("Perfect reviewer, confirm_all (firmness-gate method)", lambda n: closed[n]["confirm_all"]["qa"] if n in closed else None)):
        rows += [[title, LABEL[n]] + qa_cells(get(n)) for n in models if get(n)]
    md += ["### Question answering (exact match; Wilson 95% on All)", ""] + table(["Method", "Model", *[t[1] for t in TYPES]], rows) + [""]
    out["qa"] = {n: {"immediate": imm[n]["qa"]["ext+router"], "gold_facts": imm[n]["qa"]["oracle_ext+router"]} for n in models}

    # sign tests
    F = {n: flags(imm[n]["rows"]) for n in models}
    pairs = [("qwen9b", "qwen4b")] + ([("qwen9b", "deepseek"), ("deepseek", "qwen4b")] if "deepseek" in models else [])
    rows, tests = [], []
    for a, b in pairs:
        for kind, kname in TYPES:
            t = sign(F[a], F[b], kinds, kind)
            rows.append([f"{LABEL[a]} vs {LABEL[b]}", kname, t["a_only"], t["b_only"], t["both"], t["neither"], t["p"]])
            tests.append({"a": a, "b": b, "type": kind, **t})
    for g in ("confirm_conflicts", "confirm_all"):
        t = sign(box["qwen9b"][g]["flags"], box["qwen4b"][g]["flags"])
        rows.append([f"Perfect reviewer, {g} (open loop): 9B vs 4B", "All", t["a_only"], t["b_only"], t["both"], t["neither"], t["p"]])
        tests.append({"a": f"qwen9b+{g}", "b": f"qwen4b+{g}", "type": "overall", **t})
    md += ["### Paired exact sign test (October `paired_sign_test`, two-sided; exploratory, no correction)", ""]
    md += table(["A vs B", "Type", "A only right", "B only right", "Both", "Neither", "p"], rows) + [""]
    out["sign_tests"] = tests

    # extraction
    rows = []
    for n in models:
        e, L = imm[n]["extraction"], imm[n]["ledger"]
        ci = e["ci_95"]
        rows.append([LABEL[n], e["tp"], e["fn"], e["fp"], f"{(e['tp'] + e['fp']) / n_m:.2f}", pct(e["precision"], ci["precision"]), pct(e["recall"], ci["recall"]),
                     pct(e["f1"], ci["f1"]), f"{L['state_correct']}/{L['state_gold']}", json.dumps(e["miss_reasons"]), json.dumps(e["fp_reasons"])])
    md += [f"### Extraction against the {imm['qwen4b']['extraction']['gold_events']} gold decisions (October scorer; bootstrap 95% over meetings)", ""]
    md += table(["Extractor", "TP", "FN", "FP", "Written per meeting", "Precision", "Recall", "F1", "Items right after last meeting", "Miss reasons", "Extra reasons"], rows) + [""]
    router = ", ".join(f"{LABEL[n]} {imm[n]['router']['exact']}/{imm[n]['router']['n']} ({imm[n]['router']['failed']} unparsed)" for n in models)
    md += [f"Router, exact lookup: {router}.", ""]
    out["extraction"] = {n: {k: imm[n]["extraction"][k] for k in ("tp", "fn", "fp", "precision", "recall", "f1", "ci_95", "miss_reasons", "fp_reasons")} for n in models}

    # inbox
    rows = []
    for n in models:
        for g in ("confirm_conflicts", "confirm_all"):
            b = box[n][g]
            rows.append([LABEL[n], g, "open loop (immediate run's candidates)", f"{b['per_meeting']:.2f}", b["total"], b["max"], json.dumps(b["reviewer"]),
                         f"{b['qa']['overall']['correct']}/{n_q}", len(b["drift_meetings"])])
            if n in closed:
                c = closed[n][g]
                how = "closed loop (October review run)" if g == "confirm_conflicts" else "firmness gate (review run's candidates)"
                rows.append([LABEL[n], g, how, f"{c['per_meeting']:.2f}", c["total"], c["max"], json.dumps(c["reviewer"]), f"{c['qa']['overall']['correct']}/{n_q}",
                             len(c.get("drift_meetings", [])) if g == "confirm_all" else "–"])
    md += [f"### Review inbox: suggestions a perfect reviewer decides ({n_m} meetings)", ""]
    md += table(["Extractor", "Policy", "Measured as", "Per meeting", "Total", "Max", "Reviewer", "QA", "Drift meetings"], rows) + [""]
    out["inbox"] = {n: {"open_loop": {g: {k: v for k, v in box[n][g].items() if k != "flags"} for g in box[n]},
                        "closed": {g: {k: v for k, v in c.items() if k != "flags"} for g, c in closed.get(n, {}).items()}} for n in models}

    cost(split, md, out, imm)
    failures(split, md, out, imm, models)


def cost(split, md, out, imm):
    rep9 = load(path("qwen9b", 0, split))
    r9, r4 = records_9b(rep9, split), records_4b(split)
    m9, m4 = per_meeting(r9), per_meeting(r4)
    q9, q4 = [r for r in r9 if not r["tag"]], [r for r in r4 if not r["tag"]]
    first = sorted(t for t in m9 if t.endswith("a"))
    w9 = [r for r in r9 if r["tag"] in first]
    w4 = [r for r in r4 if r["tag"] in first]
    rows = [[f"Extraction, s per meeting ({len(m9)} meetings)", secs([m["seconds"] for m in m4.values()]), secs([m["seconds"] for m in m9.values()]),
             f"{sum(m['seconds'] for m in m9.values()) / sum(m['seconds'] for m in m4.values()):.2f}"],
            [f"Same prompts: first-meeting windows ({len(w9)}), s per window", secs([r["seconds"] for r in w4]), secs([r["seconds"] for r in w9]),
             f"{sum(r['seconds'] for r in w9) / sum(r['seconds'] for r in w4):.2f}"],
            [f"Same prompts: routing, s per question ({len(q9)})", secs([r["seconds"] for r in q4]), secs([r["seconds"] for r in q9]),
             f"{sum(r['seconds'] for r in q9) / sum(r['seconds'] for r in q4):.2f}"],
            ["Extraction tokens in / out per meeting", f"{statistics.fmean(m['in'] for m in m4.values()):,.0f} / {statistics.fmean(m['out'] for m in m4.values()):,.0f}",
             f"{statistics.fmean(m['in'] for m in m9.values()):,.0f} / {statistics.fmean(m['out'] for m in m9.values()):,.0f}", ""],
            ["Windows with no event / at the 900-token cap", f"{sum(m['empty'] for m in m4.values())} / {sum(m['at_cap'] for m in m4.values())} of {sum(m['windows'] for m in m4.values())}",
             f"{sum(m['empty'] for m in m9.values())} / {sum(m['at_cap'] for m in m9.values())} of {sum(m['windows'] for m in m9.values())}", ""],
            ["Routing tokens in / out per question", f"{statistics.fmean(r['prompt_tokens'] for r in q4):,.0f} / {statistics.fmean(r['output_tokens'] for r in q4):,.0f}",
             f"{statistics.fmean(r['prompt_tokens'] for r in q9):,.0f} / {statistics.fmean(r['output_tokens'] for r in q9):,.0f}", ""],
            ["Run wall clock, s (`run_ami` timer, ledger run of this split)", load(local.OCTOBER / f"ami/memoria_{split}.json")["wall_seconds"], rep9["wall_seconds"],
             f"{rep9['wall_seconds'] / load(local.OCTOBER / f'ami/memoria_{split}.json')['wall_seconds']:.2f}"]]
    md += [f"### Seconds on this Mac (Apple M5, 16 GB; other apps open)", "",
           "Generation time (`MLXExtractor.complete`: prefill + decode), median (mean); a meeting is the sum of its windows. The 4B column is as "
           "recorded in October. First-meeting windows and router prompts are byte-identical for both models (nothing is believed before the "
           "first meeting; the router prompt never depends on the ledger).", ""]
    md += table(["", "4B (October)", "9B (today)", "9B / 4B"], rows) + [""]
    lm, chk = rep9["local_model"], load(R / "check_4b.json")
    t9, t4 = time_l(HERE / f"logs/{split}.log"), time_l(HERE / "logs/check_4b.log")
    peak9 = max(r["peak_gb"] for r in r9 if r.get("peak_gb"))
    app = sum(APP_WORKERS_GB.values())
    rows = [["Weights in memory (MLX active after load)", gb(chk["weights_gb"]), gb(lm["weights_gb"])],
            ["MLX peak while generating (max over calls)", gb(chk["mlx_peak_gb"]), gb(peak9)],
            ["Process peak memory footprint (`/usr/bin/time -l`)", gb(t4["peak_footprint_gb"]), gb(t9["peak_footprint_gb"])],
            ["Process max RSS (`/usr/bin/time -l`; misses most GPU memory)", gb(t4["max_rss_gb"]), gb(t9["max_rss_gb"])],
            [f"With the app's speech and embedding workers ({APP_WORKERS_GB['speech']} + {APP_WORKERS_GB['embedding']} GB): weights", gb(chk["weights_gb"] + app), gb(lm["weights_gb"] + app)],
            ["… at the language model's MLX peak", gb(chk["mlx_peak_gb"] + app), gb(peak9 + app)],
            ["… with the language model's process footprint", gb(t4["peak_footprint_gb"] + app), gb(t9["peak_footprint_gb"] + app)]]
    md += ["### Memory, GB (4B: `run.py check-4b` on October's test prompts; 9B: this split's run)", ""]
    md += table(["", "4B", "9B"], rows) + [""]
    out["cost"] = {"extract_s_per_meeting_9b": {t: round(m["seconds"], 1) for t, m in m9.items()},
                   "extract_s_per_meeting_4b": {t: round(m["seconds"], 1) for t, m in m4.items()},
                   "router_s_9b": [round(r["seconds"], 2) for r in q9], "router_s_4b": [round(r["seconds"], 2) for r in q4],
                   "memory": {"4b": {"weights_gb": chk["weights_gb"], "mlx_peak_gb": chk["mlx_peak_gb"], **t4},
                              "9b": {"weights_gb": lm["weights_gb"], "mlx_peak_gb": peak9, **t9}, "app_workers_gb": APP_WORKERS_GB}}


def failures(split, md, out, imm, models):
    pipes = ledger_pipes("qwen9b", split)
    F = {n: flags(imm[n]["rows"]) for n in models}
    rows, causes = [], {}
    for row in imm["qwen9b"]["rows"]:
        key = (row["chain"], row["qid"])
        if row["answers"]["ext+router"]["correct"]:
            continue
        kind, timeline, golds, evidence = strong.why(row, pipes)
        causes[kind] = causes.get(kind, 0) + 1
        rows.append([row["chain"], row["qid"], SHORT[row["type"]], row["gold"], row["answers"]["ext+router"]["answer"], kind,
                     "**right**" if F["qwen4b"][key] else "wrong"] + (["**right**" if F["deepseek"][key] else "wrong"] if "deepseek" in F else [])
                    + [timeline, golds, evidence.replace("|", "/")])
    w9 = {k for k, ok in F["qwen9b"].items() if not ok}
    w4 = {k for k, ok in F["qwen4b"].items() if not ok}
    md += [f"### Where the 9B ledger is wrong ({len(rows)} of {len(F['qwen9b'])})", "",
           f"Causes: {json.dumps(causes)}. Of the 4B's {len(w4)} wrong answers the 9B fixes {len(w4 - w9)} and keeps {len(w4 & w9)}; "
           f"it gets {len(w9 - w4)} wrong that the 4B got right. Timeline = the values the 9B ledger holds, by meeting letter.", ""]
    md += table(["Team", "Q", "Type", "Gold", "9B", "Cause", "4B"] + (["DeepSeek"] if "deepseek" in F else [])
                + ["9B timeline", "Gold decisions", "Evidence behind the wrong value"], rows) + [""]
    fixed = []
    pipes4 = ledger_pipes("qwen4b", split)
    for row in imm["qwen4b"]["rows"]:
        if (row["chain"], row["qid"]) in w4 - w9:
            kind, timeline, golds, evidence = strong.why(row, pipes4)
            fixed.append([row["chain"], row["qid"], SHORT[row["type"]], row["gold"], row["answers"]["ext+router"]["answer"], kind, timeline, evidence.replace("|", "/")])
    md += [f"The 4B's errors the 9B fixes ({len(fixed)}):", ""]
    md += table(["Team", "Q", "Type", "Gold", "4B", "4B cause", "4B timeline", "4B evidence"], fixed) + [""]
    inexact = [r for r in imm["qwen9b"]["rows"] if not r["route_exact"]]
    md += [f"Inexact 9B routes: {len(inexact)} ({json.dumps(sorted({(r['type'], r['route']['type']) for r in inexact}))}); the answer is the same as "
           f"with the exact route in {sum(1 for r in inexact if r['answers']['ext+router']['correct'] == r['answers']['ext+oracle_route']['correct'])} of them.", ""]
    out["failures"] = {"causes": causes, "fixed_vs_4b": sorted(w4 - w9), "new_vs_4b": sorted(w9 - w4), "rows": rows, "fixed_rows": fixed}


def main():
    md, js = ["# Qwen3.5-9B (local) in the October ledger pipeline: summary", "",
              "Generated by `summarize.py` from the stored runs, their call caches and the run logs; no model is called.", ""], {}
    chk = load(R / "check_4b.json")
    if chk:
        md += [f"Runtime check (`run.py check-4b`): today's Qwen3.5-4B at `{chk['revision'][:7]}` with mlx {chk['runtime']['mlx']} / mlx-lm "
               f"{chk['runtime']['mlx-lm']} reproduced {chk['identical']}/{chk['n']} October replies exactly (14 first-meeting windows and 96 routes "
               f"of the test split).", ""]
    for split in ("dev", "test"):
        section(split, md, js)
    (R / "summary.md").write_text("\n".join(md) + "\n")
    (R / "summary.json").write_text(json.dumps(js, indent=1, default=str))
    print("\n".join(md))


if __name__ == "__main__":
    main()
