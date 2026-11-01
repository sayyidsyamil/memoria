"""Tables and a chart from the scaling experiment's JSON files.

    python3 -m memoria_engine.evaluation.scaling_report --memoria results/scaling_memoria_test.json \\
        --baselines results/scaling_baselines_test.json --select "full-context,bm25-rag(k=6)" --svg results/scaling_test.svg
"""
from __future__ import annotations

import argparse
import json
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import metrics

MEMORIA_ROWS = (("ext+router", "Memoria (LLM extractor + LLM router)"),
                ("ext+oracle_route", "Memoria, oracle router (extraction errors only)"),
                ("oracle_ext+router", "Memoria, oracle extractor (routing errors only)"))
COLOURS = ["#1f6feb", "#d1242f", "#1a7f37", "#9a6700", "#8250df", "#57606a"]


def pct(x: Optional[float]) -> str:
    return "n/a" if x is None else f"{100 * x:.0f}%"


def fmt_p(p: float) -> str:
    return "<0.001" if p < 0.001 else f"{p:.3f}"


def cell(qa: Dict[str, Any]) -> str:
    o = qa["overall"]
    return f"{pct(o['accuracy'])} [{100 * o['ci_95'][0]:.0f}-{100 * o['ci_95'][1]:.0f}] ({o['correct']}/{o['n']})"


def levels(*reports: Dict[str, Any]) -> List[str]:
    keys = set.intersection(*(set(r["levels"]) for r in reports)) if reports else set()
    return sorted(keys, key=int)


def baseline_items(report: Dict[str, Any], level: str, name: str) -> List[Dict[str, Any]]:
    return report["levels"][level]["systems"][name]["items"]


def memoria_flags(report: Dict[str, Any], level: str, combo: str) -> Dict[Tuple[str, str], bool]:
    return {(r["chain"], r["qid"]): r["answers"][combo]["correct"] for r in report["levels"][level]["rows"]}


def paired(a: Dict[Tuple[str, str], bool], b: Dict[Tuple[str, str], bool]) -> Dict[str, Any]:
    keys = sorted(a)
    return metrics.paired_sign_test([a[k] for k in keys], [b[k] for k in keys])


def render(memoria: Dict[str, Any], baseline_reports: Sequence[Dict[str, Any]], selected: Sequence[str]) -> str:
    lv = levels(memoria, *baseline_reports)
    cfg = memoria["config"]
    names: List[str] = []
    for br in baseline_reports:
        for n in br["levels"][lv[0]]["systems"]:
            if n not in names:
                names.append(n)
    systems = {n: next(br for br in baseline_reports if n in br["levels"][lv[0]]["systems"]) for n in names}
    out = [f"Split `{cfg['split']}` ({', '.join(cfg['chains'])}; {cfg['questions']} questions), model {cfg['model']}, extractor `{cfg['extractor']}` "
           f"(prompt {cfg['extractor_prompt']} {cfg['extractor_prompt_sha256_12']}), router prompt {cfg['router_prompt']}, filler generator {cfg['generator']} seed {cfg['padding_seed']}. "
           f"Data {cfg['data_sha256_12']}, wording {cfg['ask_sha256_12']}. Run {cfg['date']}.", ""]
    header = "| System | " + " | ".join(f"K={k}" for k in lv) + " |"
    rule = "|---|" + "---|" * len(lv)
    sizes = [str(round(baseline_reports[0]["levels"][k]["systems"][names[0]]["mean_prompt_tokens"])) if baseline_reports and names else "-" for k in lv]
    out += ["### Question answering accuracy as the history grows (exact match; Wilson 95% interval)", "", header, rule,
            "| Meetings per chain (mean) | " + " | ".join(str(round(sum(s["meetings"] for s in memoria["levels"][k]["shape"].values()) / len(memoria["levels"][k]["shape"]), 1)) for k in lv) + " |",
            "| Tracked objects per chain (mean) | " + " | ".join(str(round(sum(s["objects"] for s in memoria["levels"][k]["shape"].values()) / len(memoria["levels"][k]["shape"]), 1)) for k in lv) + " |",
            "| Full-context prompt tokens (mean) | " + " | ".join(sizes) + " |"]
    for combo, label in MEMORIA_ROWS:
        out.append(f"| {label} | " + " | ".join(cell(memoria["levels"][k]["qa"][combo]) for k in lv) + " |")
    for n in names:
        star = " *" if n in selected else ""
        out.append(f"| {n}{star} | " + " | ".join(cell(systems[n]["levels"][k]["systems"][n]["qa"]) for k in lv) + " |")
    out += ["", "`*` = configuration chosen on the dev chains before any test run (rule fixed in advance).", ""]

    out += ["### Paired comparison on the same questions (exact sign test; only discordant questions matter)", "",
            "| K | Memoria vs | Memoria only right | Baseline only right | Both right | Neither | p (two-sided) |", "|---|---|---|---|---|---|---|"]
    for k in lv:
        mine = memoria_flags(memoria, k, "ext+router")
        for n in names:
            theirs = {(i["chain"], i["qid"]): i["correct"] for i in baseline_items(systems[n], k, n)}
            if set(theirs) != set(mine):
                continue
            t = paired(mine, theirs)
            out.append(f"| {k} | {n}{' *' if n in selected else ''} | {t['a_only']} | {t['b_only']} | {t['both']} | {t['neither']} | {fmt_p(t['p_two_sided'])} |")
    out += ["", "Exploratory: many comparisons, no multiple-comparison correction; n is small.", ""]

    out += ["### By question type (Memoria end to end vs the selected baselines)", "", "| System | K | current | as_of_valid | as_of_tx | n_changes |", "|---|---|---|---|---|---|"]
    for k in dict.fromkeys((lv[0], lv[-1])):
        rows = [("Memoria (LLM + router)", memoria["levels"][k]["qa"]["ext+router"])] + \
               [(n, systems[n]["levels"][k]["systems"][n]["qa"]) for n in names if n in selected]
        for label, qa in rows:
            out.append(f"| {label} | {k} | " + " | ".join(
                f"{pct(qa[t]['accuracy'])} ({qa[t]['correct']}/{qa[t]['n']})" if t in qa else "-" for t in ("current", "as_of_valid", "as_of_tx", "n_changes")) + " |")

    cot = [n for n in names if n in selected and n.endswith("+cot")]
    if cot:
        cap = max((br["config"].get("cot_max_tokens") or 0 for br in baseline_reports), default=0)
        out += ["", f"### Chain-of-thought answers that ran into the {cap}-token budget (no final answer line; scored as parsed)", "",
                "| System | " + " | ".join(f"K={k}" for k in lv) + " |", rule]
        for n in cot:
            cells = []
            for k in lv:
                items = systems[n]["levels"][k]["systems"][n]["items"]
                hit = [i for i in items if (i.get("output_tokens") or 0) >= cap]
                cells.append(f"{len(hit)}/{len(items)} ({sum(i['correct'] for i in hit)} right)")
            out.append(f"| {n} | " + " | ".join(cells) + " |")

    out += ["", "### Router (natural-language question to ledger lookup)", "", "| K | Exact route | Failed to parse | Prompt tokens (mean) | Seconds / question (mean) |", "|---|---|---|---|---|"]
    for k in lv:
        r = memoria["levels"][k]["router"]
        out.append(f"| {k} | {r['exact']}/{r['n']} | {r['failed']} | {r['mean_prompt_tokens']} | {r['mean_seconds']} |")
    misses = [(k, r) for k in lv for r in memoria["levels"][k]["rows"] if not r["route_exact"]]
    if misses:
        out += ["", "Routing misses:", ""]
        for k, r in misses[:12]:
            out.append(f"- K={k} {r['chain']}.{r['qid']} ({r['type']}): \"{r['question']}\" -> {r['route']['type']} {r['route']['object_id']}.{r['route']['attribute']} "
                       f"valid={r['route']['valid_at']} tx={r['route']['tx_at']} {r['route']['reason']}")

    out += ["", "### What the ledger holds as the history grows", "",
            "| K | Extraction F1 on the original meetings | P / R | Extraction F1 on filler | Base slots: final state correct | Base slots: supersession F1 | All slots: final state correct | Distractor turns that became events (original) |",
            "|---|---|---|---|---|---|---|---|"]
    for k in lv:
        L = memoria["levels"][k]
        eb, ef, lb, la = L["extraction_base"], L["extraction_filler"], L["ledger_base"], L["ledger_all"]
        out.append(f"| {k} | {pct(eb['f1'])} | {pct(eb['precision'])} / {pct(eb['recall'])} | {pct(ef['f1']) if ef else '-'} | "
                   f"{lb['state_correct']}/{lb['state_gold']} | {pct(lb['supersession_f1'])} | {la['state_correct']}/{la['state_gold']} | {pct(eb['distractor_hit_rate'])} |")

    out += ["", "### Cost", "",
            "| K | Memoria: extraction s / meeting | Memoria: extraction prompt tokens | Memoria: ingestion total (s) | Memoria: router s / question | " +
            " | ".join(f"{n}: s / question (median)" for n in names if n in selected) + " |",
            "|---|---|---|---|---|" + "---|" * len([n for n in names if n in selected])]
    for k in lv:
        c = memoria["levels"][k]["cost"]
        extra = " | ".join(str(systems[n]["levels"][k]["systems"][n]["median_seconds"]) for n in names if n in selected)
        out.append(f"| {k} | {c['extract_seconds_per_meeting']} | {c['extract_prompt_tokens_mean']} | {c['extract_seconds_total']} | {memoria['levels'][k]['router']['mean_seconds']} | {extra} |")
    out += ["", "Memoria pays at ingestion (once per meeting); the baselines pay at every question. Seconds are the generation times recorded when each call was first made on this machine.",
            "", "Not shown by this experiment: real speech, real meeting series (hundreds of meetings), open-world item discovery (the registry is given), or questions that need information outside the ledger.",
            "The filler is template-written, so it is more regular than real text and easier to extract; it tests length and crowding, not language understanding."]
    return "\n".join(out)


def render_phrasing(primary: Dict[str, Any], alt: Dict[str, Any]) -> str:
    """Router robustness: the same questions in a second phrasing, with extraction unchanged (same chains, same extractor calls)."""
    lv = levels(primary, alt)
    out = [f"### Second phrasing of every question (wording {alt['config']['ask_sha256_12']} vs {primary['config']['ask_sha256_12']}; extraction identical, only the router sees new text)", "",
           "| K | Exact route: first / second phrasing | Memoria end to end: first / second phrasing | Perfect extractor + router: first / second phrasing |", "|---|---|---|---|"]
    for k in lv:
        p, a = primary["levels"][k], alt["levels"][k]
        o = lambda L, c: f"{L['qa'][c]['overall']['correct']}/{L['qa'][c]['overall']['n']}"
        out.append(f"| {k} | {p['router']['exact']}/{p['router']['n']} / {a['router']['exact']}/{a['router']['n']} | {o(p, 'ext+router')} / {o(a, 'ext+router')} | "
                   f"{o(p, 'oracle_ext+router')} / {o(a, 'oracle_ext+router')} |")
    seen, misses = set(), []
    for k in lv:
        for r in alt["levels"][k]["rows"]:
            if not r["route_exact"] and (r["chain"], r["qid"]) not in seen:
                seen.add((r["chain"], r["qid"]))
                misses.append(f"- {r['chain']}.{r['qid']} ({r['type']}, first missed at K={k}): \"{r['question']}\" -> {r['route']['type']} {r['route']['object_id']}.{r['route']['attribute']} "
                              f"valid={r['route']['valid_at']} tx={r['route']['tx_at']}")
    if misses:
        out += ["", f"Questions the router missed under the second phrasing, at any K ({len(misses)}):", ""] + misses
    return "\n".join(out)


def chart(memoria: Dict[str, Any], baseline_reports: Sequence[Dict[str, Any]], selected: Sequence[str], title: str) -> str:
    lv = levels(memoria, *baseline_reports)
    series: List[Tuple[str, List[Tuple[float, float, float]]]] = []

    def points(pairs: Sequence[Tuple[str, Dict[str, Any]]]) -> List[Tuple[float, float, float]]:
        return [(int(k), q["overall"]["accuracy"], q["overall"]["ci_95"]) for k, q in pairs]

    series.append(("Memoria (LLM extractor + LLM router)", [(x, y, ci) for x, y, ci in points([(k, memoria["levels"][k]["qa"]["ext+router"]) for k in lv])]))
    for n in selected:
        src = next((br for br in baseline_reports if n in br["levels"][lv[0]]["systems"]), None)
        if src:
            series.append((n, points([(k, src["levels"][k]["systems"][n]["qa"]) for k in lv])))
    W, H, L, R, T, B = 760, 430, 62, 190, 46, 58
    xs = [int(k) for k in lv]
    X = lambda v: L + (W - L - R) * (xs.index(int(v)) / max(1, len(xs) - 1))
    Y = lambda v: T + (H - T - B) * (1 - v)
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="Helvetica, Arial, sans-serif" font-size="12">',
           f'<rect width="{W}" height="{H}" fill="white"/>', f'<text x="{L}" y="26" font-size="15" font-weight="bold">{title}</text>']
    for g in (0, 0.25, 0.5, 0.75, 1.0):
        svg.append(f'<line x1="{L}" y1="{Y(g):.1f}" x2="{W - R}" y2="{Y(g):.1f}" stroke="#d0d7de"/><text x="{L - 8}" y="{Y(g) + 4:.1f}" text-anchor="end">{int(g * 100)}%</text>')
    for k in xs:
        svg.append(f'<text x="{X(k):.1f}" y="{H - B + 20}" text-anchor="middle">{k}</text>')
    svg.append(f'<text x="{(L + W - R) / 2:.1f}" y="{H - 14}" text-anchor="middle">filler meetings added per chain (K)</text>')
    svg.append(f'<text x="16" y="{(T + H - B) / 2:.0f}" transform="rotate(-90 16 {(T + H - B) / 2:.0f})" text-anchor="middle">accuracy (95% Wilson interval)</text>')
    for i, (label, pts) in enumerate(series):
        colour = COLOURS[i % len(COLOURS)]
        dx = (i - (len(series) - 1) / 2) * 5
        svg.append(f'<polyline fill="none" stroke="{colour}" stroke-width="2.2" points="' + " ".join(f"{X(x) + dx:.1f},{Y(y):.1f}" for x, y, _ in pts) + '"/>')
        for x, y, (lo, hi) in pts:
            svg.append(f'<line x1="{X(x) + dx:.1f}" y1="{Y(lo):.1f}" x2="{X(x) + dx:.1f}" y2="{Y(hi):.1f}" stroke="{colour}" stroke-width="1.4" opacity="0.55"/>'
                       f'<circle cx="{X(x) + dx:.1f}" cy="{Y(y):.1f}" r="4" fill="{colour}"/>')
        ly = T + 18 * i
        svg.append(f'<rect x="{W - R + 14}" y="{ly}" width="12" height="12" fill="{colour}"/><text x="{W - R + 32}" y="{ly + 11}">{label[:30]}</text>')
    svg.append("</svg>")
    return "\n".join(svg)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--memoria", required=True)
    ap.add_argument("--baselines", nargs="+", required=True)
    ap.add_argument("--select", default="", help="comma-separated baseline names chosen on dev")
    ap.add_argument("--alt", default="", help="Memoria JSON from the second question phrasing (adds a router-robustness section)")
    ap.add_argument("--svg", default="")
    args = ap.parse_args()
    memoria = json.load(open(args.memoria, encoding="utf-8"))
    bases = [json.load(open(p, encoding="utf-8")) for p in args.baselines]
    selected = [s for s in args.select.split(",") if s]
    print(render(memoria, bases, selected))
    if args.alt:
        print("\n" + render_phrasing(memoria, json.load(open(args.alt, encoding="utf-8"))))
    if args.svg:
        open(args.svg, "w", encoding="utf-8").write(chart(memoria, bases, selected, f"QA accuracy vs history length ({memoria['config']['split']} chains)"))


if __name__ == "__main__":
    main()
