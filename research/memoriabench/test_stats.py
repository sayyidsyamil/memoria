"""Test of the significance tests and the thesis exporter: the statistics against independent oracles, the plumbing, the honesty rules.

No language model is loaded here, so this can run while anything else does. What it proves:
  - McNemar's exact p equals scipy's binomial test, the chi-square carries the continuity correction, and the exact test never
    rejects a true null more often than alpha,
  - the sign test, the sign test by series and Holm's step-down match hand-worked cases and an independent reference,
  - the batch Macro-F1 equals scikit-learn's,
  - the permutation test equals a brute-force enumeration of every swap, gives p = 1 for identical systems, sits on its
    Monte-Carlo floor when it should, keeps its size on exchangeable systems and, with series as the unit, when whole series
    favour one system (the probe-level version does not: that is why the series-level numbers are the ones to cite),
  - the pairing refuses systems that did not answer the same probes,
  - the real predictions give the tables an independent count gives, and every file on disk is what the code makes of them,
  - the exporter escapes LaTeX, marks every tied best score, never bolds an interval, writes n/a where a number is missing,
    derives the counts it prints, and says "not significant" when the data say so,
  - the whole export, run on invented predictions in a temporary folder, writes every file and a manifest that verifies.

Run: python3.11 test_stats.py
"""

import contextlib
import csv
import hashlib
import io
import itertools
import json
import math
import random
import re
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy import stats
from sklearn.metrics import f1_score

import eval_metrics as E
import export_thesis_tables as X
import stat_tests as T

passed: list[str] = []
KIND = {"SUPPORTED_CURRENT": "S", "OUTDATED": "O", "CONTRADICTS": "C", "UPDATES": "U", "IRRELEVANT": "I", "INSUFFICIENT_EVIDENCE": "N"}
SERIES_28 = list(E.OFFICIAL_SUBSET) + [f"AB{i:04d}" for i in range(23)]


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


def close(a: float, b: float, eps: float = 1e-9) -> bool:
    return abs(a - b) <= eps


# ------------------------------------------------------------------ small data builders and oracles

def toy_probes(series: list[str], per_class: int = 2) -> list[dict]:
    probes = []
    for s in series:
        for label in E.CLASSES:
            for k in range(1, per_class + 1):
                probes.append({"id": f"{s}-{KIND[label]}-{k:02d}", "series_id": s, "statement": "a statement", "gold_label": label,
                               "gold_citation": f"[{s}c:00:1{k}]" if label in E.ALERTS else None, "expected_alert": label in E.ALERTS})
    return probes


def answer(probe: dict, system: str, pred: str, latency: float = 100.0, citation: str | None = None) -> dict:
    return {**probe, "system": system, "pred": pred, "alert": pred in E.ALERTS, "citation": (citation if citation is not None else (probe["gold_citation"] or "")) if pred in E.ALERTS else "",
            "raw": pred, "readable": True, "latency_ms": latency}


def macro_f1_python(gold: list[str], pred: list[str]) -> float:
    """Macro-F1 over the six classes, written out by hand: the oracle for the permutation tests."""
    total = 0.0
    for c in E.CLASSES:
        tp = sum(g == c and p == c for g, p in zip(gold, pred))
        fp = sum(g != c and p == c for g, p in zip(gold, pred))
        fn = sum(g == c and p != c for g, p in zip(gold, pred))
        total += 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else 0.0
    return total / len(E.CLASSES)


def exact_permutation_p(rows_a: list[dict], rows_b: list[dict], unit: str) -> tuple[float, float]:
    """The permutation p by trying every one of the 2^units swaps, on plain Python lists."""
    key = (lambda r: r["series_id"]) if unit == "series" else (lambda r: r["id"])
    units = sorted({key(r) for r in rows_a})
    gold = [r["gold_label"] for r in rows_a]
    owner = [key(r) for r in rows_a]
    pa, pb = [r["pred"] for r in rows_a], [r["pred"] for r in rows_b]
    observed = macro_f1_python(gold, pa) - macro_f1_python(gold, pb)
    extreme = 0
    for mask in itertools.product((False, True), repeat=len(units)):
        swapped = {u for u, m in zip(units, mask) if m}
        na = [(b if o in swapped else a) for a, b, o in zip(pa, pb, owner)]
        nb = [(a if o in swapped else b) for a, b, o in zip(pa, pb, owner)]
        if abs(macro_f1_python(gold, na) - macro_f1_python(gold, nb)) >= abs(observed) - 1e-12:
            extreme += 1
    return observed, extreme / 2 ** len(units)


def holm_reference(p: list[float]) -> list[float]:
    order = sorted(range(len(p)), key=lambda i: p[i])
    adjusted = [0.0] * len(p)
    for rank, i in enumerate(order):
        adjusted[i] = min(1.0, max((len(p) - r) * p[order[r]] for r in range(rank + 1)))
    return adjusted


def noisy_answers(rng: random.Random, probes: list[dict], system: str, accuracy: float, false_alarm: float = 0.0) -> list[dict]:
    """Invented answers: the gold class with probability `accuracy`, otherwise another; on a probe that is not a conflict,
    an alert with probability `false_alarm`."""
    rows = []
    for probe in probes:
        gold = probe["gold_label"]
        if not probe["expected_alert"] and rng.random() < false_alarm:
            pred = rng.choice(E.ALERTS)
        elif rng.random() < accuracy:
            pred = gold
        else:
            others = [c for c in E.CLASSES if c != gold and (probe["expected_alert"] or c not in E.ALERTS)]
            pred = rng.choice(others)
        cite = probe["gold_citation"] if rng.random() < 0.9 else "[XX0000a:99:99]"
        rows.append(answer(probe, system, pred, latency=rng.uniform(50, 300), citation=cite))
    return rows


# ------------------------------------------------------------------ McNemar

def mcnemar_checks() -> None:
    rng = random.Random(7)
    worst, cells_ok = 0.0, True
    for _ in range(300):
        n = rng.randint(1, 120)
        a = [rng.random() < 0.6 for _ in range(n)]
        b = [rng.random() < 0.5 for _ in range(n)]
        m = T.mcnemar(a, b)
        b_only = sum(x and not y for x, y in zip(a, b))
        c_only = sum(y and not x for x, y in zip(a, b))
        cells_ok &= (m["only_first"], m["only_second"], m["both_right"], m["both_wrong"]) == (b_only, c_only, sum(x and y for x, y in zip(a, b)), sum((not x) and (not y) for x, y in zip(a, b)))
        expected = 1.0 if b_only + c_only == 0 else float(stats.binomtest(min(b_only, c_only), b_only + c_only, 0.5).pvalue)
        worst = max(worst, abs(m["exact_p"] - expected))
    check("McNemar: the four cells of the table are what a direct count gives, on 300 random pairs", cells_ok)
    check("McNemar: the exact p equals scipy's two-sided binomial test on the same 300 pairs", worst < 1e-12, worst)

    ten = T.mcnemar([True] * 15, [False] * 10 + [True] * 5)
    check("McNemar b=10, c=0: p = 2 x 0.5^10", close(ten["exact_p"], 2 * 0.5 ** 10) and (ten["only_first"], ten["only_second"]) == (10, 0), ten)
    even = T.mcnemar([True, False] * 5, [False, True] * 5)
    check("McNemar b=5, c=5: p = 1", even["exact_p"] == 1.0, even)
    none = T.mcnemar([True, False, True], [True, False, True])
    check("McNemar with no discordant pair: p = 1, chi-square 0, no division by zero", none["exact_p"] == 1.0 and none["chi2"] == 0.0 and none["chi2_p"] == 1.0, none)
    worked = T.mcnemar([True] * 15 + [False] * 5, [False] * 15 + [True] * 5)
    check("McNemar b=15, c=5: chi-square = (|15 - 5| - 1)^2 / 20 = 4.05, with the continuity correction", close(worked["chi2"], 4.05) and close(worked["chi2_p"], float(stats.chi2.sf(4.05, 1))), worked)
    swapped = T.mcnemar([False] * 15 + [True] * 5, [True] * 15 + [False] * 5)
    check("swapping the two systems swaps b and c and leaves the p-value alone", (swapped["only_first"], swapped["only_second"]) == (5, 15) and close(swapped["exact_p"], worked["exact_p"]), swapped)

    never_above = True
    for n in range(1, 120):
        size = sum(float(stats.binom.pmf(b, n, 0.5)) for b in range(n + 1)
                   if T.mcnemar([True] * b + [False] * (n - b), [False] * b + [True] * (n - b))["exact_p"] <= 0.05)
        never_above &= size <= 0.05 + 1e-12
    check("the exact test never rejects a true null more often than alpha = 0.05, for 1 to 119 discordant pairs", never_above)


# ------------------------------------------------------------------ the sign test and Holm

def sign_and_holm_checks() -> None:
    check("sign test: 26 wins and 0 losses give 2 x 0.5^26", close(T.sign_test(26, 0), 2 * 0.5 ** 26, 1e-18))
    check("sign test: no pair, or an even split, gives 1", T.sign_test(0, 0) == 1.0 and T.sign_test(5, 5) == 1.0)
    check("sign test is symmetric and equals scipy's binomial test for every split up to 40 + 40",
          all(close(T.sign_test(w, l), T.sign_test(l, w)) and close(T.sign_test(w, l), 1.0 if w + l == 0 else float(stats.binomtest(min(w, l), w + l, 0.5).pvalue)) for w in range(41) for l in range(41)))

    first = [True, True, True, False, False, True, True, True]
    second = [True, False, False, True, True, True, False, False]
    series = ["A", "A", "B", "B", "C", "C", "D", "D"]
    s = T.series_sign(first, second, series)
    check("sign test by series, worked: A +1, B 0, C -1, D +2 gives 2 better, 1 worse, 1 tied", (s["series"], s["first_better"], s["second_better"], s["tied"]) == (4, 2, 1, 1) and close(s["exact_p"], T.sign_test(2, 1)), s)

    rng = random.Random(4)
    agree = True
    for _ in range(100):
        n = rng.randint(6, 60)
        names = [f"S{rng.randint(0, 9)}" for _ in range(n)]
        x, y = [rng.random() < 0.6 for _ in range(n)], [rng.random() < 0.5 for _ in range(n)]
        total: dict[str, int] = {}
        for a, b, name in zip(x, y, names):
            total[name] = total.get(name, 0) + (1 if a else 0) - (1 if b else 0)
        got = T.series_sign(x, y, names)
        agree &= (got["first_better"], got["second_better"], got["tied"]) == (sum(v > 0 for v in total.values()), sum(v < 0 for v in total.values()), sum(v == 0 for v in total.values()))
    check("sign test by series counts the series where one system was right on more probes, on 100 random cases", agree)

    adjusted = T.holm({"a": 0.01, "b": 0.04, "c": 0.03})
    check("Holm on 0.01, 0.04, 0.03 gives 0.03, 0.06, 0.06 (an adjusted p never falls below an earlier one)", close(adjusted["a"], 0.03) and close(adjusted["c"], 0.06) and close(adjusted["b"], 0.06), adjusted)
    grid = [0.001, 0.004, 0.01, 0.02, 0.02, 0.04, 0.2, 0.5, 0.9, 1.0]
    rng = random.Random(9)
    holm_ok, rules_ok = True, True
    for _ in range(300):
        p = [rng.choice(grid) for _ in range(rng.randint(1, 8))]
        got = T.holm({f"t{i}": v for i, v in enumerate(p)})
        got_list = [got[f"t{i}"] for i in range(len(p))]
        holm_ok &= all(close(x, y) for x, y in zip(got_list, holm_reference(p)))
        rules_ok &= all(raw <= adj + 1e-15 and adj <= 1.0 for raw, adj in zip(p, got_list)) and all((p[i] <= p[j]) <= (got_list[i] <= got_list[j] + 1e-15) for i in range(len(p)) for j in range(len(p)))
    check("Holm equals an independent step-down implementation on 300 random p-vectors with ties", holm_ok)
    check("Holm never lowers a p-value, never exceeds 1, and keeps the order of the p-values", rules_ok)
    check("Holm leaves a single p-value alone", T.holm({"only": 0.03}) == {"only": 0.03})


# ------------------------------------------------------------------ the batch Macro-F1

def f1_batch_checks() -> None:
    rng = np.random.default_rng(3)
    matrices = rng.integers(0, 6, size=(200, 6, 6)).astype(float)
    matrices[rng.random(matrices.shape) < 0.35] = 0
    matrices[:, 0, 0] += 1
    batch = T.macro_f1_batch(matrices)
    check("batch Macro-F1 equals eval_metrics.scores one matrix at a time (200 random matrices, empty rows and columns included)",
          np.allclose(batch, [E.scores(m.astype(np.int64))["macro_f1"] for m in matrices], atol=1e-12))

    py = random.Random(8)
    worst = 0.0
    for _ in range(100):
        n = py.randint(5, 80)
        y_true = [py.choice(E.CLASSES) for _ in range(n)]
        y_pred = [py.choice(E.CLASSES) if py.random() < 0.6 else t for t in y_true]
        matrix = E.confusion_matrix([{"gold_label": g, "pred": p} for g, p in zip(y_true, y_pred)])
        worst = max(worst, abs(T.macro_f1_batch(matrix[None])[0] - f1_score(y_true, y_pred, labels=list(E.CLASSES), average="macro", zero_division=0)),
                    abs(macro_f1_python(y_true, y_pred) - f1_score(y_true, y_pred, labels=list(E.CLASSES), average="macro", zero_division=0)))
    check("batch Macro-F1, and the hand-written oracle used below, equal scikit-learn's on 100 random label sets", worst < 1e-12, worst)


# ------------------------------------------------------------------ the permutation test

def exchangeable_pair(rng: random.Random, names: list[str], series_effect: float) -> tuple[list[dict], list[dict]]:
    """Two systems that, over the whole population of series, are interchangeable. Each series has its own difficulty and
    a shift that favours one system there and the other elsewhere; the shift has mean zero."""
    probes = toy_probes(names)
    rows_a, rows_b = [], []
    for s in names:
        q = rng.uniform(0.3, 0.7)
        shift = rng.uniform(-series_effect, series_effect)
        mine = [p for p in probes if p["series_id"] == s]
        rows_a += noisy_answers(rng, mine, "A", q + shift)
        rows_b += noisy_answers(rng, mine, "B", q - shift)
    return rows_a, rows_b


def permutation_checks() -> None:
    probes = toy_probes([f"S{i:02d}" for i in range(8)])
    rng = random.Random(11)
    guess = [rng.choice(E.CLASSES) for _ in probes]
    a = [answer(p, "X", g) for p, g in zip(probes, guess)]
    b = [answer(p, "Y", g) for p, g in zip(probes, guess)]
    same = T.paired_permutation(a, b, "series", 500)
    check("two identical systems: observed difference 0 and p = 1", same["observed"] == 0 and same["p"] == 1.0 and same["extreme"] == 500, same)

    big = toy_probes([f"S{i:02d}" for i in range(28)])
    perfect = [answer(p, "P", p["gold_label"]) for p in big]
    noise = noisy_answers(random.Random(5), big, "N", 0.0)
    floor = T.paired_permutation(perfect, noise, "series", 2000)
    check("a perfect system against a wrong one: no resample is as extreme, so p sits on the floor 1/(R + 1), and not on 0", floor["extreme"] == 0 and close(floor["p"], 1 / 2001) and floor["observed"] > 0.5, floor)
    check("the floor follows the number of resamples", all(close(T.paired_permutation(perfect, noise, "series", r)["p"], 1 / (r + 1)) for r in (99, 499)))

    mixed_a = noisy_answers(random.Random(1), probes, "A", 0.7)
    mixed_b = noisy_answers(random.Random(2), probes, "B", 0.4)
    run = T.paired_permutation(mixed_a, mixed_b, "series", 3000)
    direct = E.scores(E.confusion_matrix(mixed_a))["macro_f1"] - E.scores(E.confusion_matrix(mixed_b))["macro_f1"]
    check("the observed difference is macro-F1(first) minus macro-F1(second), as eval_metrics computes them", close(run["observed"], direct), (run["observed"], direct))
    check("p = (extreme + 1) / (resamples + 1) and the units are the series", close(run["p"], (run["extreme"] + 1) / 3001) and run["units"] == 8 and T.paired_permutation(mixed_a, mixed_b, "probe", 50)["units"] == len(probes), run)
    check("the same seed gives the same answer", T.paired_permutation(mixed_a, mixed_b, "series", 3000) == run)
    mirrored = T.paired_permutation(mixed_b, mixed_a, "series", 3000)
    check("swapping the two systems flips the sign of the difference and leaves p alone", close(mirrored["observed"], -run["observed"]) and mirrored["extreme"] == run["extreme"], (run, mirrored))
    check("the swap distribution is centred on zero and its 95% range is symmetric", abs(sum(run["null_95"])) < 0.05 and run["null_sd"] > 0, run)

    worst = 0.0
    for seed, (acc_a, acc_b) in enumerate([(0.7, 0.4), (0.55, 0.5), (0.9, 0.2), (0.6, 0.6)]):
        small = toy_probes([f"S{i:02d}" for i in range(8)], per_class=1)
        rows_a = noisy_answers(random.Random(100 + seed), small, "A", acc_a)
        rows_b = noisy_answers(random.Random(200 + seed), small, "B", acc_b)
        observed, exact = exact_permutation_p(rows_a, rows_b, "series")
        got = T.paired_permutation(rows_a, rows_b, "series", 40000)
        worst = max(worst, abs(got["p"] - exact), abs(got["observed"] - observed))
    check("series as the unit: the p-value equals the brute-force enumeration of all 256 swaps, within Monte-Carlo noise, on four datasets", worst < 0.012, worst)
    worst = 0.0
    for seed, (acc_a, acc_b) in enumerate([(0.8, 0.3), (0.5, 0.45)]):
        small = toy_probes([f"S{i:02d}" for i in range(2)], per_class=1)
        rows_a = noisy_answers(random.Random(300 + seed), small, "A", acc_a)
        rows_b = noisy_answers(random.Random(400 + seed), small, "B", acc_b)
        observed, exact = exact_permutation_p(rows_a, rows_b, "probe")
        got = T.paired_permutation(rows_a, rows_b, "probe", 40000)
        worst = max(worst, abs(got["p"] - exact), abs(got["observed"] - observed))
    check("single probes as the unit: the p-value equals the brute-force enumeration of all 4,096 swaps, within Monte-Carlo noise", worst < 0.012, worst)

    names = [f"S{i:02d}" for i in range(28)]
    rng = random.Random(2026)
    rejected = {"flat": [0, 0], "clustered": [0, 0]}  # series-level, probe-level
    trials = 400
    for _ in range(trials):
        for kind, effect in (("flat", 0.0), ("clustered", 0.3)):
            rows_a, rows_b = exchangeable_pair(rng, names, effect)
            rejected[kind][0] += T.paired_permutation(rows_a, rows_b, "series", 199)["p"] <= 0.05
            rejected[kind][1] += T.paired_permutation(rows_a, rows_b, "probe", 199)["p"] <= 0.05
    rates = {k: [x / trials for x in v] for k, v in rejected.items()}
    check("two interchangeable systems: both versions of the test reject about 5% of the time at alpha = 0.05", all(0.02 <= r <= 0.09 for r in rates["flat"]), rates)
    check("when whole series favour one system (and on average neither), the series-level test keeps its 5%", 0.02 <= rates["clustered"][0] <= 0.09, rates)
    check("and the probe-level test does not: it rejects far more often, which is why the series-level p-values are the ones to cite", rates["clustered"][1] >= 0.15, rates)


# ------------------------------------------------------------------ pairing, wording

def pairing_and_text_checks() -> None:
    probes = toy_probes(["S1", "S2"])
    rows = [answer(p, "X", p["gold_label"]) for p in probes] + [answer(p, "Y", "UPDATES") for p in reversed(probes)]
    a, b = T.paired_systems(rows, "X", "Y")
    check("the two systems come back in one order, by probe id", [r["id"] for r in a] == [r["id"] for r in b] == sorted(p["id"] for p in probes))
    for name, damaged in (("one probe fewer", [r for r in rows if r["id"] != probes[0]["id"] or r["system"] == "X"]),
                          ("a different probe", [r if not (r["system"] == "Y" and r["id"] == probes[0]["id"]) else {**r, "id": "OTHER-1"} for r in rows]),
                          ("the system missing", [r for r in rows if r["system"] != "Y"])):
        try:
            T.paired_systems(damaged, "X", "Y")
            refused = False
        except ValueError:
            refused = True
        check(f"the pairing refuses systems that did not answer the same probes ({name})", refused)

    cases = [({"alert": True, "expected_alert": True}, True), ({"alert": False, "expected_alert": False}, True), ({"alert": True, "expected_alert": False}, False), ({"alert": False, "expected_alert": True}, False)]
    check("an alert decision is right when the alert and the gold alert agree", all(T.alert_right(r) == want for r, want in cases))
    check("a label is right when it equals the gold label", T.label_right({"pred": "OUTDATED", "gold_label": "OUTDATED"}) and not T.label_right({"pred": "OUTDATED", "gold_label": "CONTRADICTS"}))

    check("a Monte-Carlo p at the floor is written 'p <= floor', never as a smaller number", T.p_text(1 / 10001, 10000) == "<= 0.0001" and T.p_text(1 / 401, 400) == "<= 0.0025")
    check("a Monte-Carlo p above the floor is written as it is", T.p_text(0.0003, 10000) == "0.0003" and T.p_text(0.375, 10000) == "0.375")
    check("an exact p is written in full or as a power of ten", T.p_text(1.6e-15) == "1.6e-15" and T.p_text(5e-5) == "5.0e-05" and T.p_text(0.0034) == "0.0034" and T.p_text(0.375) == "0.375" and T.p_text(0.05) == "0.0500")
    check("'significant' is p < 0.05, or p < 0.001 when that holds", T.verdict(0.0005) == "significant at 0.001" and T.verdict(0.005) == "significant at 0.05" and T.verdict(0.01) == "significant at 0.05" and T.verdict(0.05) == "not significant" and T.verdict(0.2) == "not significant")


# ------------------------------------------------------------------ the real predictions

def same_json(a: object, b: object, tol: float = 1e-9) -> bool:
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same_json(a[k], b[k], tol) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same_json(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, float) or isinstance(b, float):
        return abs(a - b) <= tol
    return a == b


def real_data_checks() -> None:
    predictions = E.load_predictions(E.RESULTS / "predictions_raw.jsonl")
    by = {(p["system"], p["id"]): p for p in predictions}
    ids = sorted(p["id"] for p in predictions if p["system"] == "M2")
    right = lambda system, i: by[(system, i)]["alert"] == by[(system, i)]["expected_alert"]
    check("every system answered every probe exactly once", all(sum(1 for p in predictions if p["system"] == s) == len(ids) == 336 for s in T.RIVALS + (T.SUBJECT,)) and len({(p["system"], p["id"]) for p in predictions}) == len(predictions))

    quick = T.run(predictions, 1000)
    again = T.run(predictions, 1000)
    check("the whole run is deterministic: two runs with one seed give the same result", json.dumps(quick, sort_keys=True) == json.dumps(again, sort_keys=True))
    check("five comparisons, M2 against each other system, and the Holm family is those five", list(quick["comparisons"]) == list(T.RIVALS) and quick["family_for_holm"] == sorted(T.RIVALS))

    for rival in T.RIVALS:
        c = quick["comparisons"][rival]
        counts = {"both": 0, "b": 0, "c": 0, "neither": 0}
        for i in ids:
            x, y = right("M2", i), right(rival, i)
            counts["both" if x and y else "b" if x else "c" if y else "neither"] += 1
        m = c["mcnemar_alert"]
        check(f"M2 against {rival}: the McNemar table equals an independent count over {len(ids)} probes", (m["both_right"], m["only_first"], m["only_second"], m["both_wrong"]) == (counts["both"], counts["b"], counts["c"], counts["neither"]), (m, counts))
        quiet = [i for i in ids if not by[("M2", i)]["expected_alert"]]
        noisy = [i for i in ids if by[("M2", i)]["expected_alert"]]
        check(f"M2 against {rival}: the false-alarm test runs on the {len(quiet)} probes that are not conflicts and the miss test on the {len(noisy)} that are", c["mcnemar_false_alarms"]["n"] == len(quiet) and c["mcnemar_misses"]["n"] == len(noisy) and len(quiet) + len(noisy) == len(ids))
        check(f"M2 against {rival}: Holm's p is the Holm step-down of the five McNemar p-values and is never lower", close(c["holm_p"], holm_reference([quick["comparisons"][r]["mcnemar_alert"]["exact_p"] for r in T.RIVALS])[T.RIVALS.index(rival)]) and c["holm_p"] >= m["exact_p"] - 1e-15)
        check(f"M2 against {rival}: the series-level sign test counts the 28 series", c["series_sign_alert"]["series"] == 28 and sum(c["series_sign_alert"][k] for k in ("first_better", "second_better", "tied")) == 28)
        check(f"M2 against {rival}: the permutation floor is stated as 1/(R + 1)", c["permutation_series"]["p"] >= 1 / 1001 - 1e-15 and c["permutation_probe"]["p"] >= 1 / 1001 - 1e-15)

    by_system = {s: [r for r in predictions if r["system"] == s] for s in T.RIVALS + (T.SUBJECT,)}
    rate = lambda s: sum(r["alert"] for r in by_system[s] if not r["expected_alert"]) / sum(1 for r in by_system[s] if not r["expected_alert"])
    disk = json.loads((E.RESULTS / "stat_tests.json").read_text(encoding="utf-8"))
    check("results/stat_tests.json is what stat_tests.py makes of results/predictions_raw.jsonl", same_json(disk, json.loads(json.dumps(T.run(predictions, disk["resamples"])))))
    shown = T.describe(disk)
    check("the printed report names the five comparisons, the Holm p, the false-alarm test and both permutation p-values", all(f"M2 vs {r}" in shown for r in T.RIVALS) and shown.count("(Holm") == 5 and shown.count("False alarms on the") == 5 and shown.count("single probes swapped p") == 5)
    check("the printed false-alarm line gives each pair's rates as a plain count of alerts on the probes that are not conflicts", all(f"{rate(r):.1%} ({r}) -> {rate('M2'):.1%} (M2)" in shown for r in T.RIVALS))
    check("the printed McNemar line gives b and c as counted, and each series line the series as counted",
          all(f"only M2 right b={alert_pairs(predictions, 'M2', r)[0]}, only {r} right c={alert_pairs(predictions, 'M2', r)[1]}" in shown for r in T.RIVALS))

    with tempfile.TemporaryDirectory() as folder:
        out = Path(folder) / "table.csv"
        meta = E.load_meta(E.RESULTS / "_work")
        basis = {p["id"]: p["basis"] for p in map(json.loads, (X.DATA / "memoria_bench.provenance.jsonl").read_text(encoding="utf-8").splitlines()) if p.get("basis")}
        with contextlib.redirect_stdout(io.StringIO()):
            E.report(predictions, meta, basis, out, Path(folder) / "per_class.csv")
        check("results/table_6_1.csv and per_class.csv are what eval_metrics makes of the predictions", out.read_bytes() == (E.RESULTS / "table_6_1.csv").read_bytes() and (Path(folder) / "per_class.csv").read_bytes() == (E.RESULTS / "per_class.csv").read_bytes())

        text_a = X.main_tables(predictions, meta, False)
        text_b = X.main_tables(predictions, meta, True)
        text_c = X.class_tables(predictions, basis)
        text_d = X.test_tables(disk)
        for stem, (tex, md) in (("chapter_6_table_1", text_a), ("chapter_6_table_1b", text_b), ("chapter_6_table_2", text_c), ("chapter_6_table_3", text_d)):
            check(f"results/{stem}.tex and .md are what the exporter makes of the results", (E.RESULTS / f"{stem}.tex").read_text(encoding="utf-8") == tex and (E.RESULTS / f"{stem}.md").read_text(encoding="utf-8") == md)
        check("results/confusion_matrix_m2.txt and statistical_summary.txt are what the exporter makes of the results",
              (E.RESULTS / "confusion_matrix_m2.txt").read_text(encoding="utf-8") == X.confusion_text(predictions)[0]
              and (E.RESULTS / "statistical_summary.txt").read_text(encoding="utf-8") == X.summary_text(predictions, meta, disk, basis, E.RESULTS / "predictions_raw.jsonl", X.DATA / "memoria_bench.jsonl"))

    manifest = {line.split("  ", 1)[1]: line.split("  ", 1)[0] for line in (E.RESULTS / "results_manifest.sha256").read_text(encoding="utf-8").splitlines()}
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    check("the manifest lists the frozen benchmark and the raw predictions, and their hashes are the files' hashes today",
          manifest["data/memoria_bench.jsonl"] == sha(X.DATA / "memoria_bench.jsonl") and manifest["results/predictions_raw.jsonl"] == sha(E.RESULTS / "predictions_raw.jsonl"), manifest.keys())
    check("the manifest covers the data, the results, the exports and the code", {"results/stat_tests.json", "results/chapter_6_table_1.tex", "stat_tests.py", "export_thesis_tables.py", "run_benchmarks.py", "memoria.py"} <= set(manifest), sorted(manifest))


# ------------------------------------------------------------------ the exporter, unit by unit

def gold_rows(text: str) -> list[list[str]]:
    """The six gold-class rows of a confusion-matrix text, split into tokens: a class name followed by numbers."""
    return [l.split() for l in text.splitlines() if l.split() and l.split()[0] in E.CLASSES and l.split()[1].isdigit()]


def table_cells(rows: dict[str, dict], style: str, intervals: bool = False) -> dict[str, list[str]]:
    return {r[0].split(" ")[0].strip("\\"): r[1:] for r in X.cells(rows, style, intervals)}


def exporter_unit_checks() -> None:
    check("LaTeX escaping covers & % _ # < >", X.tex_escape("A & B_C 50% #1 <x> y") == r"A \& B\_C 50\% \#1 \textless{}x\textgreater{} y")
    check("a p-value becomes a power of ten or a symbol, and a plain decimal is left alone",
          X.tex_p("1.6e-15") == r"$1.6\times10^{-15}$" and X.tex_p("5.0e-05") == r"$5.0\times10^{-5}$" and X.tex_p("<= 0.0001") == r"$\le$ 0.0001" and X.tex_p("0.0034") == "0.0034" and X.tex_p("3.7e-22 (1.5e-21)") == r"$3.7\times10^{-22}$ ($1.5\times10^{-21}$)")

    full = lambda **kw: {"accuracy": 0.5, "macro_f1": 0.5, "alert_precision": 0.5, "alert_recall": 0.5, "false_alarm": 0.5, "p50_ms": 1000.0, "p95_ms": 2000.0, "peak_gb": 3.0, **kw}
    best = X.best_values({"M2": full(accuracy=0.8721, false_alarm=0.004, p50_ms=2274.4), "A1": full(accuracy=0.8724, false_alarm=0.018, p50_ms=2554.0), "B2": full(accuracy=0.616, false_alarm=0.018, p50_ms=2391.0)})
    check("the best value is the highest where higher is better and the lowest where lower is better", best["accuracy"] == "87.2" and best["false_alarm"] == "0.4" and best["p50_ms"] == "2,274", best)

    md = table_cells({"M2": full(accuracy=0.8721, false_alarm=0.004), "A1": full(accuracy=0.8724, false_alarm=0.018)}, "md")
    check("systems that show the same number are all marked best: no row is made to look better than one that shows the same", md["M2"][0] == "**87.2**" and md["A1"][0] == "**87.2**" and md["M2"][4] == "**0.4**" and md["A1"][4] == "1.8", md)

    holes = table_cells({"M2": full(alert_precision=float("nan"), peak_gb=None), "A1": full(alert_precision=0.5)}, "md")
    tex = table_cells({"M2": full(alert_precision=float("nan"), peak_gb=None), "A1": full(alert_precision=0.5)}, "tex")
    check("a missing number is n/a in Markdown and -- in LaTeX, and never counts as best or as zero", holes["M2"][2] == "n/a" and holes["M2"][7] == "n/a" and tex["M2"][2] == "--" and tex["M2"][7] == "--" and holes["A1"][2] == "**0.50**", (holes, tex))

    thousands = table_cells({"M2": full(p50_ms=2274.4, p95_ms=12345.0)}, "tex")["M2"]
    check("thousands are separated with a comma in Markdown and with {,} in LaTeX", table_cells({"M2": full(p50_ms=2274.4, p95_ms=12345.0)}, "md")["M2"][5:7] == ["**2,274**", "**12,345**"] and "2{,}274" in thousands[5] and "12{,}345" in thousands[6], thousands)

    with_ci = {"M2": {**full(macro_f1=0.8712), "ci": {"macro_f1": (0.84, 0.9)}}, "A1": full(macro_f1=0.7)}
    md_ci, tex_ci = table_cells(with_ci, "md", True), table_cells(with_ci, "tex", True)
    check("the interval follows the score and is never bold: it is not the score", md_ci["M2"][1] == "**0.87** [0.84, 0.90]" and tex_ci["M2"][1] == r"\textbf{0.87} {\scriptsize [0.84, 0.90]}" and md_ci["A1"][1] == "0.70", (md_ci, tex_ci))
    check("no interval is written where none was asked for", table_cells(with_ci, "md", False)["M2"][1] == "**0.87**")

    body = [["B2 Transcript RAG", "1", "2"], ["M2 Full Memoria (proposed)", r"\textbf{3}", "4"], ["A1 M2 without notes", "5", "6"]]
    sheet = X.tex_table("tab:probe", "A caption.", ["System", "One", "Two"], body, rule_before={"M2"})
    lines = sheet.splitlines()
    check("a LaTeX table has the table environment, caption, label and booktabs rules, and the rows keep their order",
          lines[0] == r"\begin{table}[tbp]" and lines[-1] == r"\end{table}" and r"\caption{A caption.}" in lines and r"\label{tab:probe}" in lines and r"\toprule" in lines and r"\bottomrule" in lines and sheet.index("B2 Transcript") < sheet.index("M2 Full") < sheet.index("A1 M2"), sheet)
    check("the extra rule falls before the M2 row and nowhere else", sheet.count(r"\midrule") == 2 and lines[lines.index(next(l for l in lines if l.startswith("M2 Full"))) - 1] == r"\midrule", sheet)
    check("the column specification has one letter per head, the first left-aligned and the others right-aligned", r"\begin{tabular}{@{}lrr@{}}" in sheet)

    sheet_md = X.md_table("Title", ["System", "One", "Two"], [["a", "1", "2"]], "A note.").splitlines()
    check("a Markdown table has a title, a header, a left/right alignment row, the body and a note", sheet_md[0] == "**Title**" and sheet_md[2] == "| System | One | Two |" and sheet_md[3] == "|:--|--:|--:|" and sheet_md[4] == "| a | 1 | 2 |" and sheet_md[-1] == "A note.", sheet_md)

    names = {s: X.tex_escape(X.TEX_NAMES[s]) for s in X.ORDER}
    check("every system has a LaTeX and a Markdown name, and the order is the table's", set(X.TEX_NAMES) == set(X.MD_NAMES) == set(X.ORDER) and X.ORDER.index("M2") == 4 and "$" in names["B1"] and "≥" in X.MD_NAMES["B1"])

    wrong = [("SUPPORTED_CURRENT", "SUPPORTED_CURRENT")] * 4 + [("OUTDATED", "CONTRADICTS")] * 3 + [("OUTDATED", "OUTDATED")] + [("CONTRADICTS", "CONTRADICTS")] * 3 + [("CONTRADICTS", "OUTDATED")] \
        + [("UPDATES", "UPDATES")] * 4 + [("IRRELEVANT", "IRRELEVANT")] * 3 + [("IRRELEVANT", "INSUFFICIENT_EVIDENCE")] + [("INSUFFICIENT_EVIDENCE", "INSUFFICIENT_EVIDENCE")] * 4
    rows = [{"system": "M2", "id": f"x{i}", "series_id": "S", "gold_label": g, "pred": p, "alert": p in E.ALERTS, "expected_alert": g in E.ALERTS} for i, (g, p) in enumerate(wrong)]
    text, info = X.confusion_text(rows)
    count = {}
    for g, p in wrong:
        count[(g, p)] = count.get((g, p), 0) + 1
    expected = [[count.get((g, p), 0) for p in E.CLASSES] for g in E.CLASSES]
    parsed = [[int(x) for x in tokens[1:7]] for tokens in gold_rows(text)]
    check("the confusion matrix in the text is the pairs counted by hand, rows gold and columns predicted", info["matrix"] == expected and parsed == expected, (parsed, expected))
    check("it says in how many rows the diagonal is largest, and names the row where it is not (OUTDATED: 1 right, 3 sent to CONTRADICTS)", info["dominant"] == [True, False, True, True, True, True] and "in 5 of 6 rows (not in: OUTDATED)" in text, text)
    recall_column = [tokens[-1] for tokens in gold_rows(text)]
    precision_row = next(l for l in text.splitlines() if l.startswith("precision")).split()[1:]
    check("the recall of each gold row and the precision of each predicted column in the text are the hand-counted diagonal over the row and over the column",
          recall_column == ["100.0%", "25.0%", "75.0%", "100.0%", "75.0%", "100.0%"] and precision_row == ["1.00", "0.50", "0.50", "1.00", "1.00", "0.80"], (recall_column, precision_row))
    wrong_total = sum(1 for g, p in wrong if g != p)
    caught = sum(1 for g, p in wrong if g in E.ALERTS and p in E.ALERTS)
    check("it counts the wrong probes, where they went, the alerts caught and the two alert classes taken for each other",
          f"Where the {wrong_total} wrong probes went" in text and "  3  OUTDATED -> CONTRADICTS" in text and f"caught {caught} of 8 gold alerts" in text and f"OUTDATED and CONTRADICTS taken for each other: 4 of the {wrong_total} wrong probes" in text, text)


    small = [("OUTDATED", "OUTDATED"), ("OUTDATED", "CONTRADICTS"), ("OUTDATED", "UPDATES"), ("CONTRADICTS", "CONTRADICTS"), ("CONTRADICTS", "SUPPORTED_CURRENT"),
             ("IRRELEVANT", "IRRELEVANT"), ("IRRELEVANT", "IRRELEVANT"), ("IRRELEVANT", "IRRELEVANT"), ("IRRELEVANT", "OUTDATED")]
    rows = [{"system": "M2", "id": f"y{i}", "series_id": "S", "gold_label": g, "pred": p, "alert": p in E.ALERTS, "expected_alert": g in E.ALERTS} for i, (g, p) in enumerate(small)]
    alert_text, _ = X.confusion_text(rows)
    check("the alert line counts the gold alerts caught (3 of 5) and the false alarms among the probes that are not alerts (1 of 4), numbers that differ from each other and from the misses",
          "caught 3 of 5 gold alerts, 1 false alarm on 4 probes that are not alerts." in alert_text and "OUTDATED and CONTRADICTS taken for each other: 1 of the 4 wrong probes" in alert_text, alert_text)
    check("a class with no gold probe shows n/a for its recall, not nan and not a warning", "n/a" in alert_text and not re.search(r"\bnan\b", alert_text), alert_text)
    check("and with two false alarms the line says 'alarms'", "2 false alarms on" in X.confusion_text([{**r, "pred": "OUTDATED" if r["id"] == "y6" else r["pred"], "alert": r["alert"] or r["id"] == "y6"} for r in rows])[0])


# ------------------------------------------------------------------ the whole export, on invented predictions

def write_tree(root: Path, rows: list[dict], with_meta: tuple[str, ...]) -> None:
    (root / "data").mkdir()
    (root / "results" / "_work").mkdir(parents=True)
    probes = [r for r in rows if r["system"] == "M2"]
    fields = ("id", "series_id", "statement", "gold_label", "gold_citation", "expected_alert")
    (root / "data" / "memoria_bench.jsonl").write_text("".join(json.dumps({k: p[k] for k in fields}) + "\n" for p in probes), encoding="utf-8")
    outdated = [p["id"] for p in probes if p["gold_label"] == "OUTDATED"]
    provenance = [{"id": p["id"], **({"basis": "real-supersession" if p["id"] in outdated[:3] else "synthetic-supersession"} if p["gold_label"] == "OUTDATED" else {})} for p in probes]
    (root / "data" / "memoria_bench.provenance.jsonl").write_text("".join(json.dumps(p) + "\n" for p in provenance), encoding="utf-8")
    (root / "results" / "predictions_raw.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    for system in with_meta:
        (root / "results" / "_work" / f"{system}.meta.json").write_text(json.dumps({"peak_gb": 3.5, "probes": len(probes)}), encoding="utf-8")


def invented(seed: int, false_alarms: dict[str, float], accuracy: dict[str, float] | None = None) -> list[dict]:
    probes = toy_probes(SERIES_28)
    rng = random.Random(seed)
    accuracy = {"M2": 0.92, "B2": 0.62, "B1": 0.35, "B0": 0.45, "B1b": 0.4, "A1": 0.78, **(accuracy or {})}
    return [row for system, acc in accuracy.items() for row in noisy_answers(rng, probes, system, acc, false_alarms.get(system, 0.0))]


def alert_pairs(rows: list[dict], first: str, second: str) -> tuple[int, int]:
    """b and c of the McNemar table on the alert decision, counted from the rows with plain loops."""
    by = {(r["system"], r["id"]): r for r in rows}
    b = c = 0
    for i in sorted({r["id"] for r in rows if r["system"] == first}):
        x = by[(first, i)]["alert"] == by[(first, i)]["expected_alert"]
        y = by[(second, i)]["alert"] == by[(second, i)]["expected_alert"]
        b += x and not y
        c += y and not x
    return b, c


def table_rows(md: str) -> dict[str, list[str]]:
    """The body rows of a Markdown table, by system name, as lists of stripped cells."""
    out = {}
    for line in md.splitlines():
        if line.startswith("| ") and not line.startswith("| System") and not line.startswith("| M2 against"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            out[cells[0]] = cells[1:]
    return out


def latex_problems(text: str) -> list[str]:
    """What would stop a booktabs table from compiling, found without a TeX engine: unbalanced braces or dollars, a stray special character, rows of the wrong width."""
    problems = []
    plain = re.sub(r"\\[{}$%&_#]", "", text)
    if plain.count("{") != plain.count("}"):
        problems.append("unbalanced braces")
    if text.replace("\\$", "").count("$") % 2:
        problems.append("odd number of dollar signs")
    for line in text.splitlines():
        stripped = re.sub(r"\\[{}$%&_#]", "", line)
        if re.search(r"[%#]", stripped) or ("_" in stripped and not stripped.startswith("\\label")):
            problems.append(f"stray special character: {line[:60]}")
    tabular = next(l for l in text.splitlines() if l.startswith("\\begin{tabular}"))
    columns = len(re.findall(r"[lrc]", re.search(r"\{@\{\}([lrc]+)@\{\}\}", tabular).group(1)))
    rows = [l for l in text.splitlines() if l.endswith("\\\\")]
    widths = {len(re.sub(r"\\&", "", l).split("&")) for l in rows}
    if widths != {columns}:
        problems.append(f"rows of width {widths}, table of {columns}")
    for word in ("nan", "None", "inf"):
        if re.search(rf"\b{word}\b", text):
            problems.append(f"the word {word}")
    return problems


def exporter_pipeline_checks() -> None:
    real_before = {f: hashlib.sha256(f.read_bytes()).hexdigest() for f in (E.RESULTS / "predictions_raw.jsonl", E.RESULTS / "stat_tests.json", X.DATA / "memoria_bench.jsonl", E.RESULTS / "results_manifest.sha256")}
    outcomes = {}
    for label, noise, accuracy in (("quiet", {"B2": 0.003, "M2": 0.003}, None), ("noisy", {"B2": 0.35, "M2": 0.003}, None), ("louder", {"B2": 0.003, "M2": 0.35}, None),
                                   ("embedding", {"B1": 0.35, "B2": 0.003, "M2": 0.003}, {"B1": 0.92})):
        rows = invented(2026, noise, accuracy)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            write_tree(root, rows, ("M2", "A1", "B2"))
            written = X.export(root / "results", 400, root / "data")
            names = sorted(p.name for p in written)
            files = {n: (root / "results" / n).read_text(encoding="utf-8") for n in names}
            outcomes[label] = {"names": names, "files": files, "rows": rows, "root_files": sorted(p.name for p in (root / "results").iterdir() if p.is_file())}
            manifest = (root / "results" / "results_manifest.sha256").read_text(encoding="utf-8").splitlines()
            ok = True
            for line in manifest:
                digest, name = line.split("  ", 1)
                path = root / name if (root / name).exists() else X.HERE / name
                ok &= path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == digest
            outcomes[label]["manifest_ok"], outcomes[label]["manifest_names"] = ok, [line.split("  ", 1)[1] for line in manifest]
    quiet = outcomes["quiet"]
    expected = sorted(f"chapter_6_table_{k}.{e}" for k in ("1", "1b", "2", "3") for e in ("tex", "md")) + ["confusion_matrix_m2.txt", "results_manifest.sha256", "statistical_summary.txt"]
    check("the export, on invented predictions, writes the four tables in both formats, the confusion matrix, the summary and the manifest", quiet["names"] == sorted(expected), quiet["names"])
    check("and it writes them, and stat_tests.json, only in the folder it was given", set(quiet["root_files"]) >= set(expected) | {"stat_tests.json"} and all(hashlib.sha256(f.read_bytes()).hexdigest() == h for f, h in real_before.items()))
    check("the manifest it writes verifies, line by line, and names the data, the results, the exports and the code", all(o["manifest_ok"] for o in outcomes.values()) and {"data/memoria_bench.jsonl", "results/predictions_raw.jsonl", "results/stat_tests.json", "results/chapter_6_table_1.tex", "stat_tests.py"} <= set(outcomes["noisy"]["manifest_names"]), outcomes["noisy"]["manifest_names"])

    rows = quiet["rows"]
    m2 = [r for r in rows if r["system"] == "M2"]
    f1 = f1_score([r["gold_label"] for r in m2], [r["pred"] for r in m2], labels=list(E.CLASSES), average="macro", zero_division=0)
    md = quiet["files"]["chapter_6_table_1.md"]
    line = next(l for l in md.splitlines() if l.startswith("| M2 Full Memoria"))
    cell = [c.strip() for c in line.strip("|").split("|")]
    check("the Macro-F1 in the exported table is scikit-learn's Macro-F1 of the invented predictions, to two decimals", cell[2].split(" ")[0].strip("*") == f"{f1:.2f}", (cell, f1))
    accuracy = sum(r["pred"] == r["gold_label"] for r in m2) / len(m2)
    check("and the accuracy is a count of the right answers", cell[1].strip("*") == f"{100 * accuracy:.1f}", (cell, accuracy))
    latency = [r["latency_ms"] for r in m2]
    check("and the P50 and P95 columns are percentiles of the latencies, in that order", (cell[6].strip("*"), cell[7].strip("*")) == (f"{np.percentile(latency, 50):,.0f}", f"{np.percentile(latency, 95):,.0f}"), (cell, np.percentile(latency, [50, 95])))
    b0 = next(l for l in md.splitlines() if l.startswith("| B0")).strip("|").split("|")
    check("a system without a measured memory shows n/a in the memory column, one with it shows it", b0[-1].strip() == "n/a" and cell[-1].strip("*") == "3.5", md)

    for label, out in outcomes.items():
        problems = {name: latex_problems(text) for name, text in out["files"].items() if name.endswith(".tex")}
        check(f"all four LaTeX tables are well formed when the data are invented ({label}): balanced, no stray characters, every row as wide as the head", all(not v for v in problems.values()), problems)
    for name in ("chapter_6_table_1.tex", "chapter_6_table_1b.tex", "chapter_6_table_2.tex", "chapter_6_table_3.tex"):
        text = (E.RESULTS / name).read_text(encoding="utf-8")
        check(f"the LaTeX written for the real results is well formed: {name}", not latex_problems(text), latex_problems(text))

    summary = {label: out["files"]["statistical_summary.txt"] for label, out in outcomes.items()}
    for label, text in summary.items():
        check(f"the summary ({label}) says that nothing in it is asserted, and gives the speed-target rule, the Monte-Carlo floor and the series-level advice",
              "Nothing in this file is asserted" in text and "No speed target is set" in text and "p <= 0.0025" in text and "cite the series-level tests" in text, text[:400])
        check(f"the summary ({label}) never claims a pre-registered target, and says the ablation is not a proof of the thesis", "pre-registered" not in text.lower() and "not a proof of the thesis" in text.lower())
        check(f"the summary ({label}) states the probe and series counts it computed, not typed ones", "1. HEADLINE (336 probes, 28 series)" in text and "Official AMI unseen subset (60 probes, 5 series;" in text)
        check(f"the summary ({label}) counts the real OUTDATED probes from the provenance", "Only 3 OUTDATED probes rest on a real supersession" in text, text[-900:])
    check("when B2 and M2 raise about the same false alarms the summary says it is NOT a significant difference, and warns against claiming it", "NOT a significant difference in false alarms" in summary["quiet"] and "Do not write that Memoria raises fewer false alarms" in summary["quiet"])
    check("when B2 raises many more false alarms than M2 the summary says M2 has fewer, and no longer warns against saying so", "Fewer false alarms as well" in summary["noisy"] and "Do not write that Memoria raises fewer" not in summary["noisy"] and "NOT a significant difference in false alarms" not in summary["noisy"])
    check("when M2 raises many more false alarms than B2 the summary says so plainly", "M2 raised MORE false alarms than B2" in summary["louder"] and "Fewer false alarms as well" not in summary["louder"])
    check("the main-table caption states the series it resampled, and the paired-test caption the number of resamples", "resampling the 28 series" in quiet["files"]["chapter_6_table_1.md"] and "400 resamples" in quiet["files"]["chapter_6_table_3.md"] and "1/401" in quiet["files"]["chapter_6_table_3.md"])
    check("the per-class table splits OUTDATED by the provenance: 3 real probes and the rest synthetic", "real (3)" in quiet["files"]["chapter_6_table_2.md"] and "synthetic (53)" in quiet["files"]["chapter_6_table_2.md"], quiet["files"]["chapter_6_table_2.md"][:300])

    check("when M2 is wrong more often than B2 on the alert decision the summary says 'less often', and when it is right more often 'more often'",
          "right less often for M2" in summary["louder"] and "right more often for M2" in summary["quiet"] and "right more often for M2" in summary["noisy"])
    first_line = lambda text: next(l for l in text.splitlines() if l.startswith("- M2 against B1"))
    check("against embeddings, when neither raises false alarms but M2 finds far more of the conflicts: the false-alarm difference is 'not significant' and the alert-recall difference 'significant'",
          "(exact p 1.000, not significant). Alert recall" in first_line(summary["quiet"]) and first_line(summary["quiet"]).endswith("(significant).") and "finds the conflicts about as well" not in first_line(summary["quiet"]), first_line(summary["quiet"]))
    check("against embeddings, when M2 raises the false alarms: both differences are 'significant'", ", significant). Alert recall" in first_line(summary["louder"]) and first_line(summary["louder"]).endswith("(significant)."), first_line(summary["louder"]))
    embedding = summary["embedding"]
    line = next(l for l in embedding.splitlines() if l.startswith("- M2 against B1"))
    check("when embeddings catch the conflicts as well as M2 but raise many false alarms, the summary says that, and what they flag", "(not significant)" in line.split("Alert recall")[1] and ", significant)" in line.split("Alert recall")[0] and "finds the conflicts about as well" in line, line)
    check("and when they do not catch them as well it does not say they do", "finds the conflicts about as well" not in summary["quiet"] and "finds the conflicts about as well" not in summary["noisy"])

    title_1b = quiet["files"]["chapter_6_table_1b.md"].splitlines()[0]
    check("the official-subset table covers the five official series and 60 probes", title_1b.startswith("**Results on the official AMI unseen subset (60 probes in 5 series: ES2004, ES2014, IS1009, TS3003, TS3007)"), title_1b)

    bold_ok = True
    classes = X.class_tables(quiet["rows"], {})[1]
    for out in outcomes.values():
        table = table_rows(out["files"]["chapter_6_table_2.md"])
        for column in range(8):
            cells = {name: row[column] for name, row in table.items()}
            numbers = {name: float(c.strip("*")) for name, c in cells.items() if c != "n/a"}
            if not numbers:
                continue
            top = max(numbers.values())
            bold_ok &= all(cells[name].startswith("**") == (v == top) for name, v in numbers.items())
    check("in the per-class table the bold cells are exactly the highest recall of each column", bold_ok)

    for label, out in outcomes.items():
        m2 = [r for r in out["rows"] if r["system"] == "M2"]
        silent = [r for r in m2 if not r["expected_alert"]]
        cited = [r for r in m2 if r["expected_alert"] and r["alert"]]
        exact = sum(r["citation"] == r["gold_citation"] for r in cited)
        text = summary[label]
        macro = lambda rows: f1_score([r["gold_label"] for r in rows], [r["pred"] for r in rows], labels=list(E.CLASSES), average="macro", zero_division=0)
        sub = [r for r in m2 if r["series_id"] in E.OFFICIAL_SUBSET]
        tp = sum(r["alert"] and r["expected_alert"] for r in sub)
        fp = sum(r["alert"] and not r["expected_alert"] for r in sub)
        fn = sum((not r["alert"]) and r["expected_alert"] for r in sub)
        quiet_sub = sum(1 for r in sub if not r["expected_alert"])
        tp_all, fp_all = sum(r["alert"] and r["expected_alert"] for r in m2), sum(r["alert"] and not r["expected_alert"] for r in m2)
        fn_all = sum((not r["alert"]) and r["expected_alert"] for r in m2)
        latencies = [r["latency_ms"] for r in m2]
        check(f"the headline numbers in the summary ({label}) are plain counts of the invented M2 answers: accuracy, Macro-F1, precision, recall, false alarms, latency, memory, citations, and the official subset's numbers",
              f"M2 (Full Memoria): Macro-F1 {macro(m2):.2f} [" in text and f"accuracy {sum(r['pred'] == r['gold_label'] for r in m2) / len(m2):.1%}, alert precision {tp_all / (tp_all + fp_all):.2f} [" in text
              and f"alert recall {tp_all / (tp_all + fn_all):.2f} [" in text and f"P50 {np.percentile(latencies, 50):,.0f} ms, P95 {np.percentile(latencies, 95):,.0f} ms; peak footprint 3.5 GB" in text
              and f"false alarms {sum(r['alert'] for r in silent)} of {len(silent)} non-conflicts" in text
              and f"exactly the gold decision on {exact} of {len(cited)} true alerts" in text
              and f"Macro-F1 {macro(sub):.2f}, alert precision {tp / (tp + fp):.2f}, alert recall {tp / (tp + fn):.2f}, false alarm {fp / quiet_sub:.1%}." in text, text[:900])
        table_1 = next(l for l in out["files"]["chapter_6_table_1.md"].splitlines() if l.startswith("| M2 Full Memoria"))
        table_1b = next(l for l in out["files"]["chapter_6_table_1b.md"].splitlines() if l.startswith("| M2 Full Memoria"))
        check(f"the bootstrap interval is in the full table and absent from the official-subset table ({label})", "[" in table_1 and "[" not in table_1b, (table_1, table_1b))

    for label, out in outcomes.items():
        table = table_rows(out["files"]["chapter_6_table_3.md"])
        raw = [stats.binomtest(min(alert_pairs(out["rows"], "M2", r)), sum(alert_pairs(out["rows"], "M2", r)), 0.5).pvalue if sum(alert_pairs(out["rows"], "M2", r)) else 1.0 for r in T.RIVALS]
        adjusted = holm_reference(raw)
        good = True
        for n, rival in enumerate(T.RIVALS):
            b, c = alert_pairs(out["rows"], "M2", rival)
            row = table[X.MD_NAMES[rival]]
            f1 = lambda system: f1_score([r["gold_label"] for r in out["rows"] if r["system"] == system], [r["pred"] for r in out["rows"] if r["system"] == system], labels=list(E.CLASSES), average="macro", zero_division=0)
            good &= row[0].split(" ")[0] == f"{f1('M2') - f1(rival):+.2f}"
            good &= row[1] == f"{b} / {c}" and row[2] == f"{T.p_text(raw[n])} ({T.p_text(adjusted[n])})"
        check(f"in the paired-test table ({label}) every difference, b / c and McNemar p with its Holm p is what an independent count gives", good, table)

    confusion = quiet["files"]["confusion_matrix_m2.txt"]
    check("the exported confusion matrix has all 336 probes, and every gold row totals 56", "(336 probes)" in confusion and len([tokens for tokens in gold_rows(confusion) if tokens[-2] == "56"]) == 6, confusion[:900])


# ------------------------------------------------------------------ the command line

def cli_checks() -> None:
    with tempfile.TemporaryDirectory() as folder:
        out = Path(folder) / "stat_tests.json"
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = T.main(["--resamples", "300", "--out", str(out)])
        printed = buffer.getvalue()
        saved = json.loads(out.read_text(encoding="utf-8"))
        check("stat_tests.py runs from the command line with a different output path, prints the report and writes the JSON", code == 0 and "[Statistical Significance Tests]" in printed and saved["resamples"] == 300 and "Results written to" in printed, printed[-300:])
        check("it does not touch the results folder when told to write elsewhere", json.loads((E.RESULTS / "stat_tests.json").read_text(encoding="utf-8"))["resamples"] == T.RESAMPLES)


def main() -> int:
    mcnemar_checks()
    sign_and_holm_checks()
    f1_batch_checks()
    permutation_checks()
    pairing_and_text_checks()
    real_data_checks()
    exporter_unit_checks()
    exporter_pipeline_checks()
    cli_checks()
    print(f"All {len(passed)} significance-test checks passed: the statistics against independent oracles, the exporter, and the honesty rules.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
