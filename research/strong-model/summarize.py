"""Tables for the README: DeepSeek next to the October Qwen3.5-4B numbers, paired sign tests (October code), cost, latency,
tokens, and the questions the DeepSeek ledger still gets wrong, with the reason read from its ledger. No model is called.

    python3.11 summarize.py            # -> results/summary.md, results/summary.json
"""
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEDGER = HERE.parent / "ledger-engine"
sys.path[:0] = [str(HERE), str(LEDGER / "scripts" / "ami"), str(LEDGER)]

from memoria_engine.evaluation.metrics import paired_sign_test  # noqa: E402
from memoria_engine.evaluation.oracle import values_equal  # noqa: E402
from memoria_engine.ledger import ts  # noqa: E402
from openrouter import PRICE, CachingOpenRouter, load_cache  # noqa: E402

OCT, DS = LEDGER / "results" / "ami", HERE / "results"
TYPES = (("overall", "All"), ("current", "Current"), ("as_of_valid", "Value on a past date"), ("n_changes", "Number of changes"))
SHORT = {"current": "current", "as_of_valid": "past date", "n_changes": "changes"}
QWEN, DEEP = "Qwen3.5-4B (Oct, local)", "DeepSeek V4.1 Flash"


def load(path):
    return json.loads(path.read_text()) if path.exists() else None


def flags_memoria(report, combo="ext+router"):
    return {(r["chain"], r["qid"]): r["answers"][combo]["correct"] for r in report["memoria"]["rows"]}


def flags_baseline(report, name):
    return {(i["chain"], i["qid"]): i["correct"] for i in report["baselines"][name]["items"]}


def qa_cells(qa):
    return [f"{qa[k]['correct']}/{qa[k]['n']}" + (f" ({100 * qa[k]['accuracy']:.0f}%)" if k == "overall" else "") for k, _ in TYPES]


def sign(a, b):
    keys = sorted(set(a) & set(b))
    t = paired_sign_test([a[k] for k in keys], [b[k] for k in keys])
    p = t["p_two_sided"]
    return [t["a_only"], t["b_only"], t["both"], t["neither"], "<0.001" if p < 0.001 else f"{p:.3f}"]


def table(head, rows):
    return ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]


def records(report, cache_name):
    """The cached responses this run used, in call order (each with the cost paid when it was first made)."""
    cache = load_cache(HERE / "cache" / cache_name)
    return [dict(cache[c["key"]], tag=c["tag"]) for c in report["strong_model"]["calls"] if c["key"] in cache]


def mean(xs):
    return sum(xs) / len(xs) if xs else float("nan")


def list_price(tokens_in, tokens_out):
    return tokens_in * PRICE["input"] + tokens_out * PRICE["output"]


def secs(xs):
    return f"{statistics.median(xs):.1f} ({mean(xs):.1f})"


def cost_rows(mem, fc, bm25, oq_mem, oq_base):
    """DeepSeek: measured cost (usage.cost, with whatever the provider cache saved), list price with no cache, seconds, tokens;
    October Qwen: seconds and tokens on the M5 (no money cost)."""
    rows, out = [], {}
    oq_router = [r for r in load_cache_october() if r["prompt_head"].startswith("You turn a question")]
    oc = oq_mem["memoria"]["cost"]
    if mem:
        recs = records(mem, "test_memoria.jsonl")
        rte = [r for r in recs if not r["tag"]]
        meetings = {}
        for r in (r for r in recs if r["tag"]):
            m = meetings.setdefault(r["tag"], {"cost": 0.0, "seconds": 0.0, "in": 0, "out": 0, "windows": 0})
            m["cost"] += r["cost"]; m["seconds"] += r["seconds"]; m["in"] += r["prompt_tokens"]; m["out"] += r["output_tokens"]; m["windows"] += 1
        ms = list(meetings.values())
        per_m = {k: mean([m[k] for m in ms]) for k in ("cost", "in", "out", "windows")}
        per_q = {"cost": mean([r["cost"] for r in rte]), "in": mean([r["prompt_tokens"] for r in rte]), "out": mean([r["output_tokens"] for r in rte])}
        n_q = len(rte)
        allin = {"cost": (sum(m["cost"] for m in ms) + sum(r["cost"] for r in rte)) / n_q,
                 "in": (sum(m["in"] for m in ms) + sum(r["prompt_tokens"] for r in rte)) / n_q,
                 "out": (sum(m["out"] for m in ms) + sum(r["output_tokens"] for r in rte)) / n_q}
        out["ledger"] = {"meetings": len(ms), "questions": n_q, "per_meeting": per_m, "per_question_router": per_q, "all_in_per_question": allin,
                         "seconds_per_meeting": [m["seconds"] for m in ms], "seconds_per_question": [r["seconds"] for r in rte]}
        q_in = (oc["prompt_tokens_per_meeting"] * oc["meetings"] + sum(r["prompt_tokens"] for r in oq_router)) / len(oq_router)
        q_out = (oc["output_tokens_per_meeting"] * oc["meetings"] + sum(r["output_tokens"] for r in oq_router)) / len(oq_router)
        rows += [["Ledger: read a meeting (once, at ingestion)", "meeting", f"${per_m['cost']:.5f}", f"${list_price(per_m['in'], per_m['out']):.5f}",
                  secs([m["seconds"] for m in ms]), f"{per_m['in']:,.0f} / {per_m['out']:,.0f}", f"{oc['extract_seconds_per_meeting']:.1f} (mean)",
                  f"{oc['prompt_tokens_per_meeting']:,.0f} / {oc['output_tokens_per_meeting']:,.0f}"],
                 ["Ledger: answer (router + lookup)", "question", f"${per_q['cost']:.6f}", f"${list_price(per_q['in'], per_q['out']):.6f}",
                  secs([r["seconds"] for r in rte]), f"{per_q['in']:,.0f} / {per_q['out']:,.0f}", secs([r["seconds"] for r in oq_router]),
                  f"{mean([r['prompt_tokens'] for r in oq_router]):,.0f} / {mean([r['output_tokens'] for r in oq_router]):,.0f}"],
                 ["Ledger, all-in on this test set (20 meetings read, 96 questions)", "question", f"${allin['cost']:.5f}", f"${list_price(allin['in'], allin['out']):.5f}",
                  "-", f"{allin['in']:,.0f} / {allin['out']:,.0f}", "-", f"{q_in:,.0f} / {q_out:,.0f}"]]
    for name, rep, cache, label, oq_name in (("fc", fc, "test_fc.jsonl", "Full context + CoT", "full-context+cot"),
                                              ("bm25", bm25, "test_bm25.jsonl", "BM25 k=12", "bm25-rag(k=12)")):
        if not rep:
            continue
        recs = records(rep, cache)
        o = {"cost": mean([r["cost"] for r in recs]), "in": mean([r["prompt_tokens"] for r in recs]), "out": mean([r["output_tokens"] for r in recs]),
             "cached_in": mean([r["cached_tokens"] or 0 for r in recs]), "at_max_tokens": sum(1 for r in recs if r["finish_reason"] == "length"),
             "seconds": [r["seconds"] for r in recs], "usd_total": sum(r["cost"] for r in recs)}
        out[name] = o
        ob = oq_base["baselines"][oq_name]
        rows.append([label, "question", f"${o['cost']:.5f}", f"${list_price(o['in'], o['out']):.5f}", secs(o["seconds"]), f"{o['in']:,.0f} / {o['out']:,.0f}",
                     secs([i["seconds"] for i in ob["items"]]), f"{ob['mean_prompt_tokens']:,} / {ob['mean_output_tokens']}"])
    return rows, out


def load_cache_october():
    return list(load_cache(LEDGER / "results" / "cache" / "ami_test_memoria.jsonl").values())


def ledger_facts(cache_name):
    """Replay the DeepSeek ledger run from its cache (no model) and return each chain's pipeline and the gold one."""
    import run_ami
    from memoria_engine.evaluation.dataset import load_chains
    from memoria_engine.extractors import OracleExtractor
    from memoria_engine.windowed import WindowedExtractor
    from specs import SPECS

    llm = CachingOpenRouter(str(HERE / "cache" / cache_name), run="replay", offline=True)
    out = {}
    for chain in load_chains(str(LEDGER / "data/ami_v0")):
        if SPECS[chain.chain_id]["split"] == "test":
            out[chain.chain_id] = (chain, run_ami.run_pipeline(chain, WindowedExtractor(llm), "immediate")["pipeline"],
                                   run_ami.run_pipeline(chain, OracleExtractor(chain), "immediate")["pipeline"])
    return out


def why(row, pipes):
    """Routing, or which kind of extraction error, with the ledger's own evidence: the value timeline it holds for the slot,
    the gold decisions, and the quote behind the wrong value (for counts: every value no gold decision of that meeting supports)."""
    a = row["answers"]
    if a["ext+oracle_route"]["correct"]:
        r = row["route"]
        return "routing", f"router chose {r['type']} {r['object_id']}.{r['attribute']} valid={r['valid_at']} tx={r['tx_at']}", "", ""
    chain, pipe, _ = pipes[row["chain"]]
    q = next(x for x in chain.questions if x.qid == row["qid"])
    pred = a["ext+oracle_route"]["answer"]
    if q.type == "n_changes":
        kind = "spurious change (extra value written)" if pred > q.gold else "missed change"
    elif pred is None:
        kind = "extraction miss (no value in the ledger)"
    elif q.gold is None:
        kind = "decision recorded before it was made"
    else:
        kind = "wrong value in force"
    facts = {h["fact_id"]: h for h in pipe.ledger.history(q.object_id, q.attribute)}
    meeting = lambda fid: pipe.meeting_of_source[facts[fid]["evidence"][0]["source_id"]]  # noqa: E731
    label = lambda fid: f"{meeting(fid)}: {facts[fid]['value']} \u201c{facts[fid]['evidence'][0]['span_text'][:80]}\u201d"  # noqa: E731
    gold = [e for e in chain.events if (e.object_id, e.attribute) == (q.object_id, q.attribute)]
    pieces = pipe.ledger.timeline(q.object_id, q.attribute)
    timeline = " \u2192 ".join(f"{meeting(p.fact_id)[-1]}:{p.value}" for p in pieces) or "(empty)"
    if q.type == "n_changes":
        unsupported = [p for p in pieces if not any(e.meeting_id == meeting(p.fact_id) and values_equal(e.value, p.value) for e in gold)]
        evidence = "; ".join(label(p.fact_id) for p in unsupported[:3]) or "-"
    else:
        at = chain.now if q.type == "current" else ts(f"{q.valid_at}T00:00:00Z")
        held = pipe.ledger.as_of(q.object_id, q.attribute, valid_at=at)
        evidence = label(held.fact_id) if held else "(the gold decision was not extracted)"
    return kind, timeline, ", ".join(f"{e.meeting_id[-1]}:{e.value}" for e in gold) or "(none)", evidence


def main():
    oq_mem, oq_base = load(OCT / "memoria_test.json"), load(OCT / "baselines_test.json")
    oq_rev, oq_burden = load(OCT / "memoria_test_review.json"), load(OCT / "review_burden_test.json")
    ds_mem, ds_rev, ds_burden = load(DS / "memoria_test.json"), load(DS / "memoria_test_review.json"), load(DS / "review_burden_test.json")
    ds_fc, ds_bm = load(DS / "baselines_fc_test.json"), load(DS / "baselines_bm25_test.json")
    md, js = [], {}

    rows = [["Ledger (extract + route)", QWEN] + qa_cells(oq_mem["memoria"]["qa"]["ext+router"])]
    if ds_mem:
        rows.append(["Ledger (extract + route)", DEEP] + qa_cells(ds_mem["memoria"]["qa"]["ext+router"]))
    rows.append(["Full context + CoT", QWEN] + qa_cells(oq_base["baselines"]["full-context+cot"]["qa"]))
    if ds_fc:
        rows.append(["Full context + CoT", DEEP] + qa_cells(ds_fc["baselines"]["full-context+cot"]["qa"]))
    rows.append(["BM25 k=12", QWEN] + qa_cells(oq_base["baselines"]["bm25-rag(k=12)"]["qa"]))
    if ds_bm:
        rows.append(["BM25 k=12", DEEP] + qa_cells(ds_bm["baselines"]["bm25-rag(k=12)"]["qa"]))
    rows.append(["Ledger, gold facts (router only)", QWEN] + qa_cells(oq_mem["memoria"]["qa"]["oracle_ext+router"]))
    if ds_mem:
        rows.append(["Ledger, gold facts (router only)", DEEP] + qa_cells(ds_mem["memoria"]["qa"]["oracle_ext+router"]))
    rows.append(["Ledger + oracle reviewer (upper bound)", QWEN] + qa_cells(oq_rev["memoria"]["qa"]["ext+router"]))
    if ds_rev:
        rows.append(["Ledger + oracle reviewer (upper bound)", DEEP] + qa_cells(ds_rev["memoria"]["qa"]["ext+router"]))
    md += ["## Question answering, AMI test split (96 questions, exact match)", ""] + table(["Method", "Model"] + [t[1] for t in TYPES], rows) + [""]

    L_q = flags_memoria(oq_mem)
    tests = [("Ledger vs full context + CoT", QWEN, L_q, flags_baseline(oq_base, "full-context+cot")),
             ("Ledger vs BM25 k=12", QWEN, L_q, flags_baseline(oq_base, "bm25-rag(k=12)"))]
    if ds_mem:
        L_d = flags_memoria(ds_mem)
        if ds_fc:
            tests.append(("Ledger vs full context + CoT", DEEP, L_d, flags_baseline(ds_fc, "full-context+cot")))
        if ds_bm:
            tests.append(("Ledger vs BM25 k=12", DEEP, L_d, flags_baseline(ds_bm, "bm25-rag(k=12)")))
        tests.append(("Ledger DeepSeek vs ledger Qwen (better extractor)", "both", L_d, L_q))
        if ds_fc:
            tests.append(("Full context DeepSeek vs ledger Qwen (exploratory)", "both", flags_baseline(ds_fc, "full-context+cot"), L_q))
    md += ["## Paired exact sign test (October `paired_sign_test`, same 96 questions)", ""]
    md += table(["A vs B", "Model", "A only right", "B only right", "Both", "Neither", "p (two-sided)"], [[n, m] + sign(a, b) for n, m, a, b in tests])
    md += ["", "Exploratory: one run, 96 questions, no correction for multiple comparisons.", ""]
    js["sign_tests"] = [{"comparison": n, "model": m, "result": sign(a, b)} for n, m, a, b in tests]
    if ds_mem and ds_fc and ds_bm:
        kinds = {(r["chain"], r["qid"]): r["type"] for r in ds_mem["memoria"]["rows"]}
        rows = []
        for label, b in (("full context + CoT", flags_baseline(ds_fc, "full-context+cot")), ("BM25 k=12", flags_baseline(ds_bm, "bm25-rag(k=12)"))):
            for kind, name in TYPES[1:]:
                sub = lambda f: {k: v for k, v in f.items() if kinds[k] == kind}  # noqa: E731
                rows.append([label, name] + sign(sub(L_d), sub(b)))
        md += ["By question type, DeepSeek ledger (A) vs the DeepSeek baseline (B):", ""]
        md += table(["B", "Type", "A only right", "B only right", "Both", "Neither", "p (two-sided)"], rows) + [""]

    if ds_mem:
        ext = [(QWEN, oq_mem["memoria"]["extraction"]), (DEEP, ds_mem["memoria"]["extraction"])]
        rows = []
        for name, e in ext:
            ci = e["ci_95"]
            rows.append([name, e["gold_events"], e["tp"], e["fn"], e["fp"], f"{100 * e['precision']:.0f}% [{100 * ci['precision'][0]:.0f}-{100 * ci['precision'][1]:.0f}]",
                         f"{100 * e['recall']:.0f}% [{100 * ci['recall'][0]:.0f}-{100 * ci['recall'][1]:.0f}]", f"{100 * e['f1']:.0f}% [{100 * ci['f1'][0]:.0f}-{100 * ci['f1'][1]:.0f}]",
                         json.dumps(e["miss_reasons"]), json.dumps(e["fp_reasons"])])
        md += ["## Extraction against the 46 gold decisions (October scorer; bootstrap 95% interval over meetings)", ""]
        md += table(["Extractor", "Gold", "TP", "FN", "FP", "Precision", "Recall", "F1", "Miss reasons", "Extra reasons"], rows) + [""]
        rows = []
        for name, burden, mem in ((QWEN, oq_burden, oq_mem), (DEEP, ds_burden, ds_mem)):
            if burden:
                ledger = mem["memoria"]["ledger"]
                rows.append([name, f"{burden['proposals_per_meeting_mean']:.2f}", burden["proposals_per_meeting_max"], burden["proposals_total"],
                             json.dumps(burden["oracle_reviewer_outcomes"]), f"{ledger['state_correct']}/{ledger['state_gold']}",
                             f"TP {ledger['supersession_tp']}, FP {ledger['supersession_fp']}, FN {ledger['supersession_fn']}"])
        md += ["## Review inbox (policy confirm_conflicts, October oracle reviewer) and ledger state", ""]
        md += table(["Extractor", "Proposals per meeting (mean)", "Max in one meeting", "Total (20 meetings)", "Oracle reviewer", "Items right after last meeting (immediate)", "Supersession links (immediate)"], rows) + [""]
        r_q, r_d = oq_mem["memoria"]["router"], ds_mem["memoria"]["router"]
        md += [f"Router: exact lookup {r_d['exact']}/{r_d['n']} with DeepSeek ({r_d['failed']} unparsed) vs {r_q['exact']}/{r_q['n']} with Qwen ({r_q['failed']} unparsed).", ""]
        js["extraction"] = {n: {k: e[k] for k in ("tp", "fn", "fp", "precision", "recall", "f1", "ci_95", "miss_reasons", "fp_reasons")} for n, e in ext}
        js["router"] = {"deepseek": r_d, "qwen": r_q}

    rows, costs = cost_rows(ds_mem, ds_fc, ds_bm, oq_mem, oq_base)
    md += ["## Cost, latency and tokens (DeepSeek via OpenRouter, StreamLake endpoint; October Qwen3.5-4B on an Apple M5, no money cost)", "",
           "Measured cost = sum of `usage.cost` of the responses (prompt-cache discounts included); list price = the same tokens at "
           "$0.15 / $0.60 per million with no cache. Seconds = median (mean) wall time per unit; for a meeting, the sum of its windows.", ""]
    md += table(["Method", "Per", "DeepSeek cost (measured)", "DeepSeek cost (list, no cache)", "DeepSeek s", "DeepSeek tokens in / out",
                 "Qwen s (Oct)", "Qwen tokens in / out (Oct)"], rows) + [""]
    if ds_fc and ds_bm:
        md += [f"Provider cache: full context read {costs['fc']['cached_in']:,.0f} of {costs['fc']['in']:,.0f} input tokens per question from the cache "
               f"(the 19 questions of a team share one transcript prefix); BM25 {costs['bm25']['cached_in']:,.0f} of {costs['bm25']['in']:,.0f}. "
               f"Outputs cut at max_tokens: full context {costs['fc']['at_max_tokens']} (cap 4096), BM25 {costs['bm25']['at_max_tokens']} (cap 24).", ""]
    js["costs"] = costs

    if ds_mem:
        pipes = ledger_facts("test_memoria.jsonl")
        wrong_q = {k for k, ok in flags_memoria(oq_mem).items() if not ok}
        rows, causes = [], {}
        for row in ds_mem["memoria"]["rows"]:
            if row["answers"]["ext+router"]["correct"]:
                continue
            kind, timeline, golds, evidence = why(row, pipes)
            causes[kind] = causes.get(kind, 0) + 1
            rows.append([row["chain"], row["qid"], SHORT[row["type"]], row["gold"], row["answers"]["ext+router"]["answer"], kind,
                         "yes" if (row["chain"], row["qid"]) in wrong_q else "no", timeline, golds, evidence])
        d_wrong = {(r["chain"], r["qid"]) for r in ds_mem["memoria"]["rows"] if not r["answers"]["ext+router"]["correct"]}
        md += [f"## Where the DeepSeek ledger is still wrong ({len(rows)} of 96)", "",
               f"Causes: {json.dumps(causes)}. Of Qwen's {len(wrong_q)} wrong answers DeepSeek fixes {len(wrong_q - d_wrong)}, keeps {len(wrong_q & d_wrong)}; "
               f"it gets {len(d_wrong - wrong_q)} wrong that Qwen got right. Timeline = the values the ledger holds, by meeting letter (a-d).", ""]
        md += table(["Team", "Q", "Type", "Gold", "Ledger", "Cause", "Qwen also wrong", "Ledger timeline", "Gold decisions", "Evidence behind the wrong value"], rows) + [""]
        inexact = [r for r in ds_mem["memoria"]["rows"] if not r["route_exact"]]
        md += [f"Inexact routes: {len(inexact)}, all {json.dumps(sorted({(r['type'], r['route']['type']) for r in inexact}))} "
               f"(a past-date question read as 'what the records said on that date', valid_at = tx_at); the ledger answer is the same "
               f"in {sum(1 for r in inexact if r['answers']['ext+router']['correct'] == r['answers']['ext+oracle_route']['correct'])} of {len(inexact)}.", ""]
        js["failures"] = {"causes": causes, "fixed": sorted(wrong_q - d_wrong), "kept": sorted(wrong_q & d_wrong), "new": sorted(d_wrong - wrong_q)}
    if ds_fc:
        L_d = flags_memoria(ds_mem) if ds_mem else {}
        rows = [[i["chain"], i["qid"], SHORT[i["type"]], i["gold"], i["answer"], "yes" if L_d.get((i["chain"], i["qid"])) else "no",
                 " ".join(i["raw"].split())[-150:].replace("|", "/")]
                for i in ds_fc["baselines"]["full-context+cot"]["items"] if not i["correct"]]
        md += [f"## Where DeepSeek full context + CoT is wrong ({len(rows)} of 96), for comparison", ""]
        md += table(["Team", "Q", "Type", "Gold", "Answer", "Ledger right", "End of its reasoning"], rows) + [""]

    spend = [json.loads(line) for line in (HERE / "spend.jsonl").read_text().splitlines() if line.strip()]
    checks = [s for s in spend if s["kind"] == "key-check"]
    paid = sum(s["cost"] or 0 for s in spend)
    md += ["## Spend", "", f"Paid requests {sum(1 for s in spend if s['kind'] == 'call')}, failed attempts {sum(1 for s in spend if s['kind'] == 'failed attempt')}, "
           f"total ${paid:.4f} by the responses' own cost; last key check: usage ${checks[-1]['usage']:.4f} of ${checks[-1]['limit']}, "
           f"remaining ${checks[-1]['limit_remaining']:.4f}.", ""]
    js["spend"] = {"paid_usd": paid, "last_key_check": checks[-1]}
    (DS / "summary.md").write_text("\n".join(md))
    (DS / "summary.json").write_text(json.dumps(js, indent=1, default=str))
    print("\n".join(md))


if __name__ == "__main__":
    main()
