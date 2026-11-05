"""Select the best strictly mixed dev condition, alongside the primary selection.

Secondary exploratory contrast: the primary preregistered rule includes dense-only
and BM25-only controls. If a control wins, this keeps an actual hybrid comparison.
Uses dev answers only; writes a separate selection and never alters the primary.
"""
import argparse
import json
from pathlib import Path

from scripts.hybrid_experiment import digest, read_plan, save
from scripts.hybrid_rag import RetrievalConfig


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, help="completed development directory")
    args = ap.parse_args()
    root = Path(args.out)
    plan, cases = read_plan(root)
    answers = json.loads((root / "answers.json").read_text())
    if plan["split"] != "dev" or not answers["complete"] or len(answers["rows"]) != len(cases):
        raise ValueError("requires a complete development run")
    summary = json.loads((root / "summary.json").read_text())
    configs = {RetrievalConfig(**c).name: c for c in plan["configs"]}
    eligible = [g for g in summary["conditions"].values() if g["level"] == 0 and 0 < configs[g["config"]]["alpha"] < 1]
    best = min(eligible, key=lambda g: (-g["qa"]["overall"]["accuracy"], g["mean_prompt_tokens"], g["config"]))
    selection = {"dataset": plan["dataset"], "split": "dev", "config": configs[best["config"]],
                 "cot": plan["cot"], "model": plan["model"], "answers_sha256": digest(root / "answers.json"),
                 "rule": "secondary exploratory comparison: same dev ranking, restricted to 0 < alpha < 1"}
    target = root / "selection_mixed.json"
    save(target, selection)
    print(f"Mixed hybrid: {best['config']} -> {target}")


if __name__ == "__main__":
    main()
