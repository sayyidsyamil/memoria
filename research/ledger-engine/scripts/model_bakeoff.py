"""Evaluate a candidate on Memoria's actual AMI dev pipeline before promotion.

Runs one model per process, with identical extraction windows/prompts/router.
Pins checkpoint revision; keeps caches and results outside the original study.
No live ledger is opened or edited. --allow-download intentionally fetches weights.
"""
import argparse
import hashlib
import json
import platform
import resource
import sys
import time
from pathlib import Path

from memoria_engine.evaluation import metrics
from memoria_engine.evaluation.dataset import load_chains
from memoria_engine.llmcache import CachingMLX
from scripts.hybrid_experiment import digest, save

ROOT = Path(__file__).resolve().parents[1]
MODELS = {
    "minicpm5": {"repo": "openbmb/MiniCPM5-2B-MLX", "revision": "8a9ad7539ac86281d0ac2b017ba04a5de53fe9a3"},
    "qwen": {"repo": "mlx-community/Qwen3.5-4B-MLX-4bit", "revision": None},
}


def load_ami_runner():
    # Existing AMI script imports specs as a sibling; reuse its evaluated pipeline.
    location = str(ROOT / "scripts/ami")
    if location not in sys.path:
        sys.path.insert(0, location)
    from run_ami import run_memoria
    return run_memoria


def promote_check(candidate, reference):
    """Dev screening gate, not evidence of held-out superiority.

    Better QA overall, no loss in current values, no loss in extraction precision
    or recall. A passing candidate still needs independent test and app regression.
    """
    a, b = candidate["memoria"], reference["memoria"]
    ka = {(r["chain"], r["qid"]): r["gold"] for r in a["rows"]}
    kb = {(r["chain"], r["qid"]): r["gold"] for r in b["rows"]}
    if ka != kb or not ka:
        raise ValueError("candidate and reference must have identical nonempty question/gold pairs")
    qa, qb = a["qa"]["ext+router"], b["qa"]["ext+router"]
    checks = {
        "overall_qa_strictly_better": qa["overall"]["accuracy"] > qb["overall"]["accuracy"],
        "current_qa_not_worse": qa["current"]["accuracy"] >= qb["current"]["accuracy"],
        "extraction_precision_not_worse": (a["extraction"]["precision"] or 0) >= (b["extraction"]["precision"] or 0),
        "extraction_recall_not_worse": (a["extraction"]["recall"] or 0) >= (b["extraction"]["recall"] or 0),
    }
    return {"checks": checks, "eligible_for_test": all(checks.values()), "automatic_default_switch": False}


def run(args):
    from huggingface_hub import snapshot_download

    target = ROOT / args.out
    selected = MODELS[args.model]
    # Qwen is used from the existing local snapshot, with its resolved revision recorded.
    checkpoint = Path(snapshot_download(selected["repo"], revision=selected["revision"],
                                        local_files_only=not args.allow_download,
                                        allow_patterns=["*.json", "*.jinja", "*.safetensors", "*.model", "*.txt"]))
    sources = sorted((ROOT / "memoria_engine").rglob("*.py")) + sorted((ROOT / "scripts/ami").glob("*.py"))
    sources += [Path(__file__)] + sorted((ROOT / "data/ami_v0").glob("*"))
    manifest = {str(p.relative_to(ROOT)): digest(p) for p in sources if p.is_file()}
    config = {"dataset": "ami_v0", "split": "dev", "model": selected["repo"], "revision": checkpoint.name,
              "checkpoint": str(checkpoint), "manifest": manifest, "machine": platform.platform(),
              "python": platform.python_version(), "thinking": False, "window_chars": 7000,
              "gate": "better pooled QA; no regression on current QA, extraction precision or recall",
              "note": "development selection only; no test-split model selection"}
    plan_path = target / "plan.json"
    if plan_path.exists():
        if json.loads(plan_path.read_text()) != config:
            raise ValueError("existing plan differs; choose a fresh --out directory")
    else:
        save(plan_path, config)
    # Explicit snapshot path pins actual loaded weights. It also namespaces call-cache keys.
    llm = CachingMLX(str(target / "calls.jsonl"), model_id=str(checkpoint))
    start = time.perf_counter()
    llm.load()
    load_seconds = time.perf_counter() - start
    chains = [c for c in load_chains(str(ROOT / "data/ami_v0")) if c.chain_id in ("ES2003", "TS3004")]
    run_memoria = load_ami_runner()
    started = time.perf_counter()
    result = run_memoria(chains, llm, print)
    import mlx.core as mx

    record = {"config": config, "memoria": result, "load_seconds": load_seconds,
              "wall_seconds": time.perf_counter() - started, "cache": {"hits": llm.hits, "misses": llm.misses},
              "peak_rss_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9,
              "mlx_peak_gb": mx.get_peak_memory() / 1e9}
    save(target / "results.json", record)
    print(json.dumps({"qa": result["qa"]["ext+router"], "extraction": {k: result["extraction"][k] for k in ("precision", "recall", "f1")},
                      "router": result["router"], "cost": result["cost"], "mlx_peak_gb": record["mlx_peak_gb"]}, indent=2))


def report(args):
    target = ROOT / args.out
    candidate = json.loads((target / "results.json").read_text())
    reference = json.loads((ROOT / args.reference).read_text())
    gate = promote_check(candidate, reference)
    a, b = candidate["memoria"], reference["memoria"]
    lines = ["# Candidate model screening on Memoria", "", f"Candidate: {candidate['config']['model']} at `{candidate['config']['revision']}`.",
             "", "Identical AMI development teams ES2003/TS3004, 8 meetings, 45 questions, same extraction windows, prompts, pipeline and router.",
             "", "| Measure | Candidate | Qwen reference |", "|---|---:|---:|"]
    for kind in ("overall", "current", "as_of_valid", "n_changes"):
        x, y = a["qa"]["ext+router"][kind], b["qa"]["ext+router"][kind]
        lines.append(f"| QA {kind} | {x['correct']}/{x['n']} ({x['accuracy']:.1%}) | {y['correct']}/{y['n']} ({y['accuracy']:.1%}) |")
    for name in ("precision", "recall", "f1"):
        x, y = a['extraction'][name], b['extraction'][name]
        left = f"{x:.1%}" if x is not None else "undefined (no scored predictions)"
        right = f"{y:.1%}" if y is not None else "undefined (no scored predictions)"
        lines.append(f"| Extraction {name} | {left} | {right} |")
    lines += ["", f"**Eligible for held-out follow-up:** {gate['eligible_for_test']}. **Default changed:** no.", ""]
    lines += [f"- {key}: {value}" for key, value in gate["checks"].items()]
    lines += ["", "This is development screening, not proof of superiority. Qwen's reference is a stored prior run; timing is not paired or simultaneous. Each model uses its own chat template with thinking disabled and the same output budgets. No prompt tuning or test-set selection was done. Extraction precision is a lower bound against incomplete AMI annotations.",
              "", "Live HUD guard thresholds are calibrated to Qwen and are not validated by this ledger experiment. A replacement there also needs alert/false-alarm/citation tests and guard recalibration. The released application and its default remain the evaluated Qwen version."]
    save(target / "promotion_check.json", gate)
    (target / "report.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("run", "report"))
    parser.add_argument("--model", choices=tuple(MODELS), default="minicpm5")
    parser.add_argument("--out", default="results/model_bakeoff/minicpm5_dev")
    parser.add_argument("--reference", default="results/ami/memoria_dev.json")
    parser.add_argument("--allow-download", action="store_true")
    args = parser.parse_args()
    {"run": run, "report": report}[args.action](args)


if __name__ == "__main__":
    main()
