"""Scaling experiment: how does question answering hold up as the meeting history grows?

    # Memoria: LLM extraction + LLM router (and ablations), one process
    python3.11 -m memoria_engine.evaluation.run_scaling --part memoria --split test --levels 0,8,24,48 \\
        --extractor mlx --router mlx --cache results/cache/memoria_test.jsonl --out results/scaling_memoria_test.json
    # Baselines (full-context, BM25 RAG; direct or chain-of-thought), another process
    python3.11 -m memoria_engine.evaluation.run_scaling --part baselines --split test --levels 0,8,24,48 \\
        --configs fc,bm25-6 --cache results/cache/baselines_test.jsonl --out results/scaling_baselines_test.json

Level K pads every chain with K template-written filler meetings (see padding.py). The questions and gold never change.
All LLM calls go through a recording cache, so an interrupted run restarts where it stopped and every number can be audited.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from pathlib import Path
from typing import Any, Dict, List, Sequence

from ..extractors import PROMPT_HASH, PROMPT_VERSION, OracleExtractor
from . import baselines, metrics, padding, router as routing
from .dataset import Chain, load_chains
from .oracle import ledger_answer, values_equal
from .run_eval import SPLITS, build_extractor, run_pipeline

BASELINE_CONFIGS = {
    "fc": lambda llm: baselines.FullContext(llm), "fc+cot": lambda llm: baselines.FullContext(llm, cot=True),
    "bm25-6": lambda llm: baselines.BM25RAG(llm, k=6), "bm25-12": lambda llm: baselines.BM25RAG(llm, k=12),
    "bm25-6+cot": lambda llm: baselines.BM25RAG(llm, k=6, cot=True), "bm25-12+cot": lambda llm: baselines.BM25RAG(llm, k=12, cot=True),
}
COMBOS = ("ext+router", "ext+oracle_route", "oracle_ext+router", "oracle_ext+oracle_route")


def _mean(xs: Sequence[float]) -> Any:
    return round(sum(xs) / len(xs), 3) if xs else None


def memoria_level(chains: List[Chain], k: int, extractor_kind: str, llm: Any, route_with: Any = None, seed: int = 0, log: Any = print) -> Dict[str, Any]:
    """One padding level for Memoria: extract with the chosen extractor, then answer each question's natural wording through
    `route_with` (a router object; None means the oracle router, i.e. the structured question)."""
    rows: List[Dict[str, Any]] = []
    base_scores: List[Dict[str, Any]] = []
    filler_scores: List[Dict[str, Any]] = []
    ledger_all, ledger_base = [], []
    extract = {"seconds": [], "prompt_tokens": [], "output_tokens": []}
    routing_stats = {"seconds": [], "prompt_tokens": []}
    shape: Dict[str, Any] = {}
    for chain in chains:
        padded = padding.pad_chain(chain, k, seed)
        base_ids = {gm.meeting.meeting_id for gm in chain.meetings}
        gold = run_pipeline(padded, OracleExtractor(padded), "immediate")["pipeline"]
        run = run_pipeline(padded, build_extractor(extractor_kind, padded, llm), "immediate")
        pipe = run["pipeline"]
        assert pipe.ledger.check_invariants() == [], pipe.ledger.check_invariants()
        for gm, res in zip(padded.meetings, run["results"]):
            (base_scores if gm.meeting.meeting_id in base_ids else filler_scores).append(metrics.score_meeting(gm, res, padded.registry))
            for key, stat in (("seconds", "llm_seconds"), ("prompt_tokens", "prompt_tokens"), ("output_tokens", "output_tokens")):
                if res.stats.get(stat) is not None:
                    extract[key].append(res.stats[stat])
        ledger_all.append(metrics.ledger_scores(pipe, gold, padded))
        ledger_base.append(metrics.ledger_scores(pipe, gold, chain))
        shape[chain.chain_id] = {"meetings": len(padded.meetings), "objects": len(padded.registry.objects), "slots": len(padded.registry.slots()),
                                 "gold_events": len(padded.events)}
        log(f"  K={k} {chain.chain_id}: extracted {len(padded.meetings)} meetings", flush=True)
        today = baselines.today_iso(padded)
        for q in chain.questions:
            route = route_with.route(padded.registry, today, q.ask) if route_with is not None else routing.oracle_route(q)
            stats = getattr(route_with, "last_stats", {}) or {}
            if stats:
                routing_stats["seconds"].append(stats.get("seconds", 0.0))
                routing_stats["prompt_tokens"].append(stats.get("prompt_tokens", 0))
            answers = {"ext+router": routing.routed_answer(pipe.ledger, route, padded.now),
                       "ext+oracle_route": ledger_answer(pipe.ledger, q, padded.now),
                       "oracle_ext+router": routing.routed_answer(gold.ledger, route, padded.now),
                       "oracle_ext+oracle_route": ledger_answer(gold.ledger, q, padded.now)}
            rows.append({"chain": chain.chain_id, "qid": q.qid, "type": q.type, "gold": q.gold, "question": q.ask, "route": route.as_dict(),
                         "route_exact": routing.route_matches(route, q), "route_raw": stats.get("raw"),
                         "answers": {c: {"answer": a, "correct": values_equal(a, q.gold)} for c, a in answers.items()}})
        log(f"  K={k} {chain.chain_id}: answered {len(chain.questions)} questions", flush=True)
    qa = {c: metrics.score_answers([{"type": r["type"], "correct": r["answers"][c]["correct"]} for r in rows]) for c in COMBOS}
    by_type: Dict[str, Dict[str, int]] = {}
    for r in rows:
        cell = by_type.setdefault(r["type"], {"correct": 0, "n": 0})
        cell["correct"] += r["route_exact"]
        cell["n"] += 1
    return {
        "k": k, "shape": shape, "qa": qa,
        "router": {"exact": sum(r["route_exact"] for r in rows), "n": len(rows), "failed": sum(1 for r in rows if not r["route"]["ok"]), "by_type": by_type,
                   "mean_prompt_tokens": _mean(routing_stats["prompt_tokens"]), "mean_seconds": _mean(routing_stats["seconds"])},
        "extraction_base": metrics.aggregate_extraction(base_scores, seed), "extraction_filler": metrics.aggregate_extraction(filler_scores, seed) if filler_scores else None,
        "ledger_base": metrics.sum_ledger_scores(ledger_base), "ledger_all": metrics.sum_ledger_scores(ledger_all),
        "cost": {"extract_seconds_per_meeting": _mean(extract["seconds"]), "extract_prompt_tokens_mean": _mean(extract["prompt_tokens"]),
                 "extract_output_tokens_mean": _mean(extract["output_tokens"]), "meetings_extracted": len(extract["seconds"]),
                 "extract_seconds_total": round(sum(extract["seconds"]), 1)},
        "rows": rows,
    }


def baseline_level(chains: List[Chain], k: int, systems: Sequence[Any], seed: int = 0, log: Any = print) -> Dict[str, Any]:
    out: Dict[str, Any] = {"k": k, "systems": {}}
    padded_chains = [padding.pad_chain(c, k, seed) for c in chains]
    for system in systems:
        items: List[Dict[str, Any]] = []
        for padded, chain in zip(padded_chains, chains):
            for q in chain.questions:
                res = system.answer(padded, q)
                item = baselines.score_item(padded, q, res["raw"], cot=system.cot)
                item.update(seconds=round(res["seconds"], 2), prompt_tokens=res["prompt_tokens"], output_tokens=res.get("output_tokens"),
                            marker=bool(baselines._MARK.search(res["raw"])) if system.cot else None, question=q.ask)
                items.append(item)
            log(f"  K={k} {system.name}: finished {chain.chain_id}", flush=True)
        out["systems"][system.name] = {
            "qa": metrics.score_answers(items), "items": items,
            "median_seconds": sorted(i["seconds"] for i in items)[len(items) // 2],
            "mean_prompt_tokens": _mean([i["prompt_tokens"] for i in items]), "mean_output_tokens": _mean([i["output_tokens"] or 0 for i in items]),
            "answer_marker_rate": _mean([1.0 if i["marker"] else 0.0 for i in items]) if system.cot else None}
        log(f"  K={k} {system.name}: {out['systems'][system.name]['qa']['overall']}", flush=True)
    return out


def config(args: argparse.Namespace, chains: List[Chain], llm: Any) -> Dict[str, Any]:
    data_dir = Path(args.data)
    return {"part": args.part, "split": args.split, "levels": [int(x) for x in args.levels.split(",")], "chains": [c.chain_id for c in chains],
            "questions": sum(len(c.questions) for c in chains), "extractor": args.extractor, "router": args.router,
            "model": llm.model_id if llm else None, "padding_seed": args.seed, "generator": padding.GENERATOR_VERSION,
            "extractor_prompt": PROMPT_VERSION, "extractor_prompt_sha256_12": PROMPT_HASH, "router_prompt": routing.ROUTER_VERSION,
            "baseline_configs": args.configs.split(",") if args.part == "baselines" else None, "cot_max_tokens": baselines.COT_TOKENS,
            "data_sha256_12": hashlib.sha256("".join(p.read_text() for p in sorted(data_dir.glob("*.chain"))).encode()).hexdigest()[:12],
            "wording": args.wording, "ask_sha256_12": hashlib.sha256("".join(p.read_text() for p in sorted(data_dir.glob(f"*.{args.wording}"))).encode()).hexdigest()[:12],
            "machine": platform.platform(), "python": platform.python_version(), "date": time.strftime("%Y-%m-%d %H:%M:%S")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--part", choices=("memoria", "baselines"), required=True)
    ap.add_argument("--data", default="data/pilot_v0")
    ap.add_argument("--wording", choices=("ask", "alt"), default="ask", help="question phrasing set: primary (.ask) or the second phrasing (.alt)")
    ap.add_argument("--split", choices=("dev", "test"), required=True)
    ap.add_argument("--levels", default="0,8,24,48")
    ap.add_argument("--extractor", choices=("oracle", "keyword", "mlx"), default="mlx")
    ap.add_argument("--router", choices=("oracle", "mlx"), default="mlx")
    ap.add_argument("--configs", default="fc,bm25-6")
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    chains = [c for c in load_chains(args.data, args.wording) if c.chain_id in SPLITS[args.split]]
    needs_llm = args.extractor == "mlx" or args.router == "mlx" or args.part == "baselines"
    from ..llmcache import CachingMLX

    llm = CachingMLX(args.cache) if needs_llm else None
    if llm:
        llm.load()
    report: Dict[str, Any] = {"config": config(args, chains, llm), "levels": {}}
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    for k in report["config"]["levels"]:
        started = time.perf_counter()
        if args.part == "memoria":
            route_with = routing.MLXRouter(llm) if args.router == "mlx" else None
            report["levels"][str(k)] = memoria_level(chains, k, args.extractor, llm, route_with, args.seed)
        else:
            systems = [BASELINE_CONFIGS[name](llm) for name in args.configs.split(",")]
            report["levels"][str(k)] = baseline_level(chains, k, systems, args.seed)
        report["levels"][str(k)]["wall_seconds"] = round(time.perf_counter() - started, 1)
        report["cache"] = {"hits": llm.hits, "misses": llm.misses} if llm else None
        path.write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
        print(f"level K={k} done in {report['levels'][str(k)]['wall_seconds']}s -> {path}", flush=True)


if __name__ == "__main__":
    main()
