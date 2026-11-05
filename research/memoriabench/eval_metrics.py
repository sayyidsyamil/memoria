"""Metrics for Table 6.1: what each system did on MemoriaBench, and how to say so honestly.

Everything here works on the predictions file alone (results/predictions_raw.jsonl), so the table can be rebuilt,
and a different cut of it printed, without running a model again.

Definitions (an "alert" is a predicted OUTDATED or CONTRADICTS; a gold alert is a gold OUTDATED or CONTRADICTS):
    Accuracy          correct 6-class labels / probes
    Macro-F1          the mean of the six classes' F1, so that a rare class counts as much as a common one
    Alert Precision   alerts that were gold alerts / alerts raised (n/a when none were raised)
    Alert Recall      gold alerts that were raised / gold alerts
    False Alert Rate  alerts raised on the probes that are not gold alerts / those probes
    P50, P95          median and 95th percentile of the time to classify one probe, warm, in ms (linear interpolation)
    Peak memory       the worker process' lifetime-maximum physical footprint, which counts Metal buffers (GB)
Intervals are 95% cluster bootstrap: the 28 series are resampled with replacement (probes of a series share one
memory, so they are not independent), 2000 times. The 5-series subset is too small for an interval and gets none.

Run: python3.11 eval_metrics.py [--predictions results/predictions_raw.jsonl]
"""

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
CLASSES = ("SUPPORTED_CURRENT", "OUTDATED", "CONTRADICTS", "UPDATES", "IRRELEVANT", "INSUFFICIENT_EVIDENCE")
ALERTS = ("OUTDATED", "CONTRADICTS")
INDEX = {label: i for i, label in enumerate(CLASSES)}
ALERT_ROWS = [INDEX[c] for c in ALERTS]
OFFICIAL_SUBSET = ("ES2004", "ES2014", "IS1009", "TS3003", "TS3007")  # AMI's unseen evaluation series, in the scenario-only partition
BOOTSTRAPS = 2000
SEED = 20261015

SYSTEMS = {  # id -> the name Table 6.1 shows
    "B0": "B0: Closed-Book Control",
    "B1": "B1: Embedding-Only (alert if sim >= t)",
    "B1b": "B1b: Embedding-Only, 3 bands",
    "B2": "B2: Standard Transcript RAG",
    "M2": "M2: Full Memoria (Proposed)",
    "A1": "A1: M2 without supersession notes",
}


# --- reading ---------------------------------------------------------------------------------------

def load_predictions(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def percentile(values: list[float], q: float) -> float:
    return float(np.percentile(np.asarray(values, dtype=float), q)) if values else math.nan


# --- the confusion matrix and everything that follows from it -----------------------------------------

def confusion_matrix(rows: list[dict]) -> np.ndarray:
    """6x6 counts: row = gold class, column = predicted class, in the order of CLASSES."""
    matrix = np.zeros((len(CLASSES), len(CLASSES)), dtype=np.int64)
    for row in rows:
        matrix[INDEX[row["gold_label"]], INDEX[row["pred"]]] += 1
    return matrix


def scores(matrix: np.ndarray) -> dict:
    """Every headline number, from a confusion matrix alone (so that a bootstrap can add matrices)."""
    total = matrix.sum()
    diagonal = np.diag(matrix).astype(float)
    predicted = matrix.sum(axis=0).astype(float)
    gold = matrix.sum(axis=1).astype(float)
    precision = np.divide(diagonal, predicted, out=np.zeros(len(CLASSES)), where=predicted > 0)
    recall = np.divide(diagonal, gold, out=np.zeros(len(CLASSES)), where=gold > 0)
    f1 = np.divide(2 * precision * recall, precision + recall, out=np.zeros(len(CLASSES)), where=(precision + recall) > 0)
    silent_rows = [i for i in range(len(CLASSES)) if i not in ALERT_ROWS]
    tp = matrix[np.ix_(ALERT_ROWS, ALERT_ROWS)].sum()
    fp = matrix[np.ix_(silent_rows, ALERT_ROWS)].sum()
    fn = matrix[np.ix_(ALERT_ROWS, silent_rows)].sum()
    tn = matrix[np.ix_(silent_rows, silent_rows)].sum()
    raised = tp + fp
    return {
        "n": int(total),
        "accuracy": float(diagonal.sum() / total) if total else math.nan,
        "macro_f1": float(f1.mean()),
        "class_recall": {c: float(recall[i]) for i, c in enumerate(CLASSES)},
        "class_f1": {c: float(f1[i]) for i, c in enumerate(CLASSES)},
        "alert_precision": float(tp / raised) if raised else math.nan,
        "alert_recall": float(tp / (tp + fn)) if (tp + fn) else math.nan,
        "false_alarm": float(fp / (fp + tn)) if (fp + tn) else math.nan,
        "tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn),
    }


def cluster_bootstrap(rows: list[dict], keys: tuple[str, ...] = ("macro_f1", "accuracy", "alert_precision", "alert_recall", "false_alarm"),
                      draws: int = BOOTSTRAPS, seed: int = SEED) -> dict[str, tuple[float, float]]:
    """95% percentile intervals, resampling whole series."""
    per_series: dict[str, np.ndarray] = defaultdict(lambda: np.zeros((len(CLASSES), len(CLASSES)), dtype=np.int64))
    for row in rows:
        per_series[row["series_id"]][INDEX[row["gold_label"]], INDEX[row["pred"]]] += 1
    stack = np.stack([per_series[name] for name in sorted(per_series)])
    rng = np.random.default_rng(seed)
    samples = {key: [] for key in keys}
    for _ in range(draws):
        picked = rng.integers(0, len(stack), len(stack))
        drawn = scores(stack[picked].sum(axis=0))
        for key in keys:
            samples[key].append(drawn[key])
    out = {}
    for key, values in samples.items():
        finite = [v for v in values if not math.isnan(v)]
        out[key] = (float(np.percentile(finite, 2.5)), float(np.percentile(finite, 97.5))) if finite else (math.nan, math.nan)
    return out


def paired_bootstrap(rows_a: list[dict], rows_b: list[dict], keys: tuple[str, ...] = ("macro_f1", "alert_recall", "false_alarm"),
                     draws: int = BOOTSTRAPS, seed: int = SEED) -> dict[str, tuple[float, float, float]]:
    """metric(a) - metric(b) with a 95% interval, resampling the same series for both systems: (difference, low, high).
    Both systems answered the same probes, so the comparison is paired and the interval is narrower than two separate ones."""
    def per_series(rows: list[dict]) -> dict[str, np.ndarray]:
        out: dict[str, np.ndarray] = defaultdict(lambda: np.zeros((len(CLASSES), len(CLASSES)), dtype=np.int64))
        for row in rows:
            out[row["series_id"]][INDEX[row["gold_label"]], INDEX[row["pred"]]] += 1
        return out

    a, b = per_series(rows_a), per_series(rows_b)
    names = sorted(set(a) & set(b))
    stack_a, stack_b = np.stack([a[n] for n in names]), np.stack([b[n] for n in names])
    point_a, point_b = scores(stack_a.sum(axis=0)), scores(stack_b.sum(axis=0))
    rng = np.random.default_rng(seed)
    deltas = {key: [] for key in keys}
    for _ in range(draws):
        picked = rng.integers(0, len(names), len(names))
        drawn_a, drawn_b = scores(stack_a[picked].sum(axis=0)), scores(stack_b[picked].sum(axis=0))
        for key in keys:
            deltas[key].append(drawn_a[key] - drawn_b[key])
    out = {}
    for key, values in deltas.items():
        finite = [v for v in values if not math.isnan(v)]
        out[key] = (point_a[key] - point_b[key], float(np.percentile(finite, 2.5)), float(np.percentile(finite, 97.5))) if finite else (math.nan,) * 3
    return out


def summarise(rows: list[dict], peak_gb: float | None, intervals: bool) -> dict:
    result = scores(confusion_matrix(rows))
    latencies = [row["latency_ms"] for row in rows]
    result.update({"p50_ms": percentile(latencies, 50), "p95_ms": percentile(latencies, 95), "peak_gb": peak_gb})
    if intervals and len({row["series_id"] for row in rows}) >= 10:
        result["ci"] = cluster_bootstrap(rows)
    return result


# --- choosing the embedding baseline's thresholds, on the development set only ------------------------------

def tune_alert_threshold(sims: list[float], gold_alert: list[bool]) -> float:
    """The cosine threshold that gives 'alert if sim >= t' its best alert F1 on the development probes. Ties go to the
    higher threshold, which raises fewer alerts."""
    best, best_f1 = max(sims) + 1e-6, -1.0
    for t in sorted(set(sims), reverse=True):
        raised = [s >= t for s in sims]
        tp = sum(r and g for r, g in zip(raised, gold_alert))
        fp = sum(r and not g for r, g in zip(raised, gold_alert))
        fn = sum((not r) and g for r, g in zip(raised, gold_alert))
        f1 = 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else 0.0
        if f1 > best_f1 + 1e-12:
            best, best_f1 = t, f1
    return float(best)


def band_label(sim: float, low: float, high: float) -> str:
    """Three bands: unrelated to anything in memory; close but not the same (a possible conflict: an alert); very close."""
    return "IRRELEVANT" if sim < low else ("SUPPORTED_CURRENT" if sim >= high else "CONTRADICTS")


def tune_bands(sims: list[float], gold: list[str]) -> tuple[float, float]:
    """(low, high) that give the three bands their best 6-class macro-F1 on the development probes."""
    grid = sorted(set(sims))
    best, best_f1 = (grid[0], grid[-1] + 1e-6), -1.0
    for i, low in enumerate(grid):
        for high in grid[i:] + [grid[-1] + 1e-6]:
            rows = [{"gold_label": g, "pred": band_label(s, low, high)} for s, g in zip(sims, gold)]
            f1 = scores(confusion_matrix(rows))["macro_f1"]
            if f1 > best_f1 + 1e-12:
                best, best_f1 = (float(low), float(high)), f1
    return best


# --- the tables --------------------------------------------------------------------------------------------

def percent(value: float) -> str:
    return "n/a" if value is None or math.isnan(value) else f"{100 * value:.1f}%"


def number(value: float) -> str:
    return "n/a" if value is None or math.isnan(value) else f"{value:.2f}"


def milliseconds(value: float) -> str:
    return "n/a" if value is None or math.isnan(value) else f"{value:,.0f}ms"


def gigabytes(value: float | None) -> str:
    return "n/a" if value is None or math.isnan(value) else f"{value:.1f} GB"


def comparison_table(title: str, summaries: dict[str, dict]) -> str:
    header = f"{'System Architecture':<40}{'Acc':>7}{'Macro-F1':>10}{'Alert Prec':>12}{'Alert Rec':>11}{'False Alarm':>13}{'P50':>9}{'P95':>9}{'Memory':>9}"
    rule = "=" * len(header)
    lines = [rule, title, rule, header, "-" * len(header)]
    for system, s in summaries.items():
        lines.append(f"{SYSTEMS.get(system, system):<40}{percent(s['accuracy']):>7}{number(s['macro_f1']):>10}{number(s['alert_precision']):>12}"
                     f"{number(s['alert_recall']):>11}{percent(s['false_alarm']):>13}{milliseconds(s['p50_ms']):>9}{milliseconds(s['p95_ms']):>9}{gigabytes(s['peak_gb']):>9}")
    lines.append(rule)
    return "\n".join(lines)


def per_class_table(title: str, recalls: dict[str, dict[str, float]]) -> str:
    """Recall per gold class (how often a class is found), with OUTDATED split into its real and synthetic probes."""
    columns = [("SUPPORTED_CURRENT", "Supported"), ("OUTDATED", "Outdated"), ("OUT-real", "Out(real)"), ("OUT-syn", "Out(syn.)"), ("CONTRADICTS", "Contradicts"),
               ("UPDATES", "Updates"), ("IRRELEVANT", "Irrelevant"), ("INSUFFICIENT_EVIDENCE", "Insufficient")]
    header = f"{'System':<40}" + "".join(f"{label:>13}" for _, label in columns)
    lines = [title, header, "-" * len(header)]
    for system, r in recalls.items():
        lines.append(f"{SYSTEMS.get(system, system):<40}" + "".join(f"{percent(r.get(key, math.nan)):>13}" for key, _ in columns))
    return "\n".join(lines)


def outdated_recalls(rows: list[dict], basis: dict[str, str]) -> dict[str, float]:
    """Recall of OUTDATED among the probes a real replaced decision founded, and among the synthetic ones."""
    found = {}
    for kind, key in (("real-supersession", "OUT-real"), ("synthetic-supersession", "OUT-syn")):
        mine = [r for r in rows if r["gold_label"] == "OUTDATED" and basis.get(r["id"]) == kind]
        found[key] = sum(r["pred"] == "OUTDATED" for r in mine) / len(mine) if mine else math.nan
    return found


CSV_FIELDS = ["split", "system", "name", "n", "accuracy", "accuracy_lo", "accuracy_hi", "macro_f1", "macro_f1_lo", "macro_f1_hi",
              "alert_precision", "alert_precision_lo", "alert_precision_hi", "alert_recall", "alert_recall_lo", "alert_recall_hi",
              "false_alarm", "false_alarm_lo", "false_alarm_hi", "p50_ms", "p95_ms", "peak_gb", "tp", "fp", "fn", "tn"]


def csv_row(split: str, system: str, s: dict) -> dict:
    row = {"split": split, "system": system, "name": SYSTEMS.get(system, system), "n": s["n"], "p50_ms": s["p50_ms"], "p95_ms": s["p95_ms"], "peak_gb": s["peak_gb"],
           "tp": s["tp"], "fp": s["fp"], "fn": s["fn"], "tn": s["tn"]}
    for key in ("accuracy", "macro_f1", "alert_precision", "alert_recall", "false_alarm"):
        row[key] = s[key]
        low, high = s.get("ci", {}).get(key, ("", ""))
        row[f"{key}_lo"], row[f"{key}_hi"] = low, high
    return row


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if isinstance(v, float) and math.isnan(v) else (round(v, 4) if isinstance(v, float) else v)) for k, v in row.items()})


def report(predictions: list[dict], meta: dict[str, dict], basis: dict[str, str], table_path: Path | None = None, per_class_path: Path | None = None) -> str:
    """The text that goes to the terminal, and the CSVs: full test set, then the official unseen subset."""
    systems = [s for s in SYSTEMS if any(p["system"] == s for p in predictions)]
    cuts = [("full", "Table 6.1: Master Comparative Benchmark Results (MemoriaBench N={n})", lambda r: True),
            ("official_subset", "Table 6.1b: Official AMI Unseen Subset (N={n}, 5 series: " + ", ".join(OFFICIAL_SUBSET) + ")", lambda r: r["series_id"] in OFFICIAL_SUBSET)]
    out, csv_rows, class_rows = [], [], []
    for split, title, keep in cuts:
        summaries, recalls = {}, {}
        for system in systems:
            rows = [p for p in predictions if p["system"] == system and keep(p)]
            if not rows:
                continue
            peak = (meta.get(system) or {}).get("peak_gb")
            summaries[system] = summarise(rows, peak, intervals=(split == "full"))
            recalls[system] = {**summaries[system]["class_recall"], **outdated_recalls(rows, basis)}
            csv_rows.append(csv_row(split, system, summaries[system]))
            class_rows.append({"split": split, "system": system, **{k: round(v, 4) if not math.isnan(v) else "" for k, v in recalls[system].items()}})
        if not summaries:
            continue
        n = next(iter(summaries.values()))["n"]
        out.append(comparison_table(title.format(n=n), summaries))
        out.append("")
        out.append(per_class_table(f"Recall by gold class ({split.replace('_', ' ')})", recalls))
        out.append("")
        if split == "full" and "M2" in summaries:
            mine = [p for p in predictions if p["system"] == "M2" and keep(p)]
            out.append("M2 against each other system, same probes, same 28 series resampled: difference [95% interval]")
            for system in summaries:
                if system == "M2":
                    continue
                d = paired_bootstrap(mine, [p for p in predictions if p["system"] == system and keep(p)])
                cells = "   ".join(f"{label} {d[key][0]:+.2f} [{d[key][1]:+.2f}, {d[key][2]:+.2f}]" for key, label in (("macro_f1", "Macro-F1"), ("alert_recall", "Alert Rec"), ("false_alarm", "False Alarm")))
                out.append(f"  M2 - {system:<4} {cells}")
            out.append("")
        if split == "full":
            best = summaries.get("M2")
            if best and "ci" in best:
                ci = best["ci"]
                out.append("95% cluster-bootstrap intervals (28 series resampled) for " + SYSTEMS["M2"] + ": "
                           f"Macro-F1 {number(best['macro_f1'])} [{number(ci['macro_f1'][0])}, {number(ci['macro_f1'][1])}], "
                           f"Alert Prec {number(best['alert_precision'])} [{number(ci['alert_precision'][0])}, {number(ci['alert_precision'][1])}], "
                           f"Alert Rec {number(best['alert_recall'])} [{number(ci['alert_recall'][0])}, {number(ci['alert_recall'][1])}]")
                out.append("")
    if table_path:
        write_csv(table_path, csv_rows)
    if per_class_path and class_rows:
        columns = ["split", "system", *[k for k in class_rows[0] if k not in ("split", "system")]]
        with per_class_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            writer.writerows(class_rows)
    return "\n".join(out)


def load_meta(folder: Path) -> dict[str, dict]:
    return {path.name.removesuffix(".meta.json"): json.loads(path.read_text(encoding="utf-8")) for path in sorted(folder.glob("*.meta.json"))}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Rebuild Table 6.1 from results/predictions_raw.jsonl")
    parser.add_argument("--predictions", type=Path, default=RESULTS / "predictions_raw.jsonl")
    args = parser.parse_args(argv)
    predictions = load_predictions(args.predictions)
    provenance = HERE / "data" / "memoria_bench.provenance.jsonl"
    basis = {p["id"]: p["basis"] for p in map(json.loads, provenance.read_text(encoding="utf-8").splitlines()) if p.get("basis")}
    print(report(predictions, load_meta(args.predictions.parent / "_work"), basis, RESULTS / "table_6_1.csv", RESULTS / "per_class.csv"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
