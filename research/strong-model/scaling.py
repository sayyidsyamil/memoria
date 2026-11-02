"""The October growth experiment with DeepSeek V4.1 Flash in place of Qwen3.5-4B.

Three synthetic test chains (hiring, portfolio, tender; 37 questions) padded with K template-written filler meetings.
`memoria_engine/evaluation/run_scaling.py` runs unchanged; only `memoria_engine.llmcache.CachingMLX` is swapped for
`CachingOpenRouter` (openrouter.py), exactly as in run.py.

    python3.11 scaling.py replay            # the current engine reproduces October's K = 0, 24, 48 from its cache (no model)
    python3.11 scaling.py estimate          # tokens and cost per K and method, from the October prompts
    python3.11 scaling.py run memoria       # ledger: DeepSeek extracts every meeting, padding included, then routes
    python3.11 scaling.py run fc            # full context + chain of thought
    python3.11 scaling.py summarize         # results/scaling_summary.md
"""
import argparse
import json
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEDGER = HERE.parent / "ledger-engine"
sys.path[:0] = [str(HERE), str(LEDGER / "scripts" / "ami"), str(LEDGER)]

import memoria_engine.llmcache as llmcache  # noqa: E402
from memoria_engine.evaluation import baselines, run_scaling, router as routing  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.evaluation.metrics import paired_sign_test  # noqa: E402
from memoria_engine.evaluation.run_eval import SPLITS  # noqa: E402
from openrouter import CAP_USD, PRICE, CachingOpenRouter, key_check, load_cache, request_body, request_key, spend_total  # noqa: E402

DATA = LEDGER / "data" / "pilot_v0"
LEVELS = (0, 24, 48)
CACHE, RESULTS = HERE / "cache", HERE / "results"
OCTOBER = {"memoria": (LEDGER / "results/cache/test_memoria.jsonl", LEDGER / "results/test/memoria_test.json"),
           "fc": (LEDGER / "results/cache/test_baselines.jsonl", LEDGER / "results/test/baselines_test.json")}
PARTS = {"memoria": dict(argv=["--part", "memoria", "--extractor", "mlx", "--router", "mlx"], cache="scaling_memoria.jsonl", out="scaling_memoria_test.json"),
         "fc": dict(argv=["--part", "baselines", "--configs", "fc+cot"], cache="scaling_fc.jsonl", out="scaling_fc_test.json")}
FC = "full-context+cot"


def chains():
    return [c for c in load_chains(str(DATA)) if c.chain_id in SPLITS["test"]]


def argv(name, levels, cache, out):
    return ["run_scaling", *PARTS[name]["argv"], "--split", "test", "--data", str(DATA), "--levels", ",".join(map(str, levels)),
            "--cache", str(cache), "--out", str(out)]


# ---- replay check and estimate (no model) ---------------------------------------------------------

def replay():
    """Run October's cached Qwen calls through today's engine and compare with the stored October results."""
    import replay_offline

    llmcache.CachingMLX = replay_offline.CacheOnly
    for name in PARTS:
        cache, stored = OCTOBER[name]
        out = Path("/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode") / f"replay_scaling_{name}.json"
        sys.argv = argv(name, LEVELS, cache, out)
        run_scaling.main()
        a, b = json.loads(stored.read_text())["levels"], json.loads(out.read_text())["levels"]
        for k in map(str, LEVELS):
            if name == "memoria":
                same = a[k]["qa"] == b[k]["qa"] and a[k]["router"]["exact"] == b[k]["router"]["exact"] and a[k]["extraction_base"] == b[k]["extraction_base"]
            else:
                same = a[k]["systems"][FC]["qa"] == b[k]["systems"][FC]["qa"]
            print(f"[replay] {name} K={k}: {'IDENTICAL to October' if same else 'DIFFERS from October'}", flush=True)


def october_calls(name, k):
    """Every request of October's Qwen run of this part at level k, rebuilt from its call cache (no model)."""
    import replay_offline

    class Recorder(replay_offline.CacheOnly):
        def __init__(self, path):
            super().__init__(path)
            self.seen = []

        def complete(self, prompt, max_tokens=None):
            out = super().complete(prompt, max_tokens)
            self.seen.append({"prompt": prompt, "max_tokens": max_tokens or self.max_tokens, "qwen_out": out["output_tokens"]})
            return out

    rec, quiet = Recorder(str(OCTOBER[name][0])), (lambda *a, **kw: None)
    if name == "memoria":
        run_scaling.memoria_level(chains(), k, "mlx", rec, routing.MLXRouter(rec), 0, quiet)
    else:
        run_scaling.baseline_level(chains(), k, [baselines.FullContext(rec, cot=True)], 0, quiet)
    return rec.seen


def common_prefix(a, b):
    n, i = min(len(a), len(b)), 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def estimate(levels=LEVELS, quiet=False):
    paid = [r for p in CACHE.glob("*.jsonl") for r in load_cache(p).values() if r.get("prompt_tokens")]
    ratio = sum(r["prompt_chars"] for r in paid) / sum(r["prompt_tokens"] for r in paid)
    rows = []
    for k in levels:
        for name in PARTS:
            have = load_cache(CACHE / PARTS[name]["cache"])
            calls = [c for c in october_calls(name, k) if request_key(request_body(c["prompt"], c["max_tokens"])) not in have]
            tin = sum(len(c["prompt"]) for c in calls) / ratio
            shared = sum(common_prefix(a["prompt"], b["prompt"]) for a, b in zip(calls, calls[1:])) / ratio
            out_exp, out_max = sum(c["qwen_out"] for c in calls), sum(c["max_tokens"] for c in calls)
            rows.append({"k": k, "part": name, "requests": len(calls), "input_tokens": round(tin), "cacheable": round(shared),
                         "out_expected": out_exp, "out_max": out_max,
                         "usd_no_cache": tin * PRICE["input"] + out_exp * PRICE["output"],
                         "usd_cache": (tin - shared) * PRICE["input"] + shared * PRICE["cached"] + out_exp * PRICE["output"],
                         "usd_worst": tin * PRICE["input"] + out_max * PRICE["output"]})
    if not quiet:
        print(f"[estimate] {ratio:.3f} characters per DeepSeek token ({len(paid)} paid requests); output = October Qwen lengths, worst = every output at max_tokens")
        print(f"{'K':>3} {'method':8} {'requests':>8} {'input tok':>10} {'cacheable':>10} {'out exp':>8} {'out max':>8} {'$ no cache':>10} {'$ cached':>9} {'$ worst':>8}")
        for r in rows:
            print(f"{r['k']:>3} {r['part']:8} {r['requests']:>8} {r['input_tokens']:>10,} {r['cacheable']:>10,} {r['out_expected']:>8,} {r['out_max']:>8,} "
                  f"{r['usd_no_cache']:>10.4f} {r['usd_cache']:>9.4f} {r['usd_worst']:>8.4f}")
        print(f"[estimate] total: ${sum(r['usd_no_cache'] for r in rows):.4f} without caching, ${sum(r['usd_cache'] for r in rows):.4f} with, "
              f"${sum(r['usd_worst'] for r in rows):.4f} worst", flush=True)
    return rows


# ---- run ------------------------------------------------------------------------------------------

def run(name, levels):
    rows = [r for r in estimate(levels) if r["part"] == name]
    before = key_check(f"before scaling {name}")
    left = CAP_USD - max(float(before["usage"] or 0.0), spend_total())
    expected = sum(r["usd_no_cache"] for r in rows)
    if expected > left:
        sys.exit(f"[estimate] NO-GO: ${expected:.4f} expected, ${left:.4f} left under the ${CAP_USD} cap")
    print(f"[estimate] GO: {name} at K={levels}: ${expected:.4f} expected without caching (worst ${sum(r['usd_worst'] for r in rows):.4f}), ${left:.4f} left", flush=True)
    made = []

    def factory(cache_path, *args, **kwargs):
        made.append(CachingOpenRouter(cache_path, run=f"scaling-{name}"))
        return made[-1]

    def sliced(level_fn, llm_of):
        def wrapper(*args, **kwargs):
            llm = llm_of(args)
            start = len(llm.calls)
            out = level_fn(*args, **kwargs)
            out["strong_model_calls"] = llm.calls[start:]
            return out
        return wrapper

    llmcache.CachingMLX = factory
    run_scaling.memoria_level = sliced(run_scaling.memoria_level, lambda a: a[3])
    run_scaling.baseline_level = sliced(run_scaling.baseline_level, lambda a: a[2][0].llm)
    sys.argv = argv(name, levels, CACHE / PARTS[name]["cache"], RESULTS / PARTS[name]["out"])
    try:
        run_scaling.main()
    finally:
        key_check(f"after scaling {name}")
        if made:
            print(f"[spend] scaling {name}: paid ${made[-1].paid:.4f} ({made[-1].misses} new requests, {made[-1].hits} from the cache)", flush=True)


# ---- summary --------------------------------------------------------------------------------------

def table(head, rows):
    return ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]


def flags(level, name):
    if name == "memoria":
        return {(r["chain"], r["qid"]): r["answers"]["ext+router"]["correct"] for r in level["rows"]}
    return {(i["chain"], i["qid"]): i["correct"] for i in level["systems"][FC]["items"]}


def sign(a, b):
    keys = sorted(set(a) & set(b))
    t = paired_sign_test([a[x] for x in keys], [b[x] for x in keys])
    return [t["a_only"], t["b_only"], t["both"], t["neither"], "<0.001" if t["p_two_sided"] < 0.001 else f"{t['p_two_sided']:.3f}"]


def acc(level, name, combo="ext+router"):
    c = level["qa"][combo]["overall"] if name == "memoria" else level["systems"][name]["qa"]["overall"]
    return f"{c['correct']} ({100 * c['accuracy']:.0f}%)"


def records(level, cache):
    data = load_cache(CACHE / cache)
    return [dict(data[c["key"]], tag=c["tag"]) for c in level["strong_model_calls"] if c["key"] in data]


def med(xs):
    return f"{statistics.median(xs):.1f}" if xs else "-"


def summarize():
    oq_m, oq_b = (json.loads(OCTOBER[p][1].read_text())["levels"] for p in ("memoria", "fc"))
    ds_m = json.loads((RESULTS / PARTS["memoria"]["out"]).read_text())["levels"]
    ds_f = json.loads((RESULTS / PARTS["fc"]["out"]).read_text())["levels"]
    ks = [str(k) for k in LEVELS if str(k) in ds_m and str(k) in ds_f]
    md = [f"## Growth experiment: synthetic test chains padded with K filler meetings (37 questions)", ""]
    shape = [["Meetings per chain (mean)", ""] + [f"{sum(s['meetings'] for s in ds_m[k]['shape'].values()) / 3:.1f}" for k in ks],
             ["Tracked items per chain (mean)", ""] + [f"{sum(s['objects'] for s in ds_m[k]['shape'].values()) / 3:.1f}" for k in ks]]
    rows = [["Ledger (extract + route)", "Qwen3.5-4B, October"] + [acc(oq_m[k], "memoria") for k in ks],
            ["Ledger (extract + route)", "DeepSeek V4.1 Flash"] + [acc(ds_m[k], "memoria") for k in ks],
            ["Ledger, gold facts (router only)", "DeepSeek V4.1 Flash"] + [acc(ds_m[k], "memoria", "oracle_ext+router") for k in ks],
            ["Full context + CoT", "Qwen3.5-4B, October"] + [acc(oq_b[k], FC) for k in ks],
            ["Full context + CoT", "DeepSeek V4.1 Flash"] + [acc(ds_f[k], FC) for k in ks],
            ["BM25 k=12 (not rerun)", "Qwen3.5-4B, October"] + [acc(oq_b[k], "bm25-rag(k=12)") for k in ks]]
    md += table(["Method", "Model"] + [f"K={k}" for k in ks], shape + rows) + [""]

    rows = []
    for k in ks:
        rows.append([k, "Ledger vs full context", "DeepSeek"] + sign(flags(ds_m[k], "memoria"), flags(ds_f[k], "fc")))
        rows.append([k, "Ledger vs full context", "Qwen, October"] + sign(flags(oq_m[k], "memoria"), flags(oq_b[k], "fc")))
    for name, label in (("memoria", "Ledger"), ("fc", "Full context")):
        for model, lv in (("DeepSeek", ds_m if name == "memoria" else ds_f), ("Qwen, October", oq_m if name == "memoria" else oq_b)):
            rows.append([f"0 vs {ks[-1]}", f"{label} at K=0 vs K={ks[-1]}", model] + sign(flags(lv[ks[0]], name), flags(lv[ks[-1]], name)))
    md += ["Paired exact sign test (October `paired_sign_test`, same 37 questions; exploratory, no correction):", ""]
    md += table(["K", "A vs B", "Model", "A only right", "B only right", "Both", "Neither", "p (two-sided)"], rows) + [""]

    types = ("current", "as_of_valid", "as_of_tx", "n_changes")
    rows = []
    for k in (ks[0], ks[-1]):
        for label, items in (("Ledger, DeepSeek", [{"type": r["type"], "correct": r["answers"]["ext+router"]["correct"]} for r in ds_m[k]["rows"]]),
                             ("Full context, DeepSeek", ds_f[k]["systems"][FC]["items"]),
                             ("Ledger, Qwen (Oct)", [{"type": r["type"], "correct": r["answers"]["ext+router"]["correct"]} for r in oq_m[k]["rows"]]),
                             ("Full context, Qwen (Oct)", oq_b[k]["systems"][FC]["items"])):
            rows.append([k, label] + [f"{sum(1 for i in items if i['type'] == t and i['correct'])}/{sum(1 for i in items if i['type'] == t)}" for t in types])
    md += ["By question type:", ""] + table(["K", "System", "Current", "Past date", "As recorded on a date", "Changes"], rows) + [""]

    rows, js = [], {}
    for k in ks:
        m_recs, f_recs = records(ds_m[k], "scaling_memoria.jsonl"), records(ds_f[k], "scaling_fc.jsonl")
        ext, rte = [r for r in m_recs if r["tag"]], [r for r in m_recs if not r["tag"]]
        n_q, n_m = len(rte), len(ext)
        price = lambda i, o: i * PRICE["input"] + o * PRICE["output"]  # noqa: E731
        led = {"ingest_usd_per_meeting": sum(r["cost"] for r in ext) / n_m, "route_usd_per_q": sum(r["cost"] for r in rte) / n_q,
               "allin_usd_per_q": (sum(r["cost"] for r in ext) + sum(r["cost"] for r in rte)) / n_q,
               "route_tokens": (sum(r["prompt_tokens"] for r in rte) / n_q, sum(r["output_tokens"] for r in rte) / n_q),
               "ingest_tokens": (sum(r["prompt_tokens"] for r in ext) / n_m, sum(r["output_tokens"] for r in ext) / n_m),
               "truncated": sum(1 for r in m_recs if r["finish_reason"] == "length")}
        fc = {"usd_per_q": sum(r["cost"] for r in f_recs) / len(f_recs), "tokens": (statistics.mean(r["prompt_tokens"] for r in f_recs), statistics.mean(r["output_tokens"] for r in f_recs)),
              "cached": statistics.mean(r["cached_tokens"] or 0 for r in f_recs), "truncated": sum(1 for r in f_recs if r["finish_reason"] == "length")}
        oq_fc = oq_b[k]["systems"][FC]
        oq_trunc = sum(1 for i in oq_fc["items"] if (i["output_tokens"] or 0) >= baselines.COT_TOKENS)
        js[k] = {"ledger": led, "fc": fc, "meetings": n_m}
        rows.append([k, "Ledger: read a meeting", f"${led['ingest_usd_per_meeting']:.5f}", f"${price(*led['ingest_tokens']):.5f}",
                     f"{led['ingest_tokens'][0]:,.0f} / {led['ingest_tokens'][1]:,.0f}", med([r["seconds"] for r in ext]),
                     f"{oq_m[k]['cost']['extract_seconds_per_meeting']:.1f} (mean)", f"{n_m} meetings read; {led['truncated']} outputs truncated"])
        rows.append([k, "Ledger: answer a question", f"${led['route_usd_per_q']:.6f}", f"${price(*led['route_tokens']):.6f}",
                     f"{led['route_tokens'][0]:,.0f} / {led['route_tokens'][1]:,.0f}", med([r["seconds"] for r in rte]),
                     f"{oq_m[k]['router']['mean_seconds']:.1f} (mean)", f"all-in ${led['allin_usd_per_q']:.5f} per question ({n_m} meetings, {n_q} questions)"])
        rows.append([k, "Full context + CoT: answer a question", f"${fc['usd_per_q']:.5f}", f"${price(*fc['tokens']):.5f}",
                     f"{fc['tokens'][0]:,.0f} / {fc['tokens'][1]:,.0f}", med([r["seconds"] for r in f_recs]),
                     f"{oq_fc['median_seconds']:.1f} (median); {oq_fc['mean_prompt_tokens']:,.0f} / {oq_fc['mean_output_tokens']:,.0f} tokens",
                     f"{fc['cached']:,.0f} input tokens per question from the provider cache; {fc['truncated']} truncated at 4096 (Qwen: {oq_trunc})"])
    md += ["Cost, tokens and latency with DeepSeek (measured = `usage.cost`, cache discounts included; list = same tokens, no cache; seconds = median wall time). Qwen column: October, Apple M5.", ""]
    md += table(["K", "Step", "DeepSeek measured", "DeepSeek list, no cache", "Tokens in / out", "DeepSeek s", "Qwen s (Oct)", "Note"], rows) + [""]
    (RESULTS / "scaling_summary.md").write_text("\n".join(md))
    (RESULTS / "scaling_summary.json").write_text(json.dumps(js, indent=1))
    print("\n".join(md))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=("replay", "estimate", "run", "summarize"))
    ap.add_argument("part", nargs="?", choices=tuple(PARTS))
    ap.add_argument("--levels", default=",".join(map(str, LEVELS)))
    a = ap.parse_args()
    levels = tuple(int(x) for x in a.levels.split(","))
    started = time.time()
    if a.command == "replay":
        replay()
    elif a.command == "estimate":
        estimate(levels)
    elif a.command == "run":
        run(a.part, levels)
    else:
        summarize()
    print(f"[{a.command}] {time.time() - started:.0f} s", flush=True)
