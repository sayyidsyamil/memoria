"""The analysis of the topic-scoping experiment: every endpoint of scoping.py, computed from the predictions, nothing asserted.

    python3.11 scoping_report.py [--no-sweep]

Reads results/scoping/_work/{M3,M2}@{C0,C1,C2}.jsonl and writes, beside them,
    scoping_summary.txt   the table, the endpoints E1 to E6 with their pre-registered verdicts, the side findings and the limits
    scoping_table.csv/md  one row per system and condition
    scoping_results.json  every number

This file is not pinned by the pre-registration: it can be fixed after the run without unfreezing it. The rules it applies
(the margins, what counts as "preserves accuracy", "faster", "degrades", "helps") are those written in scoping.py.
"""

import argparse
import csv
import json
import math
import sys
from pathlib import Path

import numpy as np

import eval_metrics as E
import run_benchmarks as R
import run_scoping as RS
import scoping as S
import stat_tests as T

OUT = RS.OUT
CONDITIONS = ("C0", "C1", "C2")
KINDS = ("M3", "M2")
MARGIN = -0.05  # E1: scoping preserves accuracy iff the lower bound of the Macro-F1 difference is above this
FASTER = 0.9  # E2: faster iff the median latency of M3 is below this share of M2's
DRAWS = E.BOOTSTRAPS


def name(kind: str, condition: str) -> str:
    return f"{kind}@{condition}"


# --- reading ---------------------------------------------------------------------------------------------------

def load_runs(folder: Path) -> tuple[dict[str, list[dict]], dict[str, dict]]:
    rows, meta = {}, {}
    for kind in KINDS:
        for condition in CONDITIONS:
            system = name(kind, condition)
            path = folder / f"{system}.jsonl"
            if path.exists():
                rows[system] = sorted(R.read_lines(path), key=lambda r: r["id"])
            if (folder / f"{system}.meta.json").exists():
                meta[system] = json.loads((folder / f"{system}.meta.json").read_text(encoding="utf-8"))
    return rows, meta


def known_ids(condition: str, split: str = "test") -> dict[str, list[str]]:
    return {series: [i["id"] for i in items] for series, items in RS.condition_memories(condition, split).items()}


def distractors_of(conditions: dict) -> dict[tuple[str, str], set[str]]:
    return {(series, condition): set(info[condition]["distractor_ids"]) for series, info in conditions["series"].items() for condition in ("C1", "C2")}


def complete(rows: dict[str, list[dict]], expected: int) -> dict[str, bool]:
    return {system: len(r) == expected and len({x["id"] for x in r}) == expected for system, r in rows.items()}


# --- one system --------------------------------------------------------------------------------------------------

def citation_stats(rows: list[dict], distractors: dict[tuple[str, str], set[str]], condition: str) -> dict:
    """Among the true alerts: how many cite the gold decision, as the shipped parser reads the reply and as the corrected one does
    (a reply may cite only a decision the auditor was shown). Among all alerts: how many cite a decision that was put in as another topic's."""
    true_alerts = [r for r in rows if r["expected_alert"] and r["alert"]]
    fixed = {r["id"]: S.cited_id(r["raw"], r["scope_ids"]) for r in rows if r["alert"]}
    other = lambda r: fixed[r["id"]].strip("[]") in distractors.get((r["series_id"], condition), set())
    return {"true_alerts": len(true_alerts), "exact_as_parsed": sum(r["citation"] == r["gold_citation"] for r in true_alerts),
            "exact_fixed": sum(fixed[r["id"]] == r["gold_citation"] for r in true_alerts),
            "true_alerts_citing_distractor": sum(other(r) for r in true_alerts), "false_alarms_citing_distractor": sum(other(r) for r in rows if r["alert"] and not r["expected_alert"]),
            "alerts_citing_distractor": sum(other(r) for r in rows if r["alert"])}


def summarise_system(rows: list[dict], meta: dict | None, distractors: dict, condition: str) -> dict:
    s = E.summarise(rows, (meta or {}).get("peak_gb"), intervals=len({r["series_id"] for r in rows}) >= 10)
    tokens = [r["prompt_tokens"] for r in rows]
    s.update({"memory_p50": float(np.percentile([r["memory_lines"] for r in rows], 50)), "scope_p50": float(np.percentile([r["scope_size"] for r in rows], 50)),
              "tokens_p50": float(np.percentile(tokens, 50)), "tokens_p95": float(np.percentile(tokens, 95)), "citations": citation_stats(rows, distractors, condition),
              "unreadable": sum(not r["readable"] for r in rows)})
    return s


# --- two systems -------------------------------------------------------------------------------------------------

def latency_ratio(rows_a: list[dict], rows_b: list[dict], draws: int = DRAWS, seed: int = E.SEED) -> dict:
    """median latency of a over median latency of b, with a 95% interval from resampling series (probes of a series are not independent)."""
    series = sorted({r["series_id"] for r in rows_a})
    by_a = {s: [r["latency_ms"] for r in rows_a if r["series_id"] == s] for s in series}
    by_b = {s: [r["latency_ms"] for r in rows_b if r["series_id"] == s] for s in series}
    point = float(np.median([x for s in series for x in by_a[s]]) / np.median([x for s in series for x in by_b[s]]))
    rng = np.random.default_rng(seed)
    ratios = []
    for _ in range(draws):
        picked = [series[i] for i in rng.integers(0, len(series), len(series))]
        ratios.append(np.median([x for s in picked for x in by_a[s]]) / np.median([x for s in picked for x in by_b[s]]))
    return {"ratio": point, "lo": float(np.percentile(ratios, 2.5)), "hi": float(np.percentile(ratios, 97.5))}


def contrast(rows_a: list[dict], rows_b: list[dict]) -> dict:
    """a against b on the same probes: the paired bootstrap of Macro-F1, alert recall and false-alarm rate, McNemar on the alert decision and
    the label, the sign test by series, and the latency ratio."""
    joined = rows_a + rows_b
    first, second = rows_a[0]["system"], rows_b[0]["system"]
    a, b = T.paired_systems(joined, first, second)
    series = [r["series_id"] for r in a]
    right_a, right_b = [T.alert_right(r) for r in a], [T.alert_right(r) for r in b]
    return {"first": first, "second": second, "n": len(a),
            "bootstrap": {k: list(v) for k, v in E.paired_bootstrap(a, b).items()},
            "mcnemar_alert": T.mcnemar(right_a, right_b), "mcnemar_label": T.mcnemar([T.label_right(r) for r in a], [T.label_right(r) for r in b]),
            "series_alert": T.series_sign(right_a, right_b, series), "latency": latency_ratio(a, b)}


def disagreements(rows_a: list[dict], rows_b: list[dict]) -> list[dict]:
    by_b = {r["id"]: r for r in rows_b}
    return [{"id": a["id"], "gold": a["gold_label"], "a": a["pred"], "b": by_b[a["id"]]["pred"], "statement": a["statement"]} for a in rows_a if a["pred"] != by_b[a["id"]]["pred"]]


def miss_attribution(rows: list[dict]) -> dict:
    """Of a scoped system's wrong alert decisions, how many are on probes whose gold decision was outside the scope."""
    wrong = [r for r in rows if r["alert"] != r["expected_alert"]]
    with_gold = [r for r in wrong if r.get("gold_citation")]
    outside = [r for r in with_gold if r["gold_citation"].strip("[]") not in set(r["scope_ids"])]
    return {"wrong": len(wrong), "wrong_with_gold_decision": len(with_gold), "gold_outside_scope": len(outside),
            "misses_among_wrong": sum(r["expected_alert"] and not r["alert"] for r in wrong), "outside_scope_missed": sum(r["expected_alert"] and not r["alert"] for r in outside)}


def sweep_recall(embedder, memories: dict[str, list[dict]], probes: list[dict]) -> dict:
    """Scope recall for k = 1..8 with and without the money/time rule, embedding the memory and the statements once."""
    scoper = S.Scoper(embedder, memories, 1, S.EXTRA, False)
    queries = embedder.encode([p["statement"] for p in probes])
    out = {}
    for rule in (False, True):
        scoper.rule = rule
        out["rule" if rule else "no_rule"] = {}
        for k in S.K_GRID:
            scoper.k = k
            rows = [{**p, "scope_ids": scoper.scope(p["series_id"], p["statement"], query=queries[i])["ids"]} for i, p in enumerate(probes)]
            out["rule" if rule else "no_rule"][k] = S.scope_recall(rows) | {"mean_scope": float(np.mean([len(r["scope_ids"]) for r in rows]))}
    return out


# --- the pre-registered verdicts ---------------------------------------------------------------------------------

def verdicts(summaries: dict, contrasts: dict) -> dict:
    """What the data say about each pre-registered rule, or that they say nothing."""
    out = {}
    c0 = contrasts.get("M3@C0 vs M2@C0")
    if c0:
        delta, lo, hi = c0["bootstrap"]["macro_f1"]
        out["E1"] = {"delta": delta, "lo": lo, "hi": hi, "preserves_accuracy": lo > MARGIN, "loses_accuracy": hi < 0,
                     "text": (f"Scoping preserves accuracy at C0: the lower bound {lo:+.3f} is above {MARGIN}." if lo > MARGIN else
                              f"Not shown to preserve accuracy at C0: the lower bound {lo:+.3f} is not above {MARGIN}" + ("; the whole interval is below 0, so scoping lost accuracy." if hi < 0 else "; the interval also reaches above 0, so a loss is not shown either."))}
        ratio = c0["latency"]["ratio"]
        out["E2"] = {"ratio": ratio, "lo": c0["latency"]["lo"], "hi": c0["latency"]["hi"], "faster": ratio < FASTER,
                     "text": (f"Scoping is faster at C0: median latency {ratio:.2f} of M2's (below {FASTER})." if ratio < FASTER else f"Not faster by the pre-registered margin at C0: median latency {ratio:.2f} of M2's (needs below {FASTER}).")}
    for condition in ("C1", "C2"):
        degrade = contrasts.get(f"M2@{condition} vs M2@C0")
        help_ = contrasts.get(f"M3@{condition} vs M2@{condition}")
        if degrade:
            delta, lo, hi = degrade["bootstrap"]["macro_f1"]
            out[f"E4_degrade_{condition}"] = {"delta": delta, "lo": lo, "hi": hi, "degrades": hi < 0,
                                              "text": (f"Unscoped M2 degrades at {condition}: Macro-F1 {delta:+.3f} [{lo:+.3f}, {hi:+.3f}] against C0, wholly below 0." if hi < 0 else
                                                       f"No evidence that unscoped M2 degrades at {condition}: Macro-F1 {delta:+.3f} [{lo:+.3f}, {hi:+.3f}] against C0.")}
        if help_:
            delta, lo, hi = help_["bootstrap"]["macro_f1"]
            out[f"E4_help_{condition}"] = {"delta": delta, "lo": lo, "hi": hi, "helps": lo > 0, "hurts": hi < 0,
                                           "text": (f"Scoping helps at {condition}: Macro-F1 {delta:+.3f} [{lo:+.3f}, {hi:+.3f}] over M2, wholly above 0." if lo > 0 else
                                                    f"Scoping hurts at {condition}: Macro-F1 {delta:+.3f} [{lo:+.3f}, {hi:+.3f}] against M2, wholly below 0." if hi < 0 else
                                                    f"No evidence that scoping helps at {condition}: Macro-F1 {delta:+.3f} [{lo:+.3f}, {hi:+.3f}] against M2.")}
    return out


# --- saying it ----------------------------------------------------------------------------------------------------

def pct(value: float) -> str:
    return "n/a" if value is None or (isinstance(value, float) and math.isnan(value)) else f"{100 * value:.1f}%"


def table_rows(summaries: dict) -> list[dict]:
    rows = []
    for system, s in summaries.items():
        kind, condition = system.split("@")
        c = s["citations"]
        lo, hi = s.get("ci", {}).get("macro_f1", (math.nan, math.nan))
        rows.append({"system": system, "kind": kind, "condition": condition, "n": s["n"], "decisions_in_memory_p50": s["memory_p50"], "scope_p50": s["scope_p50"],
                     "prompt_tokens_p50": s["tokens_p50"], "prompt_tokens_p95": s["tokens_p95"], "macro_f1": s["macro_f1"], "macro_f1_lo": lo, "macro_f1_hi": hi,
                     "alert_precision": s["alert_precision"], "alert_recall": s["alert_recall"], "false_alarm": s["false_alarm"], "false_alarms": s["fp"], "missed_alerts": s["fn"],
                     "p50_ms": s["p50_ms"], "p95_ms": s["p95_ms"], "peak_gb": s["peak_gb"], "true_alerts": c["true_alerts"], "cited_gold_as_parsed": c["exact_as_parsed"],
                     "cited_gold_corrected": c["exact_fixed"], "alerts_citing_other_topic": c["alerts_citing_distractor"], "unreadable_replies": s["unreadable"]})
    return rows


def render_table(rows: list[dict]) -> str:
    head = f"{'System':<8}{'Memory':>7}{'Scope':>6}{'Tokens':>8}{'Macro-F1':>10}{'':>16}{'Alert rec':>10}{'False al.':>10}{'P50 ms':>8}{'P95 ms':>8}{'Cites gold':>12}{'Other-topic':>12}"
    lines = [head, "-" * len(head)]
    for r in rows:
        ci = f"[{r['macro_f1_lo']:.2f}, {r['macro_f1_hi']:.2f}]" if not math.isnan(r["macro_f1_lo"]) else ""
        cites = f"{r['cited_gold_corrected']}/{r['true_alerts']}"
        lines.append(f"{r['system']:<8}{r['decisions_in_memory_p50']:>7.0f}{r['scope_p50']:>6.0f}{r['prompt_tokens_p50']:>8.0f}{r['macro_f1']:>10.2f}{ci:>16}{r['alert_recall']:>10.2f}"
                     f"{pct(r['false_alarm']):>10}{r['p50_ms']:>8.0f}{r['p95_ms']:>8.0f}{cites:>12}{r['alerts_citing_other_topic']:>12}")
    return "\n".join(lines)


def describe(result: dict) -> str:
    s, c, v = result["summaries"], result["contrasts"], result["verdicts"]
    out = ["TOPIC-SCOPED VERIFICATION: RESULTS", "=" * 36, ""]
    out.append(f"Pre-registration: {result['prereg']}")
    if result["incomplete"]:
        out.append(f"INCOMPLETE: {', '.join(result['incomplete'])} do not have every probe yet; these numbers are provisional.")
    out += [f"k = {result['k']} (chosen on the development series), money/time rule on, extra {S.EXTRA}. Conditions: C0 own memory, C1 + up to {S.CONDITIONS['C1']} other-topic decisions, C2 + up to {S.CONDITIONS['C2']}.",
            "Memory = decisions in the memory the auditor could read (median per probe); Scope = decisions it was shown; Tokens = prompt tokens; 'Cites gold' = true alerts that cite the gold decision (reply read with the corrected parser); 'Other-topic' = alerts that cite a decision that was added as another topic's.", "",
            render_table(result["table"]), ""]
    out += ["E1. ACCURACY AT C0 (does scoping lose anything?)", "-" * 36]
    if "E1" in v:
        d = c["M3@C0 vs M2@C0"]
        recall, fa = d["bootstrap"]["alert_recall"], d["bootstrap"]["false_alarm"]
        m = d["mcnemar_alert"]
        out += [f"Macro-F1 of M3 minus M2: {v['E1']['delta']:+.3f} [{v['E1']['lo']:+.3f}, {v['E1']['hi']:+.3f}] (paired, series resampled).", v["E1"]["text"],
                f"Alert recall {recall[0]:+.3f} [{recall[1]:+.3f}, {recall[2]:+.3f}]; false-alarm rate {fa[0]:+.3f} [{fa[1]:+.3f}, {fa[2]:+.3f}].",
                f"Alert decision right: only M3 {m['only_first']}, only M2 {m['only_second']} (exact McNemar p {T.p_text(m['exact_p'])}); by series M3 better in {d['series_alert']['first_better']}, worse in {d['series_alert']['second_better']}, tied in {d['series_alert']['tied']}."]
    out += ["", "E2. SPEED (prompt tokens and latency)", "-" * 36]
    for condition in CONDITIONS:
        key = f"M3@{condition} vs M2@{condition}"
        if key in c:
            a, b = s[f"M3@{condition}"], s[f"M2@{condition}"]
            lat = c[key]["latency"]
            out.append(f"{condition}: tokens {a['tokens_p50']:.0f} against {b['tokens_p50']:.0f} (P50); latency P50 {a['p50_ms']:.0f} against {b['p50_ms']:.0f} ms, P95 {a['p95_ms']:.0f} against {b['p95_ms']:.0f} ms; "
                       f"ratio of medians {lat['ratio']:.2f} [{lat['lo']:.2f}, {lat['hi']:.2f}].")
    if "E2" in v:
        out.append(v["E2"]["text"])
    out += ["", "E3. SCOPE RECALL (does the scope contain the decision a probe is about?)", "-" * 36]
    for condition in CONDITIONS:
        r = result["scope_recall"].get(condition)
        if r:
            by = ", ".join(f"{k} {pct(x)}" for k, x in r["by_class"].items())
            out.append(f"{condition} at k = {result['k']}: {r['found']} of {r['n']} ({pct(r['recall'])}); by class: {by}. Mean scope {r['mean_scope']:.1f} decisions.")
    for condition, sweep in result.get("sweep", {}).items():
        no, yes = sweep["no_rule"], sweep["rule"]
        out.append(f"{condition} sweep (found / {no[min(no)]['n']}): " + "; ".join(f"k={k}: {no[k]['found']}" + (f" (+rule {yes[k]['found']})" if yes[k]['found'] != no[k]['found'] else "") for k in no))
    out += ["", "E4. SCALE", "-" * 36]
    for condition in ("C1", "C2"):
        for key in (f"E4_degrade_{condition}", f"E4_help_{condition}"):
            if key in v:
                out.append(v[key]["text"])
        if f"M3@{condition}" in s and f"M2@{condition}" in s:
            a, b = s[f"M3@{condition}"], s[f"M2@{condition}"]
            out.append(f"  {condition}: M2 alert recall {b['alert_recall']:.2f}, false alarms {b['fp']}; M3 alert recall {a['alert_recall']:.2f}, false alarms {a['fp']}.")
    out += ["", "E5. CITATIONS AND TOPICS MIXED UP", "-" * 36]
    for system, x in s.items():
        cite = x["citations"]
        out.append(f"{system}: {cite['exact_fixed']} of {cite['true_alerts']} true alerts cite the gold decision (the shipped parser reads {cite['exact_as_parsed']}); "
                   f"{cite['alerts_citing_distractor']} alerts cite another topic's decision ({cite['true_alerts_citing_distractor']} true, {cite['false_alarms_citing_distractor']} false alarms).")
    out += ["", "E6. WHAT ONE LLM TOPIC CALL COSTS", "-" * 36]
    t = result.get("topic_latency")
    out.append(f"Naming the topic of a statement with Qwen: P50 {t['llm_topic_call_ms']['p50']:.0f} ms, P95 {t['llm_topic_call_ms']['p95']:.0f} ms over {t['statements']} statements; the embedding step: P50 {t['embedding_step_ms']['p50']:.1f} ms. "
               f"A topic label from an LLM is free text (for example: {', '.join(t['topics_named'][:5])}), so statements and decisions would still have to be matched by similarity." if t else "not measured")
    out += ["", "WHERE SCOPING LOST", "-" * 36]
    for system in ("M3@C0", "M3@C1", "M3@C2"):
        if system in result["attribution"]:
            a = result["attribution"][system]
            out.append(f"{system}: {a['wrong']} wrong alert decisions; {a['wrong_with_gold_decision']} on probes that have a gold decision, of which {a['gold_outside_scope']} had it outside the scope ({a['outside_scope_missed']} of them missed alerts).")
    out += ["", "SIDE FINDINGS", "-" * 36]
    d = result.get("determinism")
    if d:
        out.append(f"M2 at C0 re-run in this session: {d['same_label']} of {d['n']} labels and {d['same_raw']} of {d['n']} raw replies identical to the run behind Table 6.1 (temperature 0).")
    p = result.get("parser")
    if p:
        out.append(f"Until the fix of 16 October 2026, memoria._parse read the cited id as the first known id that is a substring of the citation: on M2's {p['alerts']} alerts it returned a different decision from the one the model cited in {p['changed']} ({', '.join(p['ids'])}); "
                   f"read exactly, {p['exact_fixed']} of {p['true_alerts']} true alerts cite the gold decision, against {p['exact_as_parsed']} as stored. memoria._parse now reads the id exactly (the old code is kept as results/memoria_as_run.py). No label is affected.")
    out += ["", "WHAT THIS DOES NOT SHOW", "-" * 36,
            "- Distractors are other groups' decisions on other topics of the same product, filtered by regular expression so that no gold label can change; they are not a month of real meetings, and a vault that mixes projects needs a project scope first.",
            "- MemoriaBench has no probe whose conflict is implicit (a titanium case needs the budget): the money/time rule is tested only where a statement says so.",
            "- Decisions are the annotators' (as for Table 6.1): this measures auditing from clean memory, not extraction of decisions from speech.",
            "- 336 probes in 28 series; intervals resample series. Everything is exploratory in the sense of the thesis, and every endpoint is reported whatever it shows.", ""]
    return "\n".join(out)


# --- putting it together -----------------------------------------------------------------------------------------

def analyse(rows: dict[str, list[dict]], meta: dict[str, dict], conditions: dict, config: dict, original_m2: list[dict] | None = None, topic: dict | None = None,
            sweep: dict | None = None, prereg: str = "n/a", known: dict[str, list[str]] | None = None) -> dict:
    distractors = distractors_of(conditions)
    summaries = {system: summarise_system(r, meta.get(system), distractors, system.split("@")[1]) for system, r in rows.items()}
    order = [name(k, c) for c in CONDITIONS for k in KINDS if name(k, c) in summaries]
    summaries = {system: summaries[system] for system in order}
    contrasts = {}
    same = lambda a, b: a in rows and b in rows and [r["id"] for r in rows[a]] == [r["id"] for r in rows[b]]  # a paired test needs the same probes
    for condition in CONDITIONS:
        if same(name("M3", condition), name("M2", condition)):
            contrasts[f"M3@{condition} vs M2@{condition}"] = contrast(rows[name("M3", condition)], rows[name("M2", condition)])
    for kind in KINDS:
        for condition in ("C1", "C2"):
            if same(name(kind, condition), name(kind, "C0")):
                contrasts[f"{kind}@{condition} vs {kind}@C0"] = contrast(rows[name(kind, condition)], rows[name(kind, "C0")])
    result = {"k": config["k"], "prereg": prereg, "incomplete": sorted(s for s, ok in complete(rows, 336).items() if not ok), "summaries": summaries, "contrasts": contrasts,
              "table": table_rows(summaries), "verdicts": verdicts(summaries, contrasts),
              "scope_recall": {c: S.scope_recall(rows[name("M3", c)]) | {"mean_scope": float(np.mean([r["scope_size"] for r in rows[name("M3", c)]]))} for c in CONDITIONS if name("M3", c) in rows},
              "attribution": {system: miss_attribution(r) for system, r in rows.items() if system.startswith("M3")},
              "disagreements": {key: disagreements(rows[key.split(" vs ")[0]], rows[key.split(" vs ")[1]]) for key in contrasts}, "topic_latency": topic, "sweep": sweep or {}}
    if "M2@C0" in rows and original_m2:
        old = {r["id"]: r for r in original_m2}
        now = rows["M2@C0"]
        result["determinism"] = {"n": len(now), "same_label": sum(r["pred"] == old[r["id"]]["pred"] for r in now), "same_raw": sum(r["raw"] == old[r["id"]]["raw"] for r in now)}
        known_c0 = known if known else known_ids("C0")  # series -> ids of its own memory, to read the replies behind Table 6.1
        alerts = [r for r in original_m2 if r["alert"]]
        changed = [r for r in alerts if S.cited_id(r["raw"], known_c0[r["series_id"]]) != r["citation"]]
        true_alerts = [r for r in original_m2 if r["expected_alert"] and r["alert"]]
        result["parser"] = {"alerts": len(alerts), "changed": len(changed), "ids": sorted(r["id"] for r in changed), "true_alerts": len(true_alerts),
                            "exact_as_parsed": sum(r["citation"] == r["gold_citation"] for r in true_alerts),
                            "exact_fixed": sum(S.cited_id(r["raw"], known_c0[r["series_id"]]) == r["gold_citation"] for r in true_alerts)}
    return result


def write_outputs(result: dict, folder: Path) -> None:
    (folder / "scoping_summary.txt").write_text(describe(result), encoding="utf-8")
    (folder / "scoping_results.json").write_text(json.dumps(result, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)), encoding="utf-8")
    fields = list(result["table"][0]) if result["table"] else []
    with (folder / "scoping_table.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in result["table"]:
            writer.writerow({k: ("" if isinstance(v, float) and math.isnan(v) else (round(v, 4) if isinstance(v, float) else v)) for k, v in row.items()})
    md = ["| System | Memory | Scope | Tokens | Macro-F1 | Alert recall | False alarm | P50 ms | P95 ms | Cites gold | Other-topic citations |", "|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|"]
    for r in result["table"]:
        ci = f" [{r['macro_f1_lo']:.2f}, {r['macro_f1_hi']:.2f}]" if not math.isnan(r["macro_f1_lo"]) else ""
        md.append(f"| {r['system']} | {r['decisions_in_memory_p50']:.0f} | {r['scope_p50']:.0f} | {r['prompt_tokens_p50']:.0f} | {r['macro_f1']:.2f}{ci} | {r['alert_recall']:.2f} | {pct(r['false_alarm'])} | "
                  f"{r['p50_ms']:.0f} | {r['p95_ms']:.0f} | {r['cited_gold_corrected']}/{r['true_alerts']} | {r['alerts_citing_other_topic']} |")
    (folder / "scoping_table.md").write_text("\n".join(md) + "\n", encoding="utf-8")


def prereg_statement(as_run: Path | None = None) -> str:
    """What to say about the pre-registration: unchanged, or what changed. memoria.py was fixed after the runs (the citation parser); the copy of
    the code as it ran is kept, and when its hash is the pinned one the statement says that the runs used the pinned code."""
    problem = RS.prereg_problem()
    pinned = json.loads(RS.PREREG.read_text())
    if not problem:
        return f"code, config, conditions, memoria.py and the benchmark are those pinned on {pinned['written']}"
    as_run = as_run or RS.HERE / "results" / "memoria_as_run.py"
    if problem == "changed since the pre-registration: memoria_py" and as_run.exists() and RS.sha256_of(as_run) == pinned["memoria_py"]:
        return (f"code, config, conditions and the benchmark are those pinned on {pinned['written']}; memoria.py was changed afterwards (the citation-parser fix of 16 October 2026), "
                f"and the memoria.py the runs used is kept as results/memoria_as_run.py, which has the pinned hash")
    return problem


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Analyse the topic-scoping experiment")
    parser.add_argument("--no-sweep", action="store_true", help="skip the scope-recall sweep (it embeds every memory once, about a minute)")
    parser.add_argument("--folder", type=Path, default=OUT / "_work")
    args = parser.parse_args(argv)
    rows, meta = load_runs(args.folder)
    if not rows:
        print("no predictions yet", file=sys.stderr)
        return 1
    config = json.loads(RS.CONFIG.read_text(encoding="utf-8"))
    conditions = json.loads((OUT / "conditions.json").read_text(encoding="utf-8"))
    topic = json.loads((OUT / "topic_latency.json").read_text(encoding="utf-8")) if (OUT / "topic_latency.json").exists() else None
    original = [r for r in E.load_predictions(E.RESULTS / "predictions_raw.jsonl") if r["system"] == "M2"]
    prereg = prereg_statement()
    sweep = {}
    if not args.no_sweep:
        memories_probes = RS.load_split("test")
        embedder = R.Embedder()
        for condition in CONDITIONS:
            sweep[condition] = sweep_recall(embedder, RS.condition_memories(condition, "test"), memories_probes[2])
    result = analyse(rows, meta, conditions, config, original, topic, sweep, prereg)
    write_outputs(result, OUT)
    print(describe(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
