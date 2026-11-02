"""Render the AMI real-data results as Markdown tables for report chapter 6.4.

    python3.11 scripts/ami/render_ami.py results/ami/memoria_test.json results/ami/baselines_test.json > results/ami/ami_test_report.md
"""
import json
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ENGINE))
from memoria_engine.evaluation.metrics import paired_sign_test  # noqa: E402

KEYS = (("overall", "All"), ("current", "Current"), ("as_of_valid", "As of a past date"), ("n_changes", "How many changes"))


def pct(x):
    return "-" if x is None else f"{100 * x:.0f}%"


def cell(qa, kind="overall"):
    c = qa.get(kind)
    if not c or not c["n"]:
        return "-"
    lo, hi = c["ci_95"]
    return f"{pct(c['accuracy'])} [{100 * lo:.0f}-{100 * hi:.0f}] ({c['correct']}/{c['n']})"


def fmt_p(p):
    return "<0.001" if p < 0.001 else f"{p:.3f}"


def main(mem_path, base_path):
    mem = json.loads(Path(mem_path).read_text())["memoria"]
    base_report = json.loads(Path(base_path).read_text()) if base_path and Path(base_path).exists() else None
    base = base_report["baselines"] if base_report else {}
    cfg = json.loads(Path(mem_path).read_text())["config"]
    out = [f"Split `{cfg['split']}` ({', '.join(cfg['chains'])}; {cfg['questions']} questions), model {cfg['model']}, windowed extraction ({cfg['window_chars']} characters per window), "
           f"extractor prompt {cfg['extractor_prompt']} {cfg['extractor_prompt_sha256_12']}, router prompt {cfg['router_prompt']}. Run {cfg['date']}.", ""]

    out += ["### Question answering on real meetings (exact match; Wilson 95% interval)", "",
            "| System | " + " | ".join(k[1] for k in KEYS) + " |", "|---|" + "---|" * len(KEYS)]
    label = {"ext+router": "Memoria (LLM extractor + LLM router)", "ext+oracle_route": "Memoria, oracle router (extraction errors only)",
             "oracle_ext+router": "Memoria, oracle extractor (routing errors only)"}
    for combo, name in label.items():
        out.append(f"| {name} | " + " | ".join(cell(mem["qa"][combo], k) for k, _ in KEYS) + " |")
    for name, b in base.items():
        out.append(f"| {name} | " + " | ".join(cell(b["qa"], k) for k, _ in KEYS) + " |")
    out.append("")

    if base:
        mflags = {(r["chain"], r["qid"]): r["answers"]["ext+router"]["correct"] for r in mem["rows"]}
        out += ["### Paired comparison on the same questions (exact sign test)", "",
                "| Memoria vs | Memoria only right | Baseline only right | Both right | Neither | p (two-sided) |", "|---|---|---|---|---|---|"]
        for name, b in base.items():
            bflags = {(i["chain"], i["qid"]): i["correct"] for i in b["items"]}
            keys = [k for k in mflags if k in bflags]
            t = paired_sign_test([mflags[k] for k in keys], [bflags[k] for k in keys])
            out.append(f"| {name} | {t['a_only']} | {t['b_only']} | {t['both']} | {t['neither']} | {fmt_p(t['p_two_sided'])} |")
        out += ["", "Exploratory: small n, no correction for multiple comparisons.", ""]

    e = mem["extraction"]
    lo = e["ci_95"]
    out += ["### Extraction of decisions from the real meetings", "",
            "| Gold events | Found (TP) | Missed (FN) | Extra (FP) | Precision | Recall | F1 |", "|---|---|---|---|---|---|---|",
            f"| {e['gold_events']} | {e['tp']} | {e['fn']} | {e['fp']} | {pct(e['precision'])} | {pct(e['recall'])} | {pct(e['f1'])} |", "",
            f"Bootstrap 95% interval over meetings: {json.dumps(lo)[:200]}.",
            "Gold lists only the decisions the human annotators wrote down for the tracked items, so an extra prediction may be a true statement nobody listed: precision is a lower bound.", "",
            f"Miss reasons: {e['miss_reasons']}. Extra-prediction reasons: {e['fp_reasons']}. Evidence on the exact gold turn: {pct(e['evidence_exact_turn'])} of found events (others inside the human-linked window).", ""]
    out += ["| Team | Gold | TP | FN | FP | Recall |", "|---|---|---|---|---|---|"]
    for team, a in mem["extraction_by_chain"].items():
        out.append(f"| {team} | {a['gold_events']} | {a['tp']} | {a['fn']} | {a['fp']} | {pct(a['recall'])} |")
    L = mem["ledger"]
    out += ["", f"Ledger state after the last meeting: {L['state_correct']}/{L['state_gold']} tracked items correct ({pct(L['state_accuracy'])}); invented items (nothing decided but the ledger holds a value): {L['phantom_beliefs']}. "
            f"Supersession links: TP {L['supersession_tp']}, FP {L['supersession_fp']}, FN {L['supersession_fn']}.", ""]

    r = mem["router"]
    out += ["### Router and cost", "", f"Question to ledger lookup: exact route {r['exact']}/{r['n']}, failed to parse {r['failed']}, {r['mean_seconds']} s and {r['mean_prompt_tokens']} prompt tokens per question.", "",
            "| System | Median s / question | Mean prompt tokens | Mean output tokens |", "|---|---|---|---|",
            f"| Memoria (ledger lookup, after ingestion) | {r['mean_seconds']} | {r['mean_prompt_tokens']} | - |"]
    for name, b in base.items():
        out.append(f"| {name} | {b['median_seconds']} | {b['mean_prompt_tokens']} | {b['mean_output_tokens']} |")
    c = mem["cost"]
    out += ["", f"Memoria pays once per meeting at ingestion: {c['extract_seconds_per_meeting']} s, {c['prompt_tokens_per_meeting']} prompt tokens and {c['windows_per_meeting']} windows per meeting on average ({c['meetings']} meetings, {c['extract_seconds_total']} s in total).", ""]

    wrong = [x for x in mem["rows"] if not x["answers"]["ext+router"]["correct"]]
    out += [f"### Where Memoria was wrong ({len(wrong)} of {len(mem['rows'])})", "", "| Team | Question | Gold | Memoria | Oracle extractor right? | Route exact? |", "|---|---|---|---|---|---|"]
    for x in wrong[:60]:
        a = x["answers"]
        out.append(f"| {x['chain']} | {x['question'][:70]} | {x['gold']} | {a['ext+router']['answer']} | {'yes' if a['oracle_ext+router']['correct'] else 'no'} | {'yes' if x['route_exact'] else 'no'} |")
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
