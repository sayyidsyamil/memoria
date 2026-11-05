"""Chapter 6 artifacts: the tables as LaTeX and Markdown, M2's confusion matrix, the statistical summary, a manifest.

Everything is rebuilt from results/predictions_raw.jsonl (and the worker records beside it), so nothing here can drift
from the run: the numbers in a table are computed by eval_metrics.py, the tests by stat_tests.py, and this file only sets
them. No table carries a hard-coded number such as "Table 6.1": the existing Chapter 6 already uses 6.1 to 6.17, so
the LaTeX labels are tab:memoriabench-*, and the thesis should number them in place.

Written to results/:
    chapter_6_table_1.tex / .md     the four systems and the two extra rows (B1b, A1) on all the probes, with bold best scores
    chapter_6_table_1b.tex / .md    the same on the official AMI unseen subset (its five series)
    chapter_6_table_2.tex / .md     recall by gold class, with OUTDATED split into real and synthetic probes
    chapter_6_table_3.tex / .md     M2 against each other system: the paired tests
    confusion_matrix_m2.txt         where M2 put each of the probes
    statistical_summary.txt         the numbers, the tests, and what they do and do not show
    results_manifest.sha256         SHA-256 of the data, the results, the exports and the code, written after the run

Run: python3.11 export_thesis_tables.py      (needs results/predictions_raw.jsonl; LaTeX needs the booktabs package)
"""

import hashlib
import json
import math
import re
import sys
from pathlib import Path

import eval_metrics as E
import stat_tests as T

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
DATA = HERE / "data"
ORDER = ("B0", "B1", "B1b", "B2", "M2", "A1")
TEX_NAMES = {
    "B0": "B0 Closed book",
    "B1": r"B1 Embeddings, alert if similarity $\ge \tau$",
    "B1b": "B1b Embeddings, three bands",
    "B2": "B2 Transcript RAG",
    "M2": "M2 Full Memoria (proposed)",
    "A1": "A1 M2 without supersession notes",
}
MD_NAMES = {**TEX_NAMES, "B1": "B1 Embeddings, alert if similarity ≥ τ"}
# column key, TeX head, Markdown head, True when a higher score is better, formatter
COLUMNS = [
    ("accuracy", r"Acc.\ (\%)", "Acc. (%)", True, lambda v: f"{100 * v:.1f}"),
    ("macro_f1", "Macro-F1", "Macro-F1", True, lambda v: f"{v:.2f}"),
    ("alert_precision", "Alert prec.", "Alert prec.", True, lambda v: f"{v:.2f}"),
    ("alert_recall", "Alert rec.", "Alert rec.", True, lambda v: f"{v:.2f}"),
    ("false_alarm", r"False alarm (\%)", "False alarm (%)", False, lambda v: f"{100 * v:.1f}"),
    ("p50_ms", "P50 (ms)", "P50 (ms)", False, lambda v: f"{v:,.0f}"),
    ("p95_ms", "P95 (ms)", "P95 (ms)", False, lambda v: f"{v:,.0f}"),
    ("peak_gb", "Mem. (GB)", "Mem. (GB)", False, lambda v: f"{v:.1f}"),
]
TEX_ESCAPES = {"&": r"\&", "%": r"\%", "_": r"\_", "#": r"\#", ">": r"\textgreater{}", "<": r"\textless{}"}


# --- setting a table ------------------------------------------------------------------------------------

def tex_escape(text: str) -> str:
    return "".join(TEX_ESCAPES.get(ch, ch) for ch in text)


def best_values(summaries: dict[str, dict]) -> dict[str, str]:
    """Per column, the best displayed value (highest, or lowest where lower is better). Ties are all best: a row is
    never made to look better than another that shows the same number."""
    best = {}
    for key, _, _, higher, fmt in COLUMNS:
        shown = {s: fmt(v[key]) for s, v in summaries.items() if v.get(key) is not None and not math.isnan(v[key])}
        if shown:
            numeric = {s: float(text.replace(",", "")) for s, text in shown.items()}
            target = max(numeric.values()) if higher else min(numeric.values())
            best[key] = next(shown[s] for s in shown if numeric[s] == target)
    return best


def cells(summaries: dict[str, dict], style: str, intervals: bool) -> list[list[str]]:
    """The table's body: one list of strings per system. style is "tex" or "md"."""
    best = best_values(summaries)
    rows = []
    for system in [s for s in ORDER if s in summaries]:
        s = summaries[system]
        row = [(tex_escape(TEX_NAMES[system]) if style == "tex" else MD_NAMES[system])]
        for key, _, _, _, fmt in COLUMNS:
            value = s.get(key)
            if value is None or (isinstance(value, float) and math.isnan(value)):
                row.append("--" if style == "tex" else "n/a")
                continue
            text = fmt(value)
            if style == "tex":
                text = text.replace(",", "{,}")
            top = best.get(key) == fmt(value)
            text = (f"\\textbf{{{text}}}" if top else text) if style == "tex" else (f"**{text}**" if top else text)
            if key == "macro_f1" and intervals and "ci" in s:  # the interval is never bold: it is not the score
                lo, hi = s["ci"]["macro_f1"]
                text += f" {{\\scriptsize [{lo:.2f}, {hi:.2f}]}}" if style == "tex" else f" [{lo:.2f}, {hi:.2f}]"
            row.append(text)
        rows.append(row)
    return rows


def tex_p(text: str) -> str:
    """p-values for LaTeX: '<= 0.0001' as a symbol, '1.6e-15' as a power of ten."""
    return re.sub(r"(\d(?:\.\d+)?)e-0*(\d+)", r"$\1\\times10^{-\2}$", text.replace("<= ", r"$\le$ "))


def tex_table(label: str, caption: str, heads: list[str], body: list[list[str]], rule_before: set[str] | None = None, align: str | None = None) -> str:
    align = align or "l" + "r" * (len(heads) - 1)
    lines = [r"\begin{table}[tbp]", r"\centering", r"\small", f"\\caption{{{caption}}}", f"\\label{{{label}}}", f"\\begin{{tabular}}{{@{{}}{align}@{{}}}}", r"\toprule",
             " & ".join(heads) + r" \\", r"\midrule"]
    for row in body:
        if rule_before and any(row[0].startswith(tex_escape(prefix)) for prefix in rule_before):
            lines.append(r"\midrule")
        lines.append(" & ".join(row) + r" \\")
    lines += [r"\bottomrule", r"\end{tabular}", r"\end{table}"]
    return "\n".join(lines) + "\n"


def md_table(title: str, heads: list[str], body: list[list[str]], note: str) -> str:
    lines = [f"**{title}**", "", "| " + " | ".join(heads) + " |", "|" + "|".join([":--"] + ["--:"] * (len(heads) - 1)) + "|"]
    lines += ["| " + " | ".join(row) + " |" for row in body]
    return "\n".join(lines) + f"\n\n{note}\n"


# --- the four tables --------------------------------------------------------------------------------------

def summaries_for(predictions: list[dict], meta: dict, keep) -> dict[str, dict]:
    out = {}
    for system in ORDER:
        rows = [p for p in predictions if p["system"] == system and keep(p)]
        if rows:
            out[system] = E.summarise(rows, (meta.get(system) or {}).get("peak_gb"), intervals=len(rows) >= 300)
    return out


def main_tables(predictions: list[dict], meta: dict, subset: bool) -> tuple[str, str]:
    keep = (lambda p: p["series_id"] in E.OFFICIAL_SUBSET) if subset else (lambda p: True)
    summaries = summaries_for(predictions, meta, keep)
    n = next(iter(summaries.values()))["n"]
    series = len({p["series_id"] for p in predictions if keep(p)})
    scope = (f"the official AMI unseen subset ({n} probes in {series} series: {', '.join(E.OFFICIAL_SUBSET)})" if subset else f"MemoriaBench ({n} probes in {series} AMI test series)")
    note = ("An alert is a predicted OUTDATED or CONTRADICTS; a false alarm is an alert on a probe that is not one. P50 and P95 are warm, per probe, "
            "on an Apple M5 with 16 GB; memory is the peak physical footprint of the process. M2 and A1 read the annotators' decisions, B2 the raw transcript. "
            + (f"Point estimates only: {series} series are too few for an interval." if subset else f"Brackets: 95% cluster-bootstrap interval, resampling the {series} series."))
    heads_tex = ["System"] + [c[1] for c in COLUMNS]
    heads_md = ["System"] + [c[2] for c in COLUMNS]
    caption = f"Results on {scope}. Bold marks the best value in a column (ties are all marked). " + tex_escape(note)
    label = "tab:memoriabench-unseen" if subset else "tab:memoriabench-main"
    tex = tex_table(label, caption, heads_tex, cells(summaries, "tex", not subset), rule_before={"M2"})
    md = md_table(f"Results on {scope}", heads_md, cells(summaries, "md", not subset), "Bold marks the best value in a column (ties are all marked). " + note)
    return tex, md


def class_tables(predictions: list[dict], basis: dict[str, str]) -> tuple[str, str]:
    probes = [p for p in predictions if p["system"] == "M2"]
    n_real = sum(p["gold_label"] == "OUTDATED" and basis.get(p["id"]) == "real-supersession" for p in probes)
    n_synthetic = sum(p["gold_label"] == "OUTDATED" and basis.get(p["id"]) == "synthetic-supersession" for p in probes)
    columns = [("SUPPORTED_CURRENT", "Supported"), ("OUTDATED", "Outdated"), ("OUT-real", rf"\quad real ({n_real})"), ("OUT-syn", rf"\quad synthetic ({n_synthetic})"), ("CONTRADICTS", "Contradicts"),
               ("UPDATES", "Updates"), ("IRRELEVANT", "Irrelevant"), ("INSUFFICIENT_EVIDENCE", "Insufficient")]
    recalls = {}
    for system in ORDER:
        rows = [p for p in predictions if p["system"] == system]
        if rows:
            recalls[system] = {**E.scores(E.confusion_matrix(rows))["class_recall"], **E.outdated_recalls(rows, basis)}
    best = {key: max((r[key] for r in recalls.values() if not math.isnan(r.get(key, math.nan))), default=None) for key, _ in columns}

    def row(system: str, style: str) -> list[str]:
        out = [tex_escape(TEX_NAMES[system]) if style == "tex" else MD_NAMES[system]]
        for key, _ in columns:
            v = recalls[system].get(key, math.nan)
            if math.isnan(v):
                out.append("--" if style == "tex" else "n/a")
                continue
            text = f"{100 * v:.1f}"
            top = best[key] is not None and round(100 * v, 1) == round(100 * best[key], 1)
            out.append((f"\\textbf{{{text}}}" if top else text) if style == "tex" else (f"**{text}**" if top else text))
        return out

    note = ("Recall by gold class, in percent: how often the class was found among the probes that belong to it. The OUTDATED probes are shown whole and split by what "
            f"founds them: {n_real} rest on a decision the annotators replaced, {n_synthetic} on a synthetic replacement note. Bold marks the best value in a column.")
    heads_tex = ["System"] + [label.replace("\\quad ", "\\hspace{1em}") for _, label in columns]
    heads_md = ["System"] + [label.replace("\\quad ", "↳ ") for _, label in columns]
    tex = tex_table("tab:memoriabench-classes", f"Recall by gold class on MemoriaBench ({len(probes)} probes). " + tex_escape(note), heads_tex, [row(s, "tex") for s in recalls], {"M2"})
    md = md_table(f"Recall by gold class on MemoriaBench ({len(probes)} probes)", heads_md, [row(s, "md") for s in recalls], note)
    return tex, md


def test_tables(result: dict) -> tuple[str, str]:
    heads_tex = ["M2 against", r"$\Delta$ Macro-F1 [95\% CI]", "$b$ / $c$", r"McNemar $p$ (Holm)", "Series won / lost / tied", r"Series sign $p$", r"Permutation $p$"]
    heads_md = ["M2 against", "Δ Macro-F1 [95% CI]", "b / c", "McNemar p (Holm)", "Series won / lost / tied", "Series sign p", "Permutation p (series)"]
    tex_rows, md_rows = [], []
    for rival, c in result["comparisons"].items():
        m, s, perm = c["mcnemar_alert"], c["series_sign_alert"], c["permutation_series"]
        delta, lo, hi = c["paired_bootstrap"]["macro_f1"]
        cell = {"delta": f"{delta:+.2f} [{lo:+.2f}, {hi:+.2f}]", "bc": f"{m['only_first']} / {m['only_second']}", "mc": f"{T.p_text(m['exact_p'])} ({T.p_text(c['holm_p'])})",
                "series": f"{s['first_better']} / {s['second_better']} / {s['tied']}", "sign": T.p_text(s["exact_p"]), "perm": T.p_text(perm["p"], perm["resamples"])}
        tex_rows.append([tex_escape(TEX_NAMES[rival]), cell["delta"], cell["bc"], tex_p(cell["mc"]), cell["series"], tex_p(cell["sign"]), tex_p(cell["perm"])])
        md_rows.append([MD_NAMES[rival], cell["delta"], cell["bc"], cell["mc"], cell["series"], cell["sign"], cell["perm"].replace("<=", "≤")])
    note = ("Every system answered the same probes. McNemar: exact two-sided test on whether the alert decision was right; b = only M2 right, c = only the other system right; "
            f"in brackets the Holm-adjusted p over these {len(result['comparisons'])} comparisons. Series: in how many of the {result['series']} series M2 was right on more, fewer, or as many probes; exact sign test. "
            f"Permutation: Macro-F1 difference, {result['resamples']:,} resamples that swap the two systems' answers series by series (the smallest p it can give is 1/{result['resamples'] + 1:,}). "
            "Probes of a series share one memory, so the series-level tests are the ones to cite; the probe-level p-values are optimistic. All exploratory.")
    tex = tex_table("tab:memoriabench-tests", "Paired tests of M2 against each other system. " + tex_escape(note), heads_tex, tex_rows, align="lrrrrrr")
    md = md_table("Paired tests of M2 against each other system", heads_md, md_rows, note)
    return tex, md


# --- the confusion matrix ------------------------------------------------------------------------------------

def confusion_text(predictions: list[dict], system: str = "M2") -> tuple[str, dict]:
    rows = [p for p in predictions if p["system"] == system]
    matrix = E.confusion_matrix(rows)
    short = ["SUPP", "OUTD", "CONT", "UPDA", "IRRE", "INSU"]
    dominant = [bool(matrix[i, i] == matrix[i].max()) for i in range(len(E.CLASSES))]
    corner = "gold \\ predicted"
    lines = [f"Confusion matrix of {system} on MemoriaBench ({len(rows)} probes): rows are the gold class, columns what {system} predicted.", "",
             f"{corner:<24}" + "".join(f"{s:>7}" for s in short) + f"{'total':>8}{'recall':>9}", "-" * 80]
    recall = lambda i: f"{matrix[i, i] / matrix[i].sum():.1%}" if matrix[i].sum() else "n/a"
    precision = lambda j: f"{matrix[j, j] / matrix[:, j].sum():.2f}" if matrix[:, j].sum() else "n/a"
    for i, name in enumerate(E.CLASSES):
        lines.append(f"{name:<24}" + "".join(f"{int(matrix[i, j]):>7}" for j in range(len(E.CLASSES))) + f"{int(matrix[i].sum()):>8}{recall(i):>9}")
    lines += ["-" * 80, f"{'predicted total':<24}" + "".join(f"{int(matrix[:, j].sum()):>7}" for j in range(len(E.CLASSES))) + f"{int(matrix.sum()):>8}",
              f"{'precision':<24}" + "".join(f"{precision(j):>7}" for j in range(len(E.CLASSES))), ""]
    off = sorted(((int(matrix[i, j]), E.CLASSES[i], E.CLASSES[j]) for i in range(6) for j in range(6) if i != j and matrix[i, j]), reverse=True)
    wrong = int(matrix.sum() - sum(matrix[i, i] for i in range(len(E.CLASSES))))
    lines.append(f"Where the {wrong} wrong probes went (gold -> predicted, count):")
    lines += [f"  {n:>3}  {g} -> {p}" for n, g, p in off]
    alert = E.scores(matrix)
    lines += ["", f"Diagonal dominance: the diagonal is the largest entry of its row in {sum(dominant)} of 6 rows" + ("" if all(dominant) else f" (not in: {', '.join(c for c, d in zip(E.CLASSES, dominant) if not d)})") + ".",
              f"As alerts (a predicted OUTDATED or CONTRADICTS): caught {alert['tp']} of {alert['tp'] + alert['fn']} gold alerts, {alert['fp']} false alarm{'' if alert['fp'] == 1 else 's'} on {alert['fp'] + alert['tn']} probes that are not alerts.",
              f"OUTDATED and CONTRADICTS taken for each other: {int(matrix[1, 2] + matrix[2, 1])} of the {wrong} wrong probes (both are alerts, so the alert still fires and only the label differs)."]
    return "\n".join(lines) + "\n", {"dominant": dominant, "matrix": matrix.tolist()}


# --- the summary ------------------------------------------------------------------------------------------------

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summary_text(predictions: list[dict], meta: dict, result: dict, basis: dict[str, str], predictions_path: Path, bench_path: Path) -> str:
    full = summaries_for(predictions, meta, lambda p: True)
    sub = summaries_for(predictions, meta, lambda p: p["series_id"] in E.OFFICIAL_SUBSET)
    m2, ci = full["M2"], full["M2"]["ci"]
    b2, b1, a1 = (result["comparisons"][name] for name in ("B2", "B1", "A1"))
    alpha, floor = result["alpha"], 1 / (result["resamples"] + 1)
    m2_rows = [p for p in predictions if p["system"] == "M2"]
    a1_rows = [p for p in predictions if p["system"] == "A1"]
    outdated = lambda rows, kind: [p for p in rows if p["gold_label"] == "OUTDATED" and basis.get(p["id"]) == kind]
    found = lambda rows: f"{sum(p['pred'] == 'OUTDATED' for p in rows)} of {len(rows)}"
    real, synthetic = outdated(m2_rows, "real-supersession"), outdated(m2_rows, "synthetic-supersession")
    cited = [p for p in m2_rows if p["expected_alert"] and p["alert"]]
    exact = sum(p["citation"] == p["gold_citation"] for p in cited)
    sub_series = len({p["series_id"] for p in m2_rows if p["series_id"] in E.OFFICIAL_SUBSET})
    pt = lambda test: T.p_text(test["exact_p"])
    out = ["MEMORIABENCH: STATISTICAL SUMMARY", "=" * 34, "",
           f"Predictions: results/predictions_raw.jsonl (sha256 {sha256(predictions_path)[:16]}...); benchmark sha256 {sha256(bench_path)[:16]}...",
           f"Tests: stat_tests.py, seed {result['seed']}, {result['resamples']:,} resamples, alpha {alpha}. Nothing in this file is asserted: each number is computed from the predictions.", "",
           f"1. HEADLINE ({result['probes']} probes, {result['series']} series)", "-" * 34,
           f"M2 (Full Memoria): Macro-F1 {m2['macro_f1']:.2f} [{ci['macro_f1'][0]:.2f}, {ci['macro_f1'][1]:.2f}], accuracy {m2['accuracy']:.1%}, alert precision {m2['alert_precision']:.2f} [{ci['alert_precision'][0]:.2f}, {ci['alert_precision'][1]:.2f}],"
           f" alert recall {m2['alert_recall']:.2f} [{ci['alert_recall'][0]:.2f}, {ci['alert_recall'][1]:.2f}], false alarms {m2['fp']} of {m2['fp'] + m2['tn']} non-conflicts ({m2['false_alarm']:.1%}).",
           f"Official AMI unseen subset ({sub['M2']['n']} probes, {sub_series} series; no interval): Macro-F1 {sub['M2']['macro_f1']:.2f}, alert precision {sub['M2']['alert_precision']:.2f}, alert recall {sub['M2']['alert_recall']:.2f}, false alarm {sub['M2']['false_alarm']:.1%}.",
           f"Time and memory on the Apple M5 (16 GB), warm, per probe: P50 {m2['p50_ms']:,.0f} ms, P95 {m2['p95_ms']:,.0f} ms; peak footprint {m2['peak_gb']:.1f} GB.",
           "The AP2 report sets no speed target (requirement NFR10: \"No speed target is set\"), so these times are measurements, not a pass against a target.", "",
           "2. THE TESTS", "-" * 34, T.describe(result), "",
           "3. WHAT THE TESTS SAY, AND WHAT THEY DO NOT", "-" * 34]

    m, sg, perm, misses, fa = b2["mcnemar_alert"], b2["series_sign_alert"], b2["permutation_series"], b2["mcnemar_misses"], b2["mcnemar_false_alarms"]
    often = "more often" if m["only_first"] > m["only_second"] else ("less often" if m["only_first"] < m["only_second"] else "as often")
    out.append(f"- M2 against B2 (transcript RAG): the alert decision is right {often} for M2 (b={m['only_first']}, c={m['only_second']}; exact p {pt(m)}; by series {sg['first_better']} won, {sg['second_better']} lost; p {pt(sg)}), "
               f"and the Macro-F1 difference is {perm['observed']:+.2f} (permutation by series p {T.p_text(perm['p'], perm['resamples'])}). "
               f"On the gold alerts only M2 right {misses['only_first']}, only B2 right {misses['only_second']} (p {pt(misses)}).")
    rate_m2, rate_b2 = b2["rates"]["first"]["false_alarm"], b2["rates"]["second"]["false_alarm"]
    counts = f"only M2 quiet {fa['only_first']}, only B2 quiet {fa['only_second']}"
    if fa["exact_p"] >= alpha:
        out.append(f"- It is NOT a significant difference in false alarms: M2 raised {rate_m2:.1%} and B2 {rate_b2:.1%} ({counts}; exact p {pt(fa)}). Do not write that Memoria raises fewer false alarms than transcript RAG.")
    elif rate_m2 < rate_b2:
        out.append(f"- Fewer false alarms as well: M2 raised {rate_m2:.1%} and B2 {rate_b2:.1%} ({counts}; exact p {pt(fa)}).")
    else:
        out.append(f"- M2 raised MORE false alarms than B2 ({rate_m2:.1%} against {rate_b2:.1%}; {counts}; exact p {pt(fa)}). Say so.")

    fa1, miss1 = b1["mcnemar_false_alarms"], b1["mcnemar_misses"]
    rate1_m2, rate1_b1 = b1["rates"]["first"]["false_alarm"], b1["rates"]["second"]["false_alarm"]
    sure = lambda test: "significant" if test["exact_p"] < alpha else "not significant"
    line = (f"- M2 against B1 (embeddings only): false alarms {rate1_b1:.1%} -> {rate1_m2:.1%} (exact p {pt(fa1)}, {sure(fa1)}). "
            f"Alert recall: on the gold alerts only M2 right {miss1['only_first']}, only B1 right {miss1['only_second']}, p {pt(miss1)} ({sure(miss1)}).")
    if miss1["exact_p"] >= alpha and fa1["exact_p"] < alpha:
        line += f" An embedding threshold finds the conflicts about as well; the difference is in what else it flags: {rate1_b1:.0%} of the probes that are not conflicts."
    out.append(line)
    out.append(f"- The ablation A1 (M2 without supersession notes): alert decision p {pt(a1['mcnemar_alert'])}, Macro-F1 {a1['paired_bootstrap']['macro_f1'][0]:+.2f} "
               f"[{a1['paired_bootstrap']['macro_f1'][1]:+.2f}, {a1['paired_bootstrap']['macro_f1'][2]:+.2f}]. OUTDATED is found for {found(real)} real and {found(synthetic)} synthetic probes by M2, "
               f"and for {found(outdated(a1_rows, 'real-supersession'))} real and {found(outdated(a1_rows, 'synthetic-supersession'))} synthetic probes by A1.")
    out += [
        "",
        "Why the OUTDATED collapse is not a proof of the thesis: the old value of a synthetic probe exists nowhere in memory except in the note, so a system without the note cannot find it. "
        "The ablation shows that M2 uses the notes it is given. It does not show that write-time supersession is better than another way of keeping memory, and it does not test "
        "whether Memoria can write correct notes during a live meeting, because here the notes are supplied.",
        "",
        "How to read the p-values:",
        "- They say the differences are unlikely to be chance on these probes and series. The probes were generated by rule from the annotators' decisions, not drawn at random from live speech, so no p-value here covers live speech.",
        "- M2 reads the annotators' decisions (and the notes); B2 reads the raw transcript. The comparison measures auditing clean approved memory against searching raw speech. It does not measure extraction of decisions from speech.",
        "- Probes of one series share one memory, so they are not independent. The probe-level McNemar p-values are therefore optimistic; cite the series-level tests (the sign test by series and the permutation test with series as the unit).",
        f"- A Monte-Carlo permutation p cannot be smaller than 1/({result['resamples']:,} + 1) = {floor:.4f}. Where no resample reached the observed difference the honest statement is p <= {floor:.4f}.",
        f"- Holm's correction is applied across the {len(result['comparisons'])} comparisons of M2 against another system. The tests against B2 and B1 were named in the plan before the results; the tests against B0, B1b and A1 were added afterwards and are exploratory. The existing Chapter 6 also calls its sign tests exploratory.",
        f"- Only {len(real)} OUTDATED probes rest on a real supersession: too few to say anything about natural supersession; the numbers for them are counts, not estimates.",
        f"- M2's citation is exactly the gold decision on {exact} of {len(cited)} true alerts ({exact / len(cited):.1%}).", "",
        "4. FILES", "-" * 34,
        "chapter_6_table_1.tex/.md (all systems), chapter_6_table_1b (official subset), chapter_6_table_2 (recall by class), chapter_6_table_3 (paired tests), confusion_matrix_m2.txt, stat_tests.json, results_manifest.sha256.",
        "The tables carry no table number: Chapter 6 already uses Table 6.1 to 6.17, so number them in place. The LaTeX needs \\usepackage{booktabs}.", ""]
    return "\n".join(out)


CODE = ("memoria.py", "run_benchmarks.py", "eval_metrics.py", "stat_tests.py", "export_thesis_tables.py", "generate_bench.py", "validate_bench.py", "ami_loader.py")


def write_manifest(path: Path, extra: list[Path], results: Path = RESULTS, data: Path = DATA) -> None:
    """SHA-256 of the data, the results, the exports and the code, one line each, in the format `shasum -a 256 -c` reads."""
    files = [*(data / name for name in ("memoria_bench.jsonl", "memoria_bench.provenance.jsonl", "memoria_bench_dev.jsonl")),
             *(results / name for name in ("predictions_raw.jsonl", "run_meta.json", "table_6_1.csv", "per_class.csv", "b1_thresholds.json", "stat_tests.json")), *extra,
             *(HERE / name for name in CODE)]

    def label(f: Path) -> str:
        for root in (HERE, results.parent):
            if f.is_relative_to(root):
                return str(f.relative_to(root))
        return f.name

    path.write_text("".join(f"{sha256(f)}  {label(f)}\n" for f in files if f.exists()), encoding="utf-8")


def export(results: Path = RESULTS, resamples: int = T.RESAMPLES, data: Path = DATA) -> list[Path]:
    predictions = E.load_predictions(results / "predictions_raw.jsonl")
    meta = E.load_meta(results / "_work")
    bench = data / "memoria_bench.jsonl"
    basis = {p["id"]: p["basis"] for p in map(json.loads, (data / "memoria_bench.provenance.jsonl").read_text(encoding="utf-8").splitlines()) if p.get("basis")}
    result = T.run(predictions, resamples)
    (results / "stat_tests.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    written = []

    def save(name: str, text: str) -> None:
        (results / name).write_text(text, encoding="utf-8")
        written.append(results / name)

    for stem, (tex, md) in (("chapter_6_table_1", main_tables(predictions, meta, False)), ("chapter_6_table_1b", main_tables(predictions, meta, True)),
                            ("chapter_6_table_2", class_tables(predictions, basis)), ("chapter_6_table_3", test_tables(result))):
        save(f"{stem}.tex", tex)
        save(f"{stem}.md", md)
    matrix_text, _ = confusion_text(predictions)
    save("confusion_matrix_m2.txt", matrix_text)
    save("statistical_summary.txt", summary_text(predictions, meta, result, basis, results / "predictions_raw.jsonl", bench))
    write_manifest(results / "results_manifest.sha256", written, results, data)
    written.append(results / "results_manifest.sha256")
    return written


def main(argv: list[str]) -> int:
    written = export()
    names = {p.name: p for p in written}
    print("[Thesis Artifacts Exported]")
    print(f"  ├── LaTeX Table:      results/chapter_6_table_1.tex (booktabs; also _1b, _2, _3)")
    print(f"  ├── Markdown Table:   results/chapter_6_table_1.md (also _1b, _2, _3)")
    print(f"  ├── Confusion Matrix: results/confusion_matrix_m2.txt")
    print(f"  ├── Statistics:       results/stat_tests.json, results/statistical_summary.txt")
    print(f"  └── Manifest:         results/results_manifest.sha256 ({len((RESULTS / 'results_manifest.sha256').read_text().splitlines())} files hashed, written after the run)")
    print("\n" + (RESULTS / "confusion_matrix_m2.txt").read_text())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
