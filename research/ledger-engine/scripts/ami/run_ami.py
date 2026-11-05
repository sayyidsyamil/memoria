"""Real-data evaluation on AMI series. Reuses the engine's metrics, router, baselines and sign test unchanged.

    python3.11 scripts/ami/run_ami.py --split dev  --part memoria   --cache results/cache/ami_dev_memoria.jsonl  --out results/ami/memoria_dev.json
    python3.11 scripts/ami/run_ami.py --split test --part baselines --configs fc+cot,bm25-12 ...

One process per cache file. Resumable: every LLM call is cached, so re-running continues where it stopped.
"""
import argparse
import json
import platform
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parents[1]
sys.path.insert(0, str(ENGINE))

from memoria_engine.evaluation import baselines, metrics, router as routing  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.evaluation.oracle import ledger_answer, values_equal  # noqa: E402
from memoria_engine.evaluation.run_eval import run_pipeline  # noqa: E402
from memoria_engine.evaluation.run_scaling import BASELINE_CONFIGS  # noqa: E402
from memoria_engine.extractors import PROMPT_HASH, PROMPT_VERSION, OracleExtractor  # noqa: E402
from memoria_engine.windowed import WindowedExtractor  # noqa: E402
from specs import SPECS  # noqa: E402

COMBOS = ("ext+router", "ext+oracle_route", "oracle_ext+router", "oracle_ext+oracle_route")


def run_memoria(chains, llm, log):
    rows, scores, ledger, extract = [], [], [], {"seconds": [], "prompt_tokens": [], "output_tokens": [], "windows": []}
    router_stats = {"seconds": [], "prompt_tokens": []}
    per_chain = {}
    router = routing.MLXRouter(llm)
    for chain in chains:
        gold = run_pipeline(chain, OracleExtractor(chain), "immediate")["pipeline"]
        run = run_pipeline(chain, WindowedExtractor(llm), "immediate")
        pipe = run["pipeline"]
        assert pipe.ledger.check_invariants() == []
        chain_scores = [metrics.score_meeting(gm, res, chain.registry) for gm, res in zip(chain.meetings, run["results"])]
        scores += chain_scores
        for res in run["results"]:
            for key, stat in (("seconds", "llm_seconds"), ("prompt_tokens", "prompt_tokens"), ("output_tokens", "output_tokens"), ("windows", "windows")):
                if res.stats.get(stat) is not None:
                    extract[key].append(res.stats[stat])
        ledger.append(metrics.ledger_scores(pipe, gold, chain))
        today = baselines.today_iso(chain)
        for q in chain.questions:
            route = router.route(chain.registry, today, q.ask)
            st = router.last_stats
            router_stats["seconds"].append(st.get("seconds", 0.0))
            router_stats["prompt_tokens"].append(st.get("prompt_tokens", 0))
            answers = {"ext+router": routing.routed_answer(pipe.ledger, route, chain.now),
                       "ext+oracle_route": ledger_answer(pipe.ledger, q, chain.now),
                       "oracle_ext+router": routing.routed_answer(gold.ledger, route, chain.now),
                       "oracle_ext+oracle_route": ledger_answer(gold.ledger, q, chain.now)}
            rows.append({"chain": chain.chain_id, "qid": q.qid, "type": q.type, "gold": q.gold, "question": q.ask, "route": route.as_dict(),
                         "route_exact": routing.route_matches(route, q),
                         "answers": {c: {"answer": a, "correct": values_equal(a, q.gold)} for c, a in answers.items()}})
        per_chain[chain.chain_id] = metrics.aggregate_extraction(chain_scores, 0)
        log(f"memoria {chain.chain_id}: {len(chain.meetings)} meetings, {len(chain.questions)} questions", flush=True)
    qa = {c: metrics.score_answers([{"type": r["type"], "correct": r["answers"][c]["correct"]} for r in rows]) for c in COMBOS}
    mean = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
    return {"qa": qa, "rows": rows, "extraction": metrics.aggregate_extraction(scores, 0), "extraction_by_chain": per_chain,
            "ledger": metrics.sum_ledger_scores(ledger),
            "router": {"exact": sum(r["route_exact"] for r in rows), "n": len(rows), "failed": sum(1 for r in rows if not r["route"]["ok"]),
                       "mean_seconds": mean(router_stats["seconds"]), "mean_prompt_tokens": mean(router_stats["prompt_tokens"])},
            "cost": {"meetings": len(extract["seconds"]), "extract_seconds_per_meeting": mean(extract["seconds"]), "extract_seconds_total": round(sum(extract["seconds"]), 1),
                     "prompt_tokens_per_meeting": mean(extract["prompt_tokens"]), "output_tokens_per_meeting": mean(extract["output_tokens"]),
                     "windows_per_meeting": mean(extract["windows"])}}


def run_baselines(chains, llm, configs, log):
    out = {}
    for name in configs:
        system = BASELINE_CONFIGS[name](llm)
        items = []
        for chain in chains:
            for q in chain.questions:
                res = system.answer(chain, q)
                item = baselines.score_item(chain, q, res["raw"], cot=system.cot)
                item.update(chain=chain.chain_id, qid=q.qid, seconds=round(res["seconds"], 2), prompt_tokens=res["prompt_tokens"],
                            output_tokens=res.get("output_tokens"), question=q.ask)
                items.append(item)
            log(f"{system.name}: finished {chain.chain_id}", flush=True)
        secs = sorted(i["seconds"] for i in items)
        out[system.name] = {"qa": metrics.score_answers(items), "items": items, "median_seconds": secs[len(secs) // 2],
                            "mean_prompt_tokens": round(sum(i["prompt_tokens"] for i in items) / len(items)),
                            "mean_output_tokens": round(sum((i["output_tokens"] or 0) for i in items) / len(items))}
        log(f"{system.name}: {out[system.name]['qa']['overall']}", flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=("dev", "test"), required=True)
    ap.add_argument("--part", choices=("memoria", "baselines"), required=True)
    ap.add_argument("--configs", default="fc+cot,bm25-12")
    ap.add_argument("--data", default="data/ami_v0")
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--chains", default="", help="comma list to restrict (debugging only)")
    args = ap.parse_args()
    wanted = [t for t, s in SPECS.items() if s["split"] == args.split]
    if args.chains:
        wanted = [t for t in wanted if t in args.chains.split(",")]
    chains = [c for c in load_chains(str(ENGINE / args.data)) if c.chain_id in wanted]
    from memoria_engine.llmcache import CachingMLX

    llm = CachingMLX(str(ENGINE / args.cache))
    llm.load()
    started = time.perf_counter()
    report = {"config": {"split": args.split, "part": args.part, "chains": [c.chain_id for c in chains], "questions": sum(len(c.questions) for c in chains),
                         "model": llm.model_id, "extractor_prompt": PROMPT_VERSION, "extractor_prompt_sha256_12": PROMPT_HASH, "router_prompt": routing.ROUTER_VERSION,
                         "window_chars": WindowedExtractor(None).window_chars, "baseline_configs": args.configs if args.part == "baselines" else None,
                         "cot_max_tokens": baselines.COT_TOKENS, "machine": platform.platform(), "date": time.strftime("%Y-%m-%d %H:%M:%S")}}
    if args.part == "memoria":
        report["memoria"] = run_memoria(chains, llm, print)
    else:
        report["baselines"] = run_baselines(chains, llm, args.configs.split(","), print)
    report["wall_seconds"] = round(time.perf_counter() - started, 1)
    report["cache"] = {"hits": llm.hits, "misses": llm.misses}
    path = ENGINE / args.out
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
    print(f"done in {report['wall_seconds']}s -> {path}", flush=True)


if __name__ == "__main__":
    main()
