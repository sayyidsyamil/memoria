"""Formal tests on results/predictions_raw.jsonl: is the difference between two systems more than chance?

Every system answered the same 336 probes, so every comparison here is paired. For M2 (Full Memoria) against each
other system the script computes:

  McNemar (exact)        on whether the alert decision was right, probe by probe. b = M2 right and the other wrong,
                         c = M2 wrong and the other right; only those two cells carry information. The exact
                         two-sided p is a binomial tail, 2 x P(X <= min(b, c)) with X ~ Binomial(b + c, 1/2). The
                         chi-square with continuity correction is printed beside it for readers who expect it.
                         The same test is run on the probes that are not alerts (false alarms), on those that are
                         (misses), and on the six-class label.
  Sign test by series    the same comparison with the 28 series as the unit: in how many series was M2 right more
                         often, in how many less often. Probes of a series share one memory, so they are not
                         independent, and a probe-level p-value is optimistic; this one does not rely on that.
  Permutation on         the paired permutation test of the Macro-F1 difference, 10,000 resamples. Each resample
  Macro-F1               swaps the two systems' answers on a random half of the units and recomputes the
                         difference. Done with series as the unit (the honest one) and with single probes as the
                         unit (the naive one, shown for comparison). A Monte-Carlo p is (1 + k) / (resamples + 1),
                         so with 10,000 resamples the smallest it can be is 1/10,001: when no resample is as
                         extreme the result is "p <= 0.0001", not a smaller number the method cannot support.
  Holm correction        across the family of five M2-against-X comparisons, on the primary outcome.

Nothing here asserts a result. The script reports what the data give; "significant" means only that the difference
is unlikely to be chance on these probes and these series. It says nothing about live speech, and it is no
substitute for reading the per-class table.

Run: python3.11 stat_tests.py [--resamples 10000]      (writes results/stat_tests.json)
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy import stats

import eval_metrics as E

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
ALPHA = 0.05
RESAMPLES = 10_000
SEED = 20261015
SUBJECT = "M2"
RIVALS = ("B2", "B1", "B0", "B1b", "A1")  # the two the thesis asks for first, then the rest of the table


# --- pairing -------------------------------------------------------------------------------------------

def paired_systems(predictions: list[dict], first: str, second: str) -> tuple[list[dict], list[dict]]:
    """The two systems' rows in one order, refusing to continue unless they answered exactly the same probes."""
    a = sorted((p for p in predictions if p["system"] == first), key=lambda p: p["id"])
    b = sorted((p for p in predictions if p["system"] == second), key=lambda p: p["id"])
    if not a or [p["id"] for p in a] != [p["id"] for p in b]:
        raise ValueError(f"{first} and {second} did not answer the same probes: a paired test would be meaningless")
    return a, b


def alert_right(row: dict) -> bool:
    return bool(row["alert"]) == bool(row["expected_alert"])


def label_right(row: dict) -> bool:
    return row["pred"] == row["gold_label"]


# --- McNemar ---------------------------------------------------------------------------------------------

def mcnemar(a_right: list[bool], b_right: list[bool]) -> dict:
    """Exact McNemar test of two systems on the same items. b: only the first was right. c: only the second."""
    both = sum(x and y for x, y in zip(a_right, b_right))
    b = sum(x and not y for x, y in zip(a_right, b_right))
    c = sum(y and not x for x, y in zip(a_right, b_right))
    neither = len(a_right) - both - b - c
    n = b + c
    exact = 1.0 if n == 0 else min(1.0, 2 * float(stats.binom.cdf(min(b, c), n, 0.5)))
    chi2 = 0.0 if n == 0 else (abs(b - c) - 1) ** 2 / n
    return {"n": len(a_right), "both_right": both, "only_first": b, "only_second": c, "both_wrong": neither, "discordant": n,
            "chi2": chi2, "chi2_p": 1.0 if n == 0 else float(stats.chi2.sf(chi2, 1)), "exact_p": exact}


def sign_test(wins: int, losses: int) -> float:
    """Exact two-sided sign test; ties are not counted."""
    n = wins + losses
    return 1.0 if n == 0 else min(1.0, 2 * float(stats.binom.cdf(min(wins, losses), n, 0.5)))


def series_sign(a_right: list[bool], b_right: list[bool], series: list[str]) -> dict:
    """The series as the unit: in how many was the first system right on more probes, on fewer, on as many."""
    gain: dict[str, int] = {}
    for x, y, s in zip(a_right, b_right, series):
        gain[s] = gain.get(s, 0) + int(x) - int(y)
    wins, losses = sum(g > 0 for g in gain.values()), sum(g < 0 for g in gain.values())
    return {"series": len(gain), "first_better": wins, "second_better": losses, "tied": len(gain) - wins - losses, "exact_p": sign_test(wins, losses)}


def holm(p_values: dict[str, float]) -> dict[str, float]:
    """Holm's step-down adjustment: the smallest p is multiplied by m, the next by m - 1, and so on, never decreasing."""
    ordered = sorted(p_values.items(), key=lambda kv: kv[1])
    adjusted, running = {}, 0.0
    for i, (name, p) in enumerate(ordered):
        running = max(running, min(1.0, (len(ordered) - i) * p))
        adjusted[name] = running
    return adjusted


# --- permutation test of the Macro-F1 difference ------------------------------------------------------------

def macro_f1_batch(matrices: np.ndarray) -> np.ndarray:
    """Macro-F1 of many 6x6 confusion matrices at once; equals eval_metrics.scores(...)['macro_f1'] one by one."""
    m = np.asarray(matrices, dtype=float).reshape(-1, len(E.CLASSES), len(E.CLASSES))
    diagonal = np.einsum("rii->ri", m)
    predicted, gold = m.sum(axis=1), m.sum(axis=2)
    precision = np.divide(diagonal, predicted, out=np.zeros_like(diagonal), where=predicted > 0)
    recall = np.divide(diagonal, gold, out=np.zeros_like(diagonal), where=gold > 0)
    both = precision + recall
    return np.divide(2 * precision * recall, both, out=np.zeros_like(diagonal), where=both > 0).mean(axis=1)


def paired_permutation(rows_a: list[dict], rows_b: list[dict], unit: str = "series", resamples: int = RESAMPLES, seed: int = SEED) -> dict:
    """Permutation test of macro-F1(a) - macro-F1(b). Under the null the two systems are interchangeable, so on any unit
    (a series, or a probe) their answers can be swapped; each resample swaps a random half of the units."""
    size = len(E.CLASSES)
    keys = sorted({(r["series_id"] if unit == "series" else r["id"]) for r in rows_a})
    position = {k: i for i, k in enumerate(keys)}
    stack = {name: np.zeros((len(keys), size * size)) for name in ("a", "b")}
    for name, rows in (("a", rows_a), ("b", rows_b)):
        for r in rows:
            stack[name][position[r["series_id"] if unit == "series" else r["id"]], E.INDEX[r["gold_label"]] * size + E.INDEX[r["pred"]]] += 1
    total_a, total_b = stack["a"].sum(axis=0), stack["b"].sum(axis=0)
    observed = float(macro_f1_batch(total_a[None])[0] - macro_f1_batch(total_b[None])[0])
    difference = stack["b"] - stack["a"]
    swaps = np.random.default_rng(seed).integers(0, 2, size=(resamples, len(keys))).astype(float)  # 1: swap this unit
    shift = swaps @ difference
    null = macro_f1_batch(total_a + shift) - macro_f1_batch(total_b - shift)
    extreme = int(np.sum(np.abs(null) >= abs(observed) - 1e-12))
    return {"unit": unit, "units": len(keys), "resamples": resamples, "observed": observed, "extreme": extreme, "p": (extreme + 1) / (resamples + 1),
            "null_sd": float(null.std()), "null_95": [float(np.percentile(null, 2.5)), float(np.percentile(null, 97.5))]}


# --- one comparison, all the tests --------------------------------------------------------------------------

def compare(predictions: list[dict], first: str, second: str, resamples: int = RESAMPLES) -> dict:
    a, b = paired_systems(predictions, first, second)
    series = [r["series_id"] for r in a]
    silent = [i for i, r in enumerate(a) if not r["expected_alert"]]
    alerts = [i for i, r in enumerate(a) if r["expected_alert"]]
    pick = lambda rows, idx: [rows[i] for i in idx]
    right_a, right_b = [alert_right(r) for r in a], [alert_right(r) for r in b]
    scores_a, scores_b = E.scores(E.confusion_matrix(a)), E.scores(E.confusion_matrix(b))
    return {
        "first": first, "second": second,
        "mcnemar_alert": mcnemar(right_a, right_b),
        "mcnemar_label": mcnemar([label_right(r) for r in a], [label_right(r) for r in b]),
        "mcnemar_false_alarms": mcnemar([alert_right(r) for r in pick(a, silent)], [alert_right(r) for r in pick(b, silent)]),
        "mcnemar_misses": mcnemar([alert_right(r) for r in pick(a, alerts)], [alert_right(r) for r in pick(b, alerts)]),
        "series_sign_alert": series_sign(right_a, right_b, series),
        "series_sign_label": series_sign([label_right(r) for r in a], [label_right(r) for r in b], series),
        "permutation_series": paired_permutation(a, b, "series", resamples),
        "permutation_probe": paired_permutation(a, b, "probe", resamples),
        "paired_bootstrap": {k: list(v) for k, v in E.paired_bootstrap(a, b).items()},
        "rates": {"first": {k: scores_a[k] for k in ("accuracy", "macro_f1", "alert_precision", "alert_recall", "false_alarm")},
                  "second": {k: scores_b[k] for k in ("accuracy", "macro_f1", "alert_precision", "alert_recall", "false_alarm")}},
    }


def run(predictions: list[dict], resamples: int = RESAMPLES) -> dict:
    present = [s for s in RIVALS if any(p["system"] == s for p in predictions)]
    comparisons = {rival: compare(predictions, SUBJECT, rival, resamples) for rival in present}
    family = {rival: c["mcnemar_alert"]["exact_p"] for rival, c in comparisons.items()}
    adjusted = holm(family)
    for rival, c in comparisons.items():
        c["holm_p"] = adjusted[rival]
    first = next(p for p in predictions if p["system"] == SUBJECT)
    return {"subject": SUBJECT, "probes": sum(1 for p in predictions if p["system"] == SUBJECT), "series": len({p["series_id"] for p in predictions}),
            "alpha": ALPHA, "resamples": resamples, "seed": SEED, "family_for_holm": sorted(family), "comparisons": comparisons, "example_probe": first["id"]}


# --- saying it ---------------------------------------------------------------------------------------------------

def p_text(p: float, resamples: int | None = None) -> str:
    """A p-value as it may honestly be written. A Monte-Carlo p stops at 1/(resamples+1)."""
    if resamples is not None and p <= 1 / (resamples + 1) + 1e-15:
        return f"<= {1 / (resamples + 1):.4f}"
    if p < 1e-4:
        return f"{p:.1e}"
    return f"{p:.4f}" if p < 0.1 else f"{p:.3f}"


def verdict(p: float, alpha: float = ALPHA) -> str:
    return "significant at 0.001" if p < 0.001 else ("significant at 0.05" if p < alpha else "not significant")


def describe(result: dict) -> str:
    lines = [f"[Statistical Significance Tests] ({result['probes']} probes in {result['series']} series; every system answered the same probes)"]
    names = list(result["comparisons"])
    for n, rival in enumerate(names):
        c = result["comparisons"][rival]
        last = n == len(names) - 1
        stem, body = ("└──", "      ") if last else ("├──", "│     ")
        m, s, a = c["mcnemar_alert"], c["series_sign_alert"], c["mcnemar_false_alarms"]
        perm_series, perm_probe = c["permutation_series"], c["permutation_probe"]
        lines.append(f"  {stem} {c['first']} vs {rival} ({E.SYSTEMS[rival].split(': ', 1)[1]}):")
        lines.append(f"  {body}├── McNemar on the alert decision: only {c['first']} right b={m['only_first']}, only {rival} right c={m['only_second']}, both right {m['both_right']}, both wrong {m['both_wrong']}"
                     f" | chi2={m['chi2']:.1f} | exact p {p_text(m['exact_p'])} (Holm {p_text(c['holm_p'])}) ({verdict(m['exact_p'])})")
        lines.append(f"  {body}├── By series ({s['series']} series, exact sign test): {c['first']} better in {s['first_better']}, worse in {s['second_better']}, tied in {s['tied']} | p {p_text(s['exact_p'])} ({verdict(s['exact_p'])})")
        lines.append(f"  {body}├── False alarms on the {a['n']} non-conflicts: {c['rates']['second']['false_alarm']:.1%} ({rival}) -> {c['rates']['first']['false_alarm']:.1%} ({c['first']}) | "
                     f"only {c['first']} quiet b={a['only_first']}, only {rival} quiet c={a['only_second']} | exact p {p_text(a['exact_p'])}")
        lines.append(f"  {body}└── Paired permutation on Macro-F1: {perm_series['observed']:+.2f} | series swapped p {p_text(perm_series['p'], perm_series['resamples'])}"
                     f" | single probes swapped p {p_text(perm_probe['p'], perm_probe['resamples'])}")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Significance tests for Table 6.1")
    parser.add_argument("--predictions", type=Path, default=RESULTS / "predictions_raw.jsonl")
    parser.add_argument("--resamples", type=int, default=RESAMPLES)
    parser.add_argument("--out", type=Path, default=RESULTS / "stat_tests.json")
    args = parser.parse_args(argv)
    result = run(E.load_predictions(args.predictions), args.resamples)
    args.out.write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(describe(result))
    print(f"\nResults written to {args.out.relative_to(HERE) if args.out.is_relative_to(HERE) else args.out}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
