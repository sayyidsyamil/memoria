"""Test of the topic-scoping analysis: every endpoint against a hand count, every pre-registered rule at its boundary, and the honesty of the text.

No language model is loaded here. What it proves:
  - the citation counts agree with a direct count, and a reply that cites [X#2] counts for the gold decision [X#2] though the shipped parser
    said [X],
  - the latency ratio, the paired contrasts and the McNemar counts are the ones a plain loop gives, and systems that did not answer the
    same probes are never compared,
  - each rule of scoping.py gives the verdict the text of scoping.py says at, just below and just above its margin,
  - the whole analysis on invented predictions writes every file, flags an incomplete run, says "not shown" and "no evidence" when that is what
    the numbers say, and states only numbers it computed,
  - on the real development and test predictions, what is on disk is what this code makes of them.

Run: python3.11 test_scoping_report.py
"""

import contextlib
import csv
import hashlib
import io
import json
import math
import random
import sys
import tempfile
from pathlib import Path

import numpy as np

import eval_metrics as E
import run_benchmarks as R
import run_scoping as RS
import scoping as S
import scoping_report as P
import stat_tests as T

passed: list[str] = []
KIND = {"SUPPORTED_CURRENT": "S", "OUTDATED": "O", "CONTRADICTS": "C", "UPDATES": "U", "IRRELEVANT": "I", "INSUFFICIENT_EVIDENCE": "N"}
SERIES = [f"AB{i:04d}" for i in range(28)]


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


def close(a: float, b: float, eps: float = 1e-9) -> bool:
    return abs(a - b) <= eps


# ------------------------------------------------------------------ invented runs

def probes_of(series: list[str], per_class: int = 2) -> list[dict]:
    out = []
    for s in series:
        for label in E.CLASSES:
            for k in range(1, per_class + 1):
                out.append({"id": f"{s}-{KIND[label]}-{k:02d}", "series_id": s, "statement": f"a statement of {s}", "gold_label": label,
                            "gold_citation": f"[{s}c:00:1{k}]" if label in ("SUPPORTED_CURRENT", "OUTDATED", "CONTRADICTS") else None, "expected_alert": label in E.ALERTS})
    return out


def memory_ids(series: str, own: int = 6, extra: int = 0) -> list[str]:
    return [f"{series}c:00:1{k}" for k in range(1, 3)] + [f"{series}b:0{k}:00" for k in range(own - 2)] + [f"X{series}:0{k}:00" for k in range(extra)]


def make_rows(system: str, probes: list[dict], rng: random.Random, accuracy: float, latency: float, tokens: int, extra: int = 0, scoped: int | None = None,
              false_alarm: float = 0.0, wrong_cite: float = 0.0) -> list[dict]:
    rows = []
    for p in probes:
        gold = p["gold_label"]
        if not p["expected_alert"] and rng.random() < false_alarm:
            pred = rng.choice(E.ALERTS)
        elif rng.random() < accuracy:
            pred = gold
        else:
            pred = rng.choice([c for c in E.CLASSES if c != gold and (p["expected_alert"] or c not in E.ALERTS)])
        ids = memory_ids(p["series_id"], extra=extra)
        scope = ids if scoped is None else (ids[:scoped] if rng.random() < 0.8 else ids[-scoped:])  # the gold decisions sit first: the last ones miss them
        cited = p["gold_citation"] if p["gold_citation"] and rng.random() > wrong_cite else (f"[{scope[-1]}]" if scope else "")
        raw = f"{pred} | because | {cited}" if pred in E.ALERTS else pred
        rows.append({**p, "system": system, "pred": pred, "alert": pred in E.ALERTS, "citation": cited if pred in E.ALERTS else "", "raw": raw, "readable": True,
                     "latency_ms": latency * rng.uniform(0.9, 1.1), "prompt_tokens": tokens + rng.randint(-5, 5), "memory_lines": len(ids), "scope_ids": scope,
                     "scope_size": len(scope), "cue": False, "added": 0})
    return rows


def invented_runs(seed: int = 7, m3_accuracy: float = 0.85, m2_accuracy: float = 0.88) -> tuple[dict[str, list[dict]], dict, dict]:
    probes = probes_of(SERIES)
    rng = random.Random(seed)
    rows = {}
    for condition, extra, m2_tokens, m2_latency in (("C0", 0, 900, 2000.0), ("C1", 30, 2000, 3000.0), ("C2", 80, 3500, 5000.0)):
        rows[f"M2@{condition}"] = make_rows(f"M2@{condition}", probes, rng, m2_accuracy - (0.02 if condition != "C0" else 0), m2_latency, m2_tokens, extra)
        rows[f"M3@{condition}"] = make_rows(f"M3@{condition}", probes, rng, m3_accuracy, 900.0, 620, extra, scoped=4)
    conditions = {"series": {s: {c: {"decisions": 0, "distractors": e, "pool": 90, "distractor_ids": [f"X{s}:0{k}:00" for k in range(e)]} for c, e in (("C1", 30), ("C2", 80))} for s in SERIES}}
    meta = {system: {"peak_gb": 3.5} for system in rows}
    return rows, conditions, meta


# ------------------------------------------------------------------ citations

def citation_checks() -> None:
    gold_plain, gold_two = "[IS1003c:27:06]", "[IS1003c:27:06#2]"
    base = {"series_id": "S1", "expected_alert": True, "alert": True, "scope_ids": ["IS1003c:27:06", "IS1003c:27:06#2", "XS1:00:00"]}
    rows = [
        {**base, "id": "a", "gold_citation": gold_two, "citation": gold_plain, "raw": "OUTDATED | r | [IS1003c:27:06#2]"},   # the shipped parser said the base id
        {**base, "id": "b", "gold_citation": gold_plain, "citation": gold_plain, "raw": "CONTRADICTS | r | [IS1003c:27:06]"},
        {**base, "id": "c", "gold_citation": gold_plain, "citation": "[XS1:00:00]", "raw": "CONTRADICTS | r | [XS1:00:00]"},     # another topic's decision
        {**base, "id": "d", "gold_citation": gold_plain, "citation": "", "raw": "CONTRADICTS | r | [NOPE:1:1]"},                    # an id nobody was shown
        {**base, "id": "e", "expected_alert": False, "gold_citation": None, "citation": "[XS1:00:00]", "raw": "OUTDATED | r | [XS1:00:00]"},  # a false alarm on another topic
        {**base, "id": "f", "expected_alert": False, "gold_citation": None, "citation": "", "raw": "OUTDATED | r | [IS1003c:27:06]", "citation_x": 1},  # a false alarm on the same topic
        {**base, "id": "g", "alert": False, "gold_citation": gold_plain, "citation": "", "raw": "UPDATES"},                         # a missed alert: not counted
    ]
    c = P.citation_stats(rows, {("S1", "C1"): {"XS1:00:00"}}, "C1")
    check("citation counts: 4 true alerts (the missed one is not one), the plain parser gets 3... as parsed 1, corrected 2 (a and b)", c["true_alerts"] == 4 and c["exact_as_parsed"] == 1 and c["exact_fixed"] == 2, c)
    check("a reply that cites #2 counts for the gold #2 although the shipped parser returned the plain id", c["exact_fixed"] - c["exact_as_parsed"] == 1)
    check("alerts that cite a decision added as another topic's: 1 true alert, 1 false alarm, 2 in all; the same-topic false alarm is not one",
          (c["true_alerts_citing_distractor"], c["false_alarms_citing_distractor"], c["alerts_citing_distractor"]) == (1, 1, 2), c)
    check("with no distractors (C0) none cites another topic", P.citation_stats(rows, {}, "C0")["alerts_citing_distractor"] == 0)
    check("a citation of an id the auditor was not shown is no citation, so it cannot be a distractor or the gold decision", c["exact_fixed"] == 2 and not any(r["id"] == "d" for r in rows if S.cited_id(r["raw"], r["scope_ids"])))


def summary_checks() -> None:
    rows, conditions, meta = invented_runs()
    s = P.summarise_system(rows["M3@C2"], meta["M3@C2"], P.distractors_of(conditions), "C2")
    r = rows["M3@C2"]
    check("a system's summary carries the medians of memory, scope and prompt tokens, and the tokens' P95, as a direct count gives them",
          s["memory_p50"] == float(np.percentile([x["memory_lines"] for x in r], 50)) and s["scope_p50"] == 4.0 and close(s["tokens_p50"], float(np.percentile([x["prompt_tokens"] for x in r], 50)))
          and close(s["tokens_p95"], float(np.percentile([x["prompt_tokens"] for x in r], 95))), s)
    check("it adds the usual metrics, the cluster-bootstrap interval for 28 series, the measured peak memory and the number of unreadable replies",
          close(s["macro_f1"], E.scores(E.confusion_matrix(r))["macro_f1"]) and "ci" in s and s["peak_gb"] == 3.5 and s["unreadable"] == 0)
    broken = [{**x, "readable": i % 10 != 0} for i, x in enumerate(r)]
    check("unreadable replies are counted", P.summarise_system(broken, None, {}, "C2")["unreadable"] == len([i for i in range(len(r)) if i % 10 == 0]))


# ------------------------------------------------------------------ latency and contrasts

def contrast_checks() -> None:
    rows, _, _ = invented_runs()
    a, b = rows["M3@C0"], rows["M2@C0"]
    flat_a = [{**x, "latency_ms": 500.0} for x in a]
    flat_b = [{**x, "latency_ms": 1000.0} for x in b]
    lat = P.latency_ratio(flat_a, flat_b, draws=200)
    check("the latency ratio is the median of the first over the median of the second, and its interval collapses when every latency is the same", lat == {"ratio": 0.5, "lo": 0.5, "hi": 0.5}, lat)
    mixed = P.latency_ratio(a, b, draws=300)
    direct = float(np.median([x["latency_ms"] for x in a]) / np.median([x["latency_ms"] for x in b]))
    check("on varied latencies the ratio is the direct ratio of medians, with the interval around it, and the run is deterministic", close(mixed["ratio"], direct) and mixed["lo"] <= direct <= mixed["hi"] and mixed == P.latency_ratio(a, b, draws=300), mixed)

    same = P.contrast(a, [{**x, "system": "M3@C0b"} for x in a])
    check("a system against itself: no difference, no discordant pair, p = 1, and a ratio of 1",
          same["bootstrap"]["macro_f1"] == [0.0, 0.0, 0.0] and same["mcnemar_alert"]["discordant"] == 0 and same["mcnemar_alert"]["exact_p"] == 1.0 and same["latency"]["ratio"] == 1.0, same["bootstrap"])
    c = P.contrast(a, b)
    delta = E.scores(E.confusion_matrix(a))["macro_f1"] - E.scores(E.confusion_matrix(b))["macro_f1"]
    by_b = {x["id"]: x for x in b}
    only_a = sum(T.alert_right(x) and not T.alert_right(by_b[x["id"]]) for x in a)
    only_b = sum((not T.alert_right(x)) and T.alert_right(by_b[x["id"]]) for x in a)
    check("the paired Macro-F1 difference is the difference of the two systems' Macro-F1, and its interval contains it", close(c["bootstrap"]["macro_f1"][0], delta) and c["bootstrap"]["macro_f1"][1] <= delta <= c["bootstrap"]["macro_f1"][2], c["bootstrap"])
    check("McNemar's b and c are a plain count of the probes only one of the two got right on the alert decision, and the sign test counts the 28 series",
          (c["mcnemar_alert"]["only_first"], c["mcnemar_alert"]["only_second"]) == (only_a, only_b) and c["series_alert"]["series"] == 28 and c["n"] == 336, c["mcnemar_alert"])
    check("the first and the second system are named as asked", (c["first"], c["second"]) == ("M3@C0", "M2@C0"))
    try:
        P.contrast(a, b[:-1])
        refused = False
    except ValueError:
        refused = True
    check("systems that did not answer the same probes are never compared", refused)
    changes = P.disagreements(a, b)
    check("disagreements lists exactly the probes where the two labels differ, with gold, both labels and the statement",
          [d["id"] for d in changes] == [x["id"] for x in a if x["pred"] != by_b[x["id"]]["pred"]] and all(d["a"] != d["b"] for d in changes) and set(changes[0]) == {"id", "gold", "a", "b", "statement"})


def attribution_checks() -> None:
    rows = [
        {"alert": False, "expected_alert": True, "gold_citation": "[A:1]", "scope_ids": ["B:2"]},      # a missed alert, gold outside the scope
        {"alert": False, "expected_alert": True, "gold_citation": "[A:2]", "scope_ids": ["A:2"]},      # a missed alert, gold inside
        {"alert": True, "expected_alert": False, "gold_citation": None, "scope_ids": ["A:2"]},          # a false alarm on a probe with no gold decision
        {"alert": True, "expected_alert": False, "gold_citation": "[A:3]", "scope_ids": ["B:1"]},       # a false alarm on a SUPPORTED probe, gold outside
        {"alert": True, "expected_alert": True, "gold_citation": "[A:4]", "scope_ids": []},             # right
    ]
    check("miss attribution: 4 wrong alert decisions, 3 on probes with a gold decision, 2 of those with it outside the scope, and 1 of them a missed alert",
          P.miss_attribution(rows) == {"wrong": 4, "wrong_with_gold_decision": 3, "gold_outside_scope": 2, "misses_among_wrong": 2, "outside_scope_missed": 1}, P.miss_attribution(rows))


# ------------------------------------------------------------------ the pre-registered rules

def fake_contrast(delta: float, lo: float, hi: float, ratio: float = 0.5) -> dict:
    return {"bootstrap": {"macro_f1": [delta, lo, hi], "alert_recall": [0.0, -0.05, 0.05], "false_alarm": [0.0, -0.01, 0.01]}, "latency": {"ratio": ratio, "lo": ratio - 0.05, "hi": ratio + 0.05},
            "mcnemar_alert": {"only_first": 1, "only_second": 1, "exact_p": 1.0}, "series_alert": {"first_better": 1, "second_better": 1, "tied": 26}}


def verdict_checks() -> None:
    v = lambda c: P.verdicts({}, c)
    check("E1: a lower bound above -0.05 preserves accuracy", v({"M3@C0 vs M2@C0": fake_contrast(-0.01, -0.049, 0.03)})["E1"]["preserves_accuracy"])
    check("E1: a lower bound of exactly -0.05 does not (it must be above), and neither does one below", not v({"M3@C0 vs M2@C0": fake_contrast(-0.01, -0.05, 0.03)})["E1"]["preserves_accuracy"]
          and not v({"M3@C0 vs M2@C0": fake_contrast(-0.04, -0.09, 0.01)})["E1"]["preserves_accuracy"])
    lost = v({"M3@C0 vs M2@C0": fake_contrast(-0.1, -0.15, -0.04)})["E1"]
    check("E1: an interval wholly below 0 says that scoping lost accuracy; one that reaches above 0 says only 'not shown'", lost["loses_accuracy"] and "lost accuracy" in lost["text"]
          and "a loss is not shown either" in v({"M3@C0 vs M2@C0": fake_contrast(-0.04, -0.09, 0.01)})["E1"]["text"])
    check("E2: a median ratio of 0.89 is faster, 0.9 is not (it must be below)", v({"M3@C0 vs M2@C0": fake_contrast(0, -0.01, 0.01, 0.89)})["E2"]["faster"] and not v({"M3@C0 vs M2@C0": fake_contrast(0, -0.01, 0.01, 0.9)})["E2"]["faster"])
    check("E4 degrade: an interval wholly below 0 degrades; one that touches 0 does not", v({"M2@C2 vs M2@C0": fake_contrast(-0.05, -0.08, -0.01)})["E4_degrade_C2"]["degrades"]
          and not v({"M2@C2 vs M2@C0": fake_contrast(-0.05, -0.08, 0.0)})["E4_degrade_C2"]["degrades"] and "No evidence that unscoped M2 degrades at C2" in v({"M2@C2 vs M2@C0": fake_contrast(-0.05, -0.08, 0.0)})["E4_degrade_C2"]["text"])
    helps = v({"M3@C1 vs M2@C1": fake_contrast(0.05, 0.01, 0.09)})["E4_help_C1"]
    check("E4 help: an interval wholly above 0 helps; one that touches 0 does not; one wholly below 0 hurts", helps["helps"] and "Scoping helps at C1" in helps["text"]
          and not v({"M3@C1 vs M2@C1": fake_contrast(0.05, 0.0, 0.09)})["E4_help_C1"]["helps"] and v({"M3@C1 vs M2@C1": fake_contrast(-0.05, -0.09, -0.01)})["E4_help_C1"]["hurts"]
          and "Scoping hurts at C1" in v({"M3@C1 vs M2@C1": fake_contrast(-0.05, -0.09, -0.01)})["E4_help_C1"]["text"])
    check("a verdict is given only for the contrasts that exist", v({}) == {} and set(v({"M3@C0 vs M2@C0": fake_contrast(0, -0.01, 0.01)})) == {"E1", "E2"})
    check("the margins are those of scoping.py's text: -0.05 and 0.9", P.MARGIN == -0.05 and P.FASTER == 0.9 and "-0.05" in S.__doc__ and "0.9 times" in S.__doc__)


# ------------------------------------------------------------------ the whole analysis

def analysis_checks() -> None:
    rows, conditions, meta = invented_runs()
    original = [{**x, "system": "M2"} for x in rows["M2@C0"]]
    known = {s: memory_ids(s) for s in SERIES}
    topic = {"statements": 30, "llm_topic_call_ms": {"p50": 327.0, "p95": 362.0}, "embedding_step_ms": {"p50": 7.0, "p95": 9.7}, "topics_named": ["Remote", "Chip", "Lunch"]}
    result = P.analyse(rows, meta, conditions, {"k": 4}, original, topic, {}, "pinned", known)
    check("all six systems, in the order of the table (condition by condition, M3 then M2), none incomplete", list(result["summaries"]) == ["M3@C0", "M2@C0", "M3@C1", "M2@C1", "M3@C2", "M2@C2"] and result["incomplete"] == [])
    check("a contrast for each condition (M3 against M2) and for each system at C1 and C2 against C0", set(result["contrasts"]) == {"M3@C0 vs M2@C0", "M3@C1 vs M2@C1", "M3@C2 vs M2@C2", "M3@C1 vs M3@C0", "M3@C2 vs M3@C0", "M2@C1 vs M2@C0", "M2@C2 vs M2@C0"})
    check("a verdict for E1, E2 and for E4 at C1 and C2", {"E1", "E2", "E4_degrade_C1", "E4_degrade_C2", "E4_help_C1", "E4_help_C2"} <= set(result["verdicts"]))
    check("E2's ratio is the ratio of the two systems' median latencies at C0, about 0.45", 0.40 < result["verdicts"]["E2"]["ratio"] < 0.50 and result["verdicts"]["E2"]["faster"], result["verdicts"]["E2"])
    r = result["scope_recall"]["C2"]
    mine = [x for x in rows["M3@C2"] if x["gold_citation"]]
    check("scope recall is a direct count of the probes whose gold decision is in M3's scope, by class", r["n"] == len(mine) == 168 and r["found"] == sum(x["gold_citation"].strip("[]") in x["scope_ids"] for x in mine)
          and set(r["by_class"]) == {"SUPPORTED_CURRENT", "OUTDATED", "CONTRADICTS"}, r)
    check("the table has one row per system with the same numbers as the summaries", len(result["table"]) == 6 and result["table"][0]["system"] == "M3@C0" and close(result["table"][0]["macro_f1"], result["summaries"]["M3@C0"]["macro_f1"]))
    check("the miss attribution is computed for the scoped systems only", set(result["attribution"]) == {"M3@C0", "M3@C1", "M3@C2"})
    check("the determinism block compares M2 at C0 with the original run: every label and reply the same here", result["determinism"] == {"n": 336, "same_label": 336, "same_raw": 336}, result["determinism"])
    drifted = [({**x, "pred": "UPDATES" if x["pred"] != "UPDATES" else "IRRELEVANT", "raw": "other"} if i % 50 == 0 else x) for i, x in enumerate(original)]
    changed_count = len([i for i in range(len(original)) if i % 50 == 0])
    again = P.analyse(rows, meta, conditions, {"k": 4}, drifted, topic, {}, "pinned", known)
    check("when the original run differs, the determinism block counts exactly the labels and replies that differ", again["determinism"] == {"n": 336, "same_label": 336 - changed_count, "same_raw": 336 - changed_count}, again["determinism"])
    check("the scope recall of M3 is below that of an unscoped system (which always has the gold decision), so it is computed on M3's rows, not M2's", result["scope_recall"]["C0"]["recall"] < 1.0 and all(x["gold_citation"].strip("[]") in x["scope_ids"] for x in rows["M2@C0"] if x["gold_citation"]))
    check("the parser block counts the alerts whose cited id the shipped parser changed (none here: every reply's citation is the id it cites), and the corrected exact-match",
          result["parser"]["alerts"] == sum(x["alert"] for x in original) and result["parser"]["changed"] == 0 and result["parser"]["ids"] == [] and result["parser"]["exact_fixed"] == result["parser"]["exact_as_parsed"], result["parser"])
    broken = [({**x, "citation": "[WRONG:0:0]"} if (x["alert"] and i % 20 == 0) else x) for i, x in enumerate(original)]
    flawed = [x["id"] for i, x in enumerate(original) if x["alert"] and i % 20 == 0]
    wrong = P.analyse(rows, meta, conditions, {"k": 4}, broken, topic, {}, "pinned", known)
    check("when the shipped parser's citation differs from the id the reply cites, those alerts are listed, and the corrected parser reads more true alerts as citing the gold decision",
          wrong["parser"]["changed"] == len(flawed) and wrong["parser"]["ids"] == sorted(flawed) and wrong["parser"]["exact_fixed"] > wrong["parser"]["exact_as_parsed"], wrong["parser"])

    text = P.describe(result)
    check("the text states the pre-registration, k, every endpoint heading, the topic call and the limits", all(h in text for h in ("Pre-registration: pinned", "k = 4", "E1.", "E2.", "E3.", "E4.", "E5.", "E6.", "WHAT THIS DOES NOT SHOW", "P50 327 ms")))
    check("the text reports numbers that were computed: the ratio of medians and the Macro-F1 difference of the verdicts appear in it", f"{result['verdicts']['E2']['ratio']:.2f}" in text and f"{result['verdicts']['E1']['delta']:+.3f}" in text)
    check("the text never says 100% or 'proves'", "100%" not in text.replace("100.0%", "") and "prove" not in text.lower())

    partial = {**rows, "M2@C1": rows["M2@C1"][:-5]}
    cut = P.analyse(partial, meta, conditions, {"k": 4}, original, topic, {}, "pinned", known)
    check("an incomplete system is flagged and never paired with one that has other probes", cut["incomplete"] == ["M2@C1"] and "M3@C1 vs M2@C1" not in cut["contrasts"] and "M2@C1 vs M2@C0" not in cut["contrasts"] and "M3@C0 vs M2@C0" in cut["contrasts"])
    check("and the text says so", "INCOMPLETE: M2@C1" in P.describe(cut))

    lower, _, _ = invented_runs(m3_accuracy=0.4)
    bad = P.analyse({**lower}, meta, conditions, {"k": 4}, original, topic, {}, "pinned", known)
    sad = P.describe(bad)
    check("when scoping is clearly worse the text says so and does not say it preserves accuracy", bad["verdicts"]["E1"]["loses_accuracy"] and "lost accuracy" in sad and "Scoping preserves accuracy" not in sad)

    with tempfile.TemporaryDirectory() as folder:
        P.write_outputs(result, Path(folder))
        names = sorted(p.name for p in Path(folder).iterdir())
        check("the outputs are the summary, the table as CSV and Markdown, and the results as JSON", names == ["scoping_results.json", "scoping_summary.txt", "scoping_table.csv", "scoping_table.md"], names)
        back = list(csv.DictReader((Path(folder) / "scoping_table.csv").open()))
        check("the CSV has a row per system with the system, the Macro-F1 and the latency of the table", [r["system"] for r in back] == [r["system"] for r in result["table"]] and abs(float(back[0]["macro_f1"]) - result["table"][0]["macro_f1"]) < 1e-3 and abs(float(back[0]["p50_ms"]) - result["table"][0]["p50_ms"]) < 1e-2)
        loaded = json.loads((Path(folder) / "scoping_results.json").read_text())
        check("the JSON holds the verdicts and the contrasts", loaded["verdicts"].keys() == result["verdicts"].keys() and "M3@C0 vs M2@C0" in loaded["contrasts"])
        md = (Path(folder) / "scoping_table.md").read_text().splitlines()
        check("the Markdown table has a header, an alignment row and a row per system", len(md) == 2 + 6 and md[0].startswith("| System") and md[1].startswith("|:--"))
        check("the summary on disk is the text", (Path(folder) / "scoping_summary.txt").read_text() == text)


def prereg_text_checks() -> None:
    saved = (RS.prereg_problem, RS.PREREG)
    with tempfile.TemporaryDirectory() as folder:
        base = Path(folder)
        copy = base / "memoria_as_run.py"
        copy.write_text("# the code as it ran\n")
        RS.PREREG = base / "preregistration.json"
        RS.PREREG.write_text(json.dumps({"written": "2026-10-16 00:14:34 +0800", "memoria_py": RS.sha256_of(copy)}))
        try:
            RS.prereg_problem = lambda: None
            check("when nothing moved the statement says that everything is as pinned, with the date", P.prereg_statement(copy) == "code, config, conditions, memoria.py and the benchmark are those pinned on 2026-10-16 00:14:34 +0800")
            RS.prereg_problem = lambda: "changed since the pre-registration: memoria_py"
            fixed = P.prereg_statement(copy)
            check("when only memoria.py moved and the kept copy has the pinned hash, it says the fix came afterwards and the runs used the pinned code", "parser fix" in fixed and "has the pinned hash" in fixed and "pinned on 2026-10-16" in fixed, fixed)
            copy.write_text("# some other code\n")
            check("when the kept copy does not have the pinned hash the plain problem is given", P.prereg_statement(copy) == "changed since the pre-registration: memoria_py")
            RS.prereg_problem = lambda: "changed since the pre-registration: config, scoping.py"
            copy.write_text("# the code as it ran\n")
            check("any other change is named, whatever the copy says", P.prereg_statement(copy) == "changed since the pre-registration: config, scoping.py")
        finally:
            RS.prereg_problem, RS.PREREG = saved


def sweep_checks() -> None:
    class Embed:
        def encode(self, texts):
            out = np.zeros((len(texts), 256), dtype="float32")
            for i, t in enumerate(texts):
                for w in t.lower().split():
                    out[i, int(hashlib.md5(w.encode()).hexdigest(), 16) % 256] += 1
            n = np.linalg.norm(out, axis=1, keepdims=True)
            n[n == 0] = 1
            return out / n

    items = S.parse_memory("- [A:1] kinetic battery power\n- [A:2] rubber case material\n- [A:3] production cost twelve euro\n- [A:4] docking station\n- [A:5] teletext\n- [A:6] screen display\n- [A:7] shiny paint\n- [A:8] wrist strap\n")
    probes = [{"id": "p1", "series_id": "A", "statement": "kinetic battery power", "gold_label": "SUPPORTED_CURRENT", "gold_citation": "[A:1]", "expected_alert": False},
              {"id": "p2", "series_id": "A", "statement": "unknown words entirely", "gold_label": "CONTRADICTS", "gold_citation": "[A:7]", "expected_alert": True}]
    sweep = P.sweep_recall(Embed(), {"A": items}, probes)
    check("the sweep covers k = 1..8 with and without the rule, and at k = 8 (all eight decisions) the recall is 1", set(sweep) == {"no_rule", "rule"} and sorted(sweep["no_rule"]) == list(range(1, 9)) and sweep["no_rule"][8]["recall"] == 1.0)
    check("recall never falls as k grows, and the probe whose words match nothing is found only when the scope is wide", all(sweep["no_rule"][k]["found"] <= sweep["no_rule"][k + 1]["found"] for k in range(1, 8)) and sweep["no_rule"][1]["found"] == 1)
    check("the mean scope size at k is k (no money cue) and grows with the rule only when a statement mentions money", sweep["no_rule"][3]["mean_scope"] == 3.0 and sweep["rule"][3]["mean_scope"] == 3.0)


# ------------------------------------------------------------------ the real files

def real_checks() -> None:
    folder = RS.OUT / "_dev"
    if not (folder / "M3@C0.jsonl").exists():
        return
    rows, meta = P.load_runs(folder)
    check("the development predictions on disk are 60 probes each for M3@C0 and M2@C0, and are read in probe order", set(rows) == {"M3@C0", "M2@C0"} and all(len(r) == 60 for r in rows.values()) and [x["id"] for x in rows["M3@C0"]] == sorted(x["id"] for x in rows["M3@C0"]))
    conditions = json.loads((RS.OUT / "conditions.json").read_text())
    result = P.analyse(rows, meta, conditions, json.loads(RS.CONFIG.read_text()), None, None, {}, "n/a", {})
    check("analysis of the real development run flags it as incomplete (60 probes, not 336), yet compares M3 with M2 on the same probes", result["incomplete"] == ["M2@C0", "M3@C0"] and "M3@C0 vs M2@C0" in result["contrasts"], result["incomplete"])
    old = {r["id"]: r for r in R.read_lines(R.RESULTS / "dev" / "_work" / "M2.jsonl")}
    check("M2 at C0 on the development series reproduces the labels and the raw replies of the earlier run exactly", all(x["pred"] == old[x["id"]]["pred"] and x["raw"].strip() == old[x["id"]]["raw"].strip() for x in rows["M2@C0"]))

    work = RS.OUT / "_work"
    if all((work / f"{k}@{c}.jsonl").exists() for k in P.KINDS for c in P.CONDITIONS) and (RS.OUT / "scoping_results.json").exists():
        full, full_meta = P.load_runs(work)
        if all(len(r) == 336 for r in full.values()):
            conditions = json.loads((RS.OUT / "conditions.json").read_text())
            topic = json.loads((RS.OUT / "topic_latency.json").read_text())
            original = [r for r in E.load_predictions(E.RESULTS / "predictions_raw.jsonl") if r["system"] == "M2"]
            again = P.analyse(full, full_meta, conditions, json.loads(RS.CONFIG.read_text()), original, topic, json.loads((RS.OUT / "scoping_results.json").read_text()).get("sweep", {}) and {}, "x", None)
            disk = json.loads((RS.OUT / "scoping_results.json").read_text())
            check("results/scoping/scoping_results.json is what the analysis makes of the predictions on disk (verdicts, contrasts, table)",
                  json.loads(json.dumps(again["verdicts"], default=float)) == disk["verdicts"] and len(again["table"]) == len(disk["table"]) and all(abs(a["macro_f1"] - b["macro_f1"]) < 1e-9 for a, b in zip(again["table"], disk["table"])))
            ids = {s: [r["id"] for r in rows_] for s, rows_ in full.items()}
            check("every one of the six real systems answered the same 336 probes", len({tuple(v) for v in ids.values()}) == 1 and len(next(iter(ids.values()))) == 336)
            bench = R.read_lines(R.BENCH_FILE)
            check("and those are the frozen benchmark's probes, with its gold labels", all({r["id"]: r["gold_label"] for r in rows_} == {p["id"]: p["gold_label"] for p in bench} for rows_ in full.values()))


def main() -> int:
    citation_checks()
    summary_checks()
    contrast_checks()
    attribution_checks()
    verdict_checks()
    analysis_checks()
    sweep_checks()
    prereg_text_checks()
    real_checks()
    print(f"All {len(passed)} topic-scoping analysis checks passed: the counts, the pre-registered rules at their margins, and the honesty of the text.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
