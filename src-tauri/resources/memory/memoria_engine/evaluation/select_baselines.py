"""Which baseline configurations go to the test split. The rule is fixed here, before the dev baseline run finished.

Per family (full-context, BM25 RAG) take the configuration with the most correct dev answers at the largest level in the file.
Ties go to the cheaper configuration: fewer mean output tokens, then fewer mean prompt tokens, then name. The test chains
play no part in the choice. Picking the best of several configurations on 27 questions favours the baselines, never Memoria.

    python3 -m memoria_engine.evaluation.select_baselines results/dev/baselines_dev_k24.json
"""
from __future__ import annotations

import argparse
import json
from typing import Any, Dict, List

from .run_scaling import BASELINE_CONFIGS

FAMILIES = ("full-context", "bm25-rag")


def family(name: str) -> str:
    return "bm25-rag" if name.startswith("bm25-rag") else "full-context"


def choose(report: Dict[str, Any], level: str = "") -> List[Dict[str, Any]]:
    level = level or max(report["levels"], key=int)
    systems = report["levels"][level]["systems"]

    def rank(name: str) -> Any:
        s = systems[name]
        return (-s["qa"]["overall"]["correct"], s["mean_output_tokens"] or 0, s["mean_prompt_tokens"] or 0, name)

    keys = {factory(None).name: key for key, factory in BASELINE_CONFIGS.items()}
    chosen = []
    for fam in FAMILIES:
        names = [n for n in systems if family(n) == fam]
        if names:
            best = min(names, key=rank)
            o = systems[best]["qa"]["overall"]
            chosen.append({"family": fam, "name": best, "key": keys[best], "correct": o["correct"], "n": o["n"], "level": int(level)})
    return chosen


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dev_baselines")
    ap.add_argument("--level", default="")
    args = ap.parse_args()
    chosen = choose(json.load(open(args.dev_baselines, encoding="utf-8")), args.level)
    for c in chosen:
        print(f"{c['family']:13s} -> {c['name']} ({c['correct']}/{c['n']} on dev at K={c['level']})")
    print(f"--configs {','.join(c['key'] for c in chosen)}")
    print(f"--select \"{','.join(c['name'] for c in chosen)}\"")


if __name__ == "__main__":
    main()
