"""Run the evaluation:  python3.11 -m memoria_engine.evaluation.run_eval --extractor mlx --policies immediate,confirm_conflicts,confirm_all --baselines

Every number in the output comes from this run; the JSON keeps raw extractor outputs for audit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from pathlib import Path
from typing import Any, Dict, List

from ..extractors import PROMPT_HASH, PROMPT_VERSION, KeywordExtractor, MLXExtractor, OracleExtractor
from ..pipeline import Pipeline, make_policy
from . import baselines, metrics
from .dataset import Chain, load_chains
from .oracle import OracleReviewer, ledger_answer


SPLITS = {"dev": ["crm", "datacentre"], "test": ["tender", "hiring", "portfolio"]}


def build_extractor(kind: str, chain: Chain, llm: Any):
    if kind == "oracle":
        return OracleExtractor(chain)
    if kind == "keyword":
        return KeywordExtractor()
    return llm


def run_pipeline(chain: Chain, extractor: Any, policy_name: str) -> Dict[str, Any]:
    policy = make_policy(policy_name)
    pipe = Pipeline(chain.registry, extractor, policy, OracleReviewer(chain) if policy.kind != "immediate" else None)
    results = [pipe.ingest(gm.meeting) for gm in chain.meetings]
    return {"pipeline": pipe, "results": results}


def evaluate(chains: List[Chain], extractor_kind: str, policies: List[str], llm: Any, seed: int) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    gold_pipes = {c.chain_id: run_pipeline(c, OracleExtractor(c), "immediate")["pipeline"] for c in chains}
    for policy_name in policies:
        started = time.perf_counter()
        meeting_scores, all_results, ledgers, answers, audit = [], [], [], [], []
        for chain in chains:
            run = run_pipeline(chain, build_extractor(extractor_kind, chain, llm), policy_name)
            pipe, results = run["pipeline"], run["results"]
            for gm, res in zip(chain.meetings, results):
                meeting_scores.append(metrics.score_meeting(gm, res, chain.registry))
                audit.append({"chain": chain.chain_id, "meeting": gm.meeting.meeting_id, "seconds": round(res.seconds, 2), "stats": res.stats,
                              "dispositions": [{"status": d.status, "reason": d.reason, "turn": d.turn, "object": d.object_id, "attribute": d.attribute,
                                                "value": d.value, "review": d.review, "outcome": d.outcome, "conflict": d.conflict,
                                                "quote": d.candidate.quote, "confidence": d.candidate.confidence} for d in res.dispositions]})
            all_results += results
            ledgers.append(metrics.ledger_scores(pipe, gold_pipes[chain.chain_id], chain))
            assert pipe.ledger.check_invariants() == [], pipe.ledger.check_invariants()
            for q in chain.questions:
                t0 = time.perf_counter()
                got = ledger_answer(pipe.ledger, q, chain.now)
                micros = (time.perf_counter() - t0) * 1e6
                answers.append({"qid": q.qid, "chain": chain.chain_id, "type": q.type, "gold": q.gold, "answer": got,
                                "correct": metrics.values_equal(got, q.gold), "micros": micros})
        times = [r.seconds for r in all_results]
        out[policy_name] = {
            "extraction": metrics.aggregate_extraction(meeting_scores, seed), "ledger": metrics.sum_ledger_scores(ledgers),
            "review": metrics.review_burden(all_results), "qa_memoria": metrics.score_answers(answers),
            "qa_latency_micros_median": sorted(a["micros"] for a in answers)[len(answers) // 2],
            "extraction_seconds_per_meeting": sum(times) / len(times), "wall_seconds": round(time.perf_counter() - started, 1),
            "audit": audit, "answers": answers,
        }
    return out


def run_baselines(chains: List[Chain], llm: Any) -> Dict[str, Any]:
    out = {}
    for system in (baselines.FullContext(llm), baselines.BM25RAG(llm)):
        items = []
        for chain in chains:
            for q in chain.questions:
                res = system.answer(chain, q)
                item = baselines.score_item(chain, q, res["raw"])
                item.update(seconds=round(res["seconds"], 2), prompt_tokens=res["prompt_tokens"])
                items.append(item)
            print(f"    {system.name}: finished {chain.chain_id}", flush=True)
        out[system.name] = {"qa": metrics.score_answers(items), "items": items,
                            "median_seconds": sorted(i["seconds"] for i in items)[len(items) // 2],
                            "mean_prompt_tokens": sum(i["prompt_tokens"] for i in items) / len(items)}
        print(f"  {system.name}: {out[system.name]['qa']['overall']}", flush=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/pilot_v0")
    ap.add_argument("--extractor", choices=("oracle", "keyword", "mlx"), default="oracle")
    ap.add_argument("--policies", default="immediate")
    ap.add_argument("--baselines", action="store_true")
    ap.add_argument("--chains", default="", help="comma-separated chain ids (default: all)")
    ap.add_argument("--split", choices=("dev", "test", "all"), default="all", help="dev = prompt tuning chains; test = held out")
    ap.add_argument("--out", default="")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    wanted = args.chains.split(",") if args.chains else (SPLITS[args.split] if args.split != "all" else None)
    chains = [c for c in load_chains(args.data) if wanted is None or c.chain_id in wanted]
    llm = MLXExtractor() if (args.extractor == "mlx" or args.baselines) else None
    data_hash = hashlib.sha256("".join(p.read_text() for p in sorted(Path(args.data).glob("*.chain"))).encode()).hexdigest()[:12]
    report: Dict[str, Any] = {
        "config": {"extractor": args.extractor, "model": llm.model_id if llm else None, "policies": args.policies.split(","),
                   "data": args.data, "data_sha256_12": data_hash, "chains": [c.chain_id for c in chains],
                   "meetings": sum(len(c.meetings) for c in chains), "questions": sum(len(c.questions) for c in chains),
                   "machine": platform.platform(), "python": platform.python_version(), "date": time.strftime("%Y-%m-%d %H:%M:%S"),
                   "prompt_version": PROMPT_VERSION, "prompt_sha256_12": PROMPT_HASH, "split": args.split},
    }
    if llm:
        llm.load()
    path = Path(args.out or f"results/{args.extractor}_{time.strftime('%Y%m%d_%H%M%S')}.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    save = lambda: path.write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
    report["pipeline"] = evaluate(chains, args.extractor, args.policies.split(","), llm, args.seed)
    save()  # keep the (slow) pipeline results even if a baseline later fails
    if args.baselines:
        print("running QA baselines...", flush=True)
        report["baselines"] = run_baselines(chains, llm)
        save()
    for name, r in report["pipeline"].items():
        e, l, b = r["extraction"], r["ledger"], r["review"]
        print(f"[{args.extractor} / {name}] P={e['precision']} R={e['recall']} F1={e['f1']} | supersession F1={l['supersession_f1']} | "
              f"state acc={l['state_accuracy']} | QA={r['qa_memoria']['overall']['accuracy']} | proposals/meeting={b['proposals_per_meeting']}")
    print("saved", path)


if __name__ == "__main__":
    main()
