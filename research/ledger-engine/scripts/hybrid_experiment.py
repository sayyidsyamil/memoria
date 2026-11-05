"""Frozen, resumable hybrid-RAG comparison and one-factor sensitivity analysis.

Run prepare (CPU embeddings), then run (MLX generation) as separate processes.
The original evaluated files and results are never modified. See HYBRID_RAG.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import statistics
import time
from dataclasses import asdict
from pathlib import Path

from memoria_engine.evaluation import baselines, metrics, padding
from memoria_engine.evaluation.dataset import load_chains
from scripts.hybrid_rag import BGEEncoder, HybridRAG, RetrievalConfig
from memoria_engine.evaluation.run_eval import SPLITS

ENGINE = Path(__file__).resolve().parents[1]
AMI_SPLITS = {"dev": ("ES2003", "TS3004"), "test": ("ES2004", "ES2014", "IS1009", "TS3003", "TS3007")}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    scratch = path.with_suffix(path.suffix + ".tmp")
    scratch.write_text(json.dumps(data, indent=1, allow_nan=False), encoding="utf-8")
    scratch.replace(path)


def sensitivity_configs():
    """Fixed OAT design, not an exhaustive search. Endpoints are real ablations."""
    centre = asdict(RetrievalConfig())
    configs = [RetrievalConfig()]
    for key, values in (("k", (4, 8, 24)), ("window", (1, 6)),
                        ("alpha", (0.0, 0.25, 0.75, 1.0)), ("rrf", (10, 100))):
        configs.extend(RetrievalConfig(**{**centre, key: value}) for value in values)
    return configs


def evidence_coverage(chain, q, selected):
    """Post-retrieval diagnostic only; not a selector or an answer correctness proxy.

    Fraction of annotated decisions for the queried slot whose evidence appears in
    the excerpts. Initials AND changes count. None when there is no eligible event.
    AMI gold is incomplete, and its linked windows are often broad.
    """
    from memoria_engine.ledger import ts

    eligible = {mid for mid, _, _ in baselines.transcripts_before(chain, q, "held")}
    events = [e for e in chain.events if e.meeting_id in eligible and e.object_id == q.object_id and e.attribute == q.attribute]
    if q.type in ("as_of_valid", "as_of_tx"):
        meetings = {gm.meeting.meeting_id: gm.meeting for gm in chain.meetings}
        events = [e for e in events if (ts(e.valid_from) if e.valid_from else meetings[e.meeting_id].occurred_at) <= ts(q.valid_at)]
    context = "\n".join(text for _, text in selected)
    found = sum(e.quote in context for e in events)
    return {"found": found, "total": len(events), "coverage": found / len(events) if events else None}


def prepare(args):
    root = Path(args.out)
    if (root / "plan.json").exists():
        raise ValueError("plan already exists: use a new --out directory; frozen plans are not overwritten")
    data = Path(args.data)
    ids = (AMI_SPLITS if args.dataset == "ami" else SPLITS)[args.split]
    chains = [c for c in load_chains(str(data)) if c.chain_id in ids]
    if not chains:
        raise ValueError("no matching chains")
    selection = None
    if args.selection:
        selection_path = Path(args.selection)
        selection = json.loads(selection_path.read_text())
        if selection.get("split") != "dev" or selection.get("dataset") != args.dataset:
            raise ValueError("selection must come from the same dataset's development split")
        dev_path = selection_path.parent / "answers.json"
        if not dev_path.exists() or digest(dev_path) != selection["answers_sha256"]:
            raise ValueError("development answers missing or changed since selection")
        if selection.get("cot") != args.cot or selection.get("model") != args.model:
            raise ValueError("selection model/decoding differs from requested test settings")
        configs = [RetrievalConfig(**selection["config"])]
    elif args.split == "test":
        raise ValueError("test requires --selection from a completed development run")
    else:
        configs = sensitivity_configs()
    levels = [int(x) for x in args.levels.split(",")]
    if not levels or len(set(levels)) != len(levels) or any(x < 0 for x in levels):
        raise ValueError("levels must be distinct nonnegative padding counts")
    if args.dataset == "ami" and levels != [0]:
        raise ValueError("AMI uses real histories only; use --dataset synthetic for padding sensitivity")
    paths = sorted(data.glob("*.chain")) + sorted(data.glob("*.ask"))
    code = [Path(__file__), Path(__file__).with_name("hybrid_rag.py"), Path(baselines.__file__),
            Path(padding.__file__), Path(baselines.__file__).with_name("dataset.py"), Path(metrics.__file__),
            ENGINE / "memoria_engine/llmcache.py", ENGINE / "memoria_engine/extractors.py"]
    manifest = {str(p.resolve()): digest(p) for p in paths + code}
    encoder = BGEEncoder(Path(args.embeddings), local_only=not args.allow_download)
    cases = []
    for level in levels:
        for chain in chains:
            padded = padding.pad_chain(chain, level, 0) if level else chain
            for config in configs:
                system = HybridRAG(None, encoder, config, cot=args.cot)
                for q in chain.questions:
                    prompt = system.prompt(padded, q)
                    retrieval = dict(system.last_retrieval)
                    selected = [(r["source"], r["text"]) for r in retrieval["selected"]]
                    cases.append({"id": f"{level}/{config.name}/{chain.chain_id}/{q.qid}", "level": level,
                                  "config": config.name, "chain": chain.chain_id, "qid": q.qid, "type": q.type,
                                  "question": q.ask, "gold": q.gold, "prompt": prompt,
                                  "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
                                  "retrieval": retrieval, "evidence": evidence_coverage(padded, q, selected)})
                print(f"prepared K={level} {config.name} {chain.chain_id}", flush=True)
    # Write the immutable plan last, so a failed embedding pass can be restarted.
    save(root / "cases.json", cases)
    plan = {"version": 1, "dataset": args.dataset, "data": str(data.resolve()), "split": args.split,
            "levels": levels, "chains": [c.chain_id for c in chains], "configs": [asdict(c) for c in configs],
            "cases": len(cases), "questions_per_condition": sum(len(c.questions) for c in chains),
            "cot": args.cot, "max_tokens": baselines.COT_TOKENS if args.cot else 24, "model": args.model,
            "encoder": encoder.identity, "manifest": manifest, "cases_sha256": digest(root / "cases.json"),
            "selection": selection, "created": time.strftime("%Y-%m-%d %H:%M:%S"),
            "design": "one-factor-at-a-time around k12/window3/alpha0.5/rrf60; no interaction estimates",
            "selection_rule": "highest dev exact-match accuracy at K=0, then lowest mean prompt tokens, then name",
            "status": "exploratory extension: previous AMI test results were already inspected"}
    save(root / "plan.json", plan)
    print(f"Frozen {len(cases)} cases -> {root}/plan.json", flush=True)


def read_plan(root):
    root = Path(root)
    plan = json.loads((root / "plan.json").read_text())
    if digest(root / "cases.json") != plan["cases_sha256"]:
        raise ValueError("frozen cases changed")
    for path, expected in plan["manifest"].items():
        if digest(path) != expected:
            raise ValueError(f"frozen code/data changed: {path}; prepare a new run directory")
    return plan, json.loads((root / "cases.json").read_text())


def run(args):
    from memoria_engine.llmcache import CachingMLX

    root = Path(args.out)
    plan, cases = read_plan(root)
    path = root / "answers.json"
    existing = json.loads(path.read_text()) if path.exists() else {}
    if existing and existing["plan_sha256"] != digest(root / "plan.json"):
        raise ValueError("answers refer to a different plan")
    rows = {r["id"]: r for r in existing.get("rows", [])}
    chains = {c.chain_id: c for c in load_chains(plan["data"])}
    llm = CachingMLX(str(root / "generation_cache.jsonl"), model_id=plan["model"])
    count = 0
    for case in cases:
        if case["id"] in rows:
            continue
        chain = chains[case["chain"]]
        q = next(q for q in chain.questions if q.qid == case["qid"])
        result = llm.complete(case["prompt"], max_tokens=plan["max_tokens"])
        item = baselines.score_item(chain, q, result["text"], cot=plan["cot"])
        item.update({k: case[k] for k in ("id", "level", "config", "prompt_sha256", "evidence")})
        item.update(question=q.ask, seconds=result["seconds"], prompt_tokens=result["prompt_tokens"],
                    output_tokens=result["output_tokens"], cached=result["cached"])
        rows[case["id"]] = item
        save(path, {"plan_sha256": digest(root / "plan.json"), "complete": len(rows) == len(cases),
                    "rows": list(rows.values()), "cache_hits": llm.hits, "cache_misses": llm.misses})
        count += 1
        if count % 10 == 0:
            print(f"{len(rows)}/{len(cases)} answers; latest {case['id']}", flush=True)
        if args.limit and count >= args.limit:
            break
    print(f"Saved {len(rows)}/{len(cases)} answers -> {path}", flush=True)


def cluster_difference(a, b, draws=2000):
    """Paired difference (a-b), resampling complete meeting series, not questions."""
    if set(a) != set(b) or not a:
        raise ValueError("paired results must have identical nonempty (chain, qid) keys")
    groups = sorted({key[0] for key in a})
    delta = {g: [int(a[k]) - int(b[k]) for k in sorted(a) if k[0] == g] for g in groups}
    randomizer = random.Random(0)
    samples = []
    for _ in range(draws):
        values = [v for _ in groups for v in delta[randomizer.choice(groups)]]
        samples.append(sum(values) / len(values))
    samples.sort()
    return {"delta": sum(int(a[k]) - int(b[k]) for k in a) / len(a),
            "ci_95": [samples[int(0.025 * draws)], samples[int(0.975 * draws) - 1]], "clusters": len(groups),
            "note": "exploratory; only five test teams (two on dev); intervals are unstable at small cluster counts"}


def summarize(args):
    root = Path(args.out)
    plan, cases = read_plan(root)
    answers = json.loads((root / "answers.json").read_text())
    if answers["plan_sha256"] != digest(root / "plan.json"):
        raise ValueError("answers refer to a different plan")
    expected = {c["id"]: c for c in cases}
    rows = answers["rows"]
    if len({r["id"] for r in rows}) != len(rows) or any(r["id"] not in expected for r in rows):
        raise ValueError("duplicate or unexpected answers")
    complete = len(rows) == len(cases)
    if args.select and (plan["split"] != "dev" or not complete):
        raise ValueError("selection requires a complete development run")
    configs = {RetrievalConfig(**c).name: c for c in plan["configs"]}
    groups = {}
    for level in plan["levels"]:
        for name in configs:
            subset = [r for r in rows if r["level"] == level and r["config"] == name]
            if not subset:
                continue
            groups[f"{level}/{name}"] = {"level": level, "config": name, "qa": metrics.score_answers(subset),
                "median_generation_seconds": statistics.median(r["seconds"] for r in subset),
                "mean_prompt_tokens": statistics.mean(r["prompt_tokens"] for r in subset),
                "evidence_found": sum(r["evidence"]["found"] for r in subset),
                "evidence_total": sum(r["evidence"]["total"] for r in subset)}
    sensitivity = []
    centre = asdict(RetrievalConfig())
    for level in plan["levels"]:
        reference = [r for r in rows if r["level"] == level and r["config"] == RetrievalConfig().name]
        if not reference:
            continue
        base = {(r["chain"], r["qid"]): r["correct"] for r in reference}
        for name, cfg in configs.items():
            changed = [key for key in cfg if cfg[key] != centre[key]]
            variant = [r for r in rows if r["level"] == level and r["config"] == name]
            current = {(r["chain"], r["qid"]): r["correct"] for r in variant}
            if len(changed) != 1 or set(current) != set(base):
                continue
            key = changed[0]
            paired = cluster_difference(current, base)
            sensitivity.append({"level": level, "parameter": key, "value": cfg[key], "reference": centre[key],
                                "delta_accuracy_pp": 100 * paired["delta"], "paired_cluster": paired,
                                "pp_per_unit": 100 * paired["delta"] / (cfg[key] - centre[key])})
    comparisons = []
    if args.memoria:
        stored = json.loads(Path(args.memoria).read_text())
        memoria = stored.get("memoria", stored)
        ledger = {(r["chain"], r["qid"]): r for r in memoria["rows"]}
        for group in groups.values():
            if group["level"] != 0:
                continue
            subset = [r for r in rows if r["level"] == 0 and r["config"] == group["config"]]
            keys = {(r["chain"], r["qid"]) for r in subset}
            if keys != set(ledger):
                raise ValueError("Memoria comparison must have exactly the same questions")
            if any(r["gold"] != ledger[(r["chain"], r["qid"])]["gold"] for r in subset):
                raise ValueError("Memoria gold answers differ")
            a = {(r["chain"], r["qid"]): r["correct"] for r in subset}
            b = {key: ledger[key]["answers"]["ext+router"]["correct"] for key in keys}
            comparisons.append({"config": group["config"], "hybrid_minus_memoria": cluster_difference(a, b),
                                "question_sign_test_exploratory": metrics.paired_sign_test([a[k] for k in sorted(a)], [b[k] for k in sorted(a)])})
    result = {"complete": complete, "conditions": groups, "sensitivity": sensitivity, "comparisons": comparisons}
    save(root / "summary.json", result)
    lines = ["# Hybrid RAG comparison and sensitivity", "", f"Split: {plan['split']}; complete: {complete}; {len(rows)}/{len(cases)} answers.",
             "", "Dense BGE + BM25, weighted reciprocal-rank fusion, actual Qwen generation; same v3 prompt and parser as the baseline.",
             "", "| Padding | Configuration | Correct / n | Accuracy | Median generation s | Mean prompt tokens | Annotated evidence found / total |",
             "|---|---|---:|---:|---:|---:|---:|"]
    for group in groups.values():
        qa = group["qa"]["overall"]
        lines.append(f"| {group['level']} | {group['config']} | {qa['correct']}/{qa['n']} | {qa['accuracy']:.1%} | {group['median_generation_seconds']:.2f} | {group['mean_prompt_tokens']:.0f} | {group['evidence_found']}/{group['evidence_total']} |")
    lines += ["", "## Local sensitivity model", "", "One factor at a time; differences from the centre configuration. Finite-difference slopes are descriptive, not a predictive model or interaction estimate.",
              "", "| Padding | Parameter | Value | Delta accuracy (percentage points) | pp per parameter unit |", "|---|---|---:|---:|---:|"]
    for s in sensitivity:
        lines.append(f"| {s['level']} | {s['parameter']} | {s['value']} | {s['delta_accuracy_pp']:+.2f} | {s['pp_per_unit']:+.3f} |")
    for c in comparisons:
        diff = c["hybrid_minus_memoria"]
        lines += ["", f"**{c['config']} minus Memoria:** {100 * diff['delta']:+.2f} pp; series-bootstrap interval [{100 * diff['ci_95'][0]:+.2f}, {100 * diff['ci_95'][1]:+.2f}] pp ({diff['clusters']} teams)."]
    lines += ["", "## Interpretation limits", "", "- Dev results tune the baseline; they are not held-out findings. Test results are an exploratory extension because the earlier test set was already inspected.",
              "- Only two dev and five test teams: confidence intervals and question-level p-values need caution; questions within a team are dependent.",
              "- Generation times come from cached original calls. Offline preparation/indexing/embedding time is excluded; these are not end-to-end live RAG latencies.",
              "- Evidence coverage is a diagnostic on incomplete gold events, not answer correctness; no eligible evidence is not a retrieval failure.",
              "- The OAT design cannot estimate interactions. Padding, if requested on synthetic chains, measures template distractors rather than additional real meetings.",
              "- Report per-question-type accuracy from summary.json: pooled accuracy can hide the easy all-none AMI past-date questions."]
    (root / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if args.select:
        eligible = [g for g in groups.values() if g["level"] == 0]
        if not eligible:
            raise ValueError("selection needs level zero")
        winner = min(eligible, key=lambda g: (-g["qa"]["overall"]["accuracy"], g["mean_prompt_tokens"], g["config"]))
        save(root / "selection.json", {"dataset": plan["dataset"], "split": "dev", "config": configs[winner["config"]],
                                      "cot": plan["cot"], "model": plan["model"], "answers_sha256": digest(root / "answers.json"),
                                      "rule": plan["selection_rule"]})
        print(f"Development-selected configuration: {winner['config']}")
    print("\n".join(lines))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="action", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--data", default="data/ami_v0")
    prep.add_argument("--dataset", choices=("ami", "synthetic"), default="ami")
    prep.add_argument("--split", choices=("dev", "test"), required=True)
    prep.add_argument("--levels", default="0")
    prep.add_argument("--embeddings", default="results/hybrid_embeddings")
    prep.add_argument("--selection")
    prep.add_argument("--allow-download", action="store_true")
    prep.add_argument("--cot", action="store_true")
    prep.add_argument("--model", default="mlx-community/Qwen3.5-4B-MLX-4bit")
    gen = sub.add_parser("run")
    gen.add_argument("--limit", type=int, default=0, help="debug budget; a partial run cannot select a test configuration")
    report = sub.add_parser("report")
    report.add_argument("--select", action="store_true")
    report.add_argument("--memoria", help="matching stored run_ami.py results (level zero only)")
    for parser in (prep, gen, report):
        parser.add_argument("--out", required=True)
    args = ap.parse_args()
    {"prepare": prepare, "run": run, "report": summarize}[args.action](args)


if __name__ == "__main__":
    main()
