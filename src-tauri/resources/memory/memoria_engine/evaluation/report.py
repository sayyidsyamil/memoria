"""Turn result JSON files into markdown tables:  python3 -m memoria_engine.evaluation.report results/test_*.json"""
from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional


def pct(x: Optional[float], digits: int = 0) -> str:
    return "n/a" if x is None else f"{100 * x:.{digits}f}%"


def ci(x: Optional[Any]) -> str:
    return "" if not x else f" [{100 * x[0]:.0f}-{100 * x[1]:.0f}]"


def load(paths: List[str]) -> List[Dict[str, Any]]:
    return [json.load(open(p, encoding="utf-8")) for p in paths]


def render(reports: List[Dict[str, Any]]) -> str:
    out: List[str] = []
    first = reports[0]["config"]
    out.append(f"Data {first['data']} (sha256 {first['data_sha256_12']}), split `{first.get('split', 'all')}`: "
               f"{first['meetings']} meetings, {first['questions']} questions, chains {', '.join(first['chains'])}.")
    llm = next((r["config"] for r in reports if r["config"].get("model")), None)
    if llm:
        out.append(f"LLM: {llm['model']}, greedy decoding, prompt {llm['prompt_version']} (hash {llm['prompt_sha256_12']}), "
                   f"{llm['machine']}, Python {llm['python']}, run {llm['date']}.")
    out += ["", "### Extraction and ledger quality (per policy)", "",
            "| Extractor | Policy | Precision | Recall | F1 [95% CI] | State-changing recall | Supersession P / R / F1 | Final-state accuracy | Phantom beliefs |",
            "|---|---|---|---|---|---|---|---|---|"]
    for r in reports:
        name = r["config"]["extractor"]
        for policy, p in r["pipeline"].items():
            e, l = p["extraction"], p["ledger"]
            out.append(f"| {name} | {policy} | {pct(e['precision'])} | {pct(e['recall'])} | {pct(e['f1'])}{ci(e['ci_95'].get('f1'))} | "
                       f"{pct(e['state_changing_recall'])} ({e['state_changing_gold']}) | {pct(l['supersession_precision'])} / {pct(l['supersession_recall'])} / "
                       f"{pct(l['supersession_f1'])} | {pct(l['state_accuracy'])} ({l['state_correct']}/{l['state_gold']}) | {l['phantom_beliefs']} |")
    out += ["", "### Human-in-the-loop cost (oracle reviewer: an ideal human, so an upper bound)", "",
            "| Extractor | Policy | Applied directly | Proposals / meeting | Accepted | Edited | Rejected |", "|---|---|---|---|---|---|---|"]
    for r in reports:
        if r["config"]["extractor"] == "oracle":
            continue
        for policy, p in r["pipeline"].items():
            b = p["review"]
            out.append(f"| {r['config']['extractor']} | {policy} | {b['applied_directly']} | {b['proposals_per_meeting']:.2f} | {b['accepted']} | {b['accepted_edited']} | {b['rejected']} |")
    for r in reports:
        if r["config"]["extractor"] != "mlx":
            continue
        base = r["pipeline"].get("immediate") or next(iter(r["pipeline"].values()))
        e = base["extraction"]
        out += ["", "### Where the LLM extractor fails (policy: immediate)", "",
                f"- Missed gold events by reason: {e['miss_reasons'] or 'none'}",
                f"- False positives by reason: {e['fp_reasons'] or 'none'}",
                f"- Candidates stopped before the ledger: {e['filtered'] or 'none'}",
                f"- Distractor turns that produced a candidate: {pct(e['distractor_hit_rate'])} of {e['distractor_turns']}",
                f"- Correct events cited on the exact gold turn: {pct(e['evidence_exact_turn'])}",
                f"- Confidence: AUROC {e['confidence_auroc'] if e['confidence_auroc'] is None else round(e['confidence_auroc'], 2)}, "
                f"ECE {e['confidence_ece'] if e['confidence_ece'] is None else round(e['confidence_ece'], 2)}, "
                f"{e['confidence_distinct']} distinct values, mean {e['confidence_mean'] if e['confidence_mean'] is None else round(e['confidence_mean'], 2)}",
                "", "| Slice | Gold events | Found | Recall |", "|---|---|---|---|"]
        for label, table in (("kind", e["by_kind"]), ("tag", e["by_tag"])):
            for key, cell in sorted(table.items()):
                out.append(f"| {label}: {key} | {cell['gold']} | {cell['found']} | {pct(cell['recall'])} |")
    out += ["", "### Question answering (exact match; Wilson 95% interval)", "",
            "| System | Overall | current | as_of_valid | as_of_tx | n_changes | Median latency | Mean prompt tokens |", "|---|---|---|---|---|---|---|---|"]

    def qa_row(label: str, qa: Dict[str, Any], latency: str, tokens: str) -> str:
        cells = [f"{pct(qa[t]['accuracy'])}{ci(qa[t]['ci_95'])} ({qa[t]['correct']}/{qa[t]['n']})" if t in qa else "-"
                 for t in ("overall", "current", "as_of_valid", "as_of_tx", "n_changes")]
        return f"| {label} | " + " | ".join(cells) + f" | {latency} | {tokens} |"

    for r in reports:
        for policy, p in r["pipeline"].items():
            out.append(qa_row(f"Memoria ledger, {r['config']['extractor']} / {policy}", p["qa_memoria"], f"{p['qa_latency_micros_median']:.0f} µs", "0 (SQL lookup)"))
        for name, b in (r.get("baselines") or {}).items():
            out.append(qa_row(f"{name} (same LLM)", b["qa"], f"{b['median_seconds']:.1f} s", f"{b['mean_prompt_tokens']:.0f}"))
    out += ["", "Note: Memoria's QA rows assume a perfect question-to-slot router (the question arrives structured), the baselines receive natural language."]
    return "\n".join(out)


if __name__ == "__main__":
    print(render(load(sys.argv[1:])))
