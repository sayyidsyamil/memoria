"""Benchmark-runner test: the metrics against an independent oracle, the plumbing, and the fairness rules.

No language model is loaded here, so this can run while anything else does. What it proves:
  - Accuracy, Macro-F1 and the alert metrics equal scikit-learn's on 200 random label sets, and the hand-worked cases,
  - the bootstrap is deterministic and honest, the threshold tuning finds the right cut on data where one exists,
  - the table and the CSVs say what the numbers say, and a missing number is "n/a", never a made-up zero,
  - chunking covers every utterance and cannot loop, the guard sees a process holding a model,
  - the worker hands a system a series and a statement and nothing else, resumes where it stopped, and writes the
    gold label beside the prediction only after the system has answered,
  - B1's two readings of one similarity, and the way every reply is read.

Run: python3.11 test_benchmarks.py
"""

import csv
import json
import math
import random
import sys
import tempfile
from pathlib import Path

import numpy as np
from sklearn.metrics import f1_score

import eval_metrics as E
import run_benchmarks as R

passed: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


def close(a: float, b: float, eps: float = 1e-9) -> bool:
    return abs(a - b) <= eps


def make_rows(pairs: list[tuple[str, str]], series: str = "S1") -> list[dict]:
    return [{"id": f"r{i}", "series_id": series, "gold_label": g, "pred": p, "latency_ms": 100.0 + i} for i, (g, p) in enumerate(pairs)]


# ------------------------------------------------------------------ the metrics

def metric_checks() -> None:
    perfect = make_rows([(c, c) for c in E.CLASSES for _ in range(4)])
    s = E.scores(E.confusion_matrix(perfect))
    check("a perfect system: accuracy 1, macro-F1 1, alert precision and recall 1, no false alarms", (s["accuracy"], s["macro_f1"], s["alert_precision"], s["alert_recall"], s["false_alarm"]) == (1, 1, 1, 1, 0), s)

    silent = make_rows([(c, "INSUFFICIENT_EVIDENCE") for c in E.CLASSES for _ in range(4)])
    s = E.scores(E.confusion_matrix(silent))
    expected_f1 = 2 * (1 / 6) * 1 / (1 / 6 + 1) / 6
    check("a system that only ever says INSUFFICIENT_EVIDENCE: accuracy 1/6, macro-F1 as worked by hand", close(s["accuracy"], 1 / 6) and close(s["macro_f1"], expected_f1), s)
    check("and it raises no alert, so its precision is n/a and not a flattering 0 or 1, while its recall is 0 and its false alarm rate 0", math.isnan(s["alert_precision"]) and s["alert_recall"] == 0 and s["false_alarm"] == 0, s)

    worked = make_rows([("OUTDATED", "OUTDATED"), ("OUTDATED", "CONTRADICTS"), ("CONTRADICTS", "SUPPORTED_CURRENT"), ("CONTRADICTS", "CONTRADICTS"),
                        ("SUPPORTED_CURRENT", "CONTRADICTS"), ("SUPPORTED_CURRENT", "SUPPORTED_CURRENT"), ("UPDATES", "UPDATES"), ("IRRELEVANT", "CONTRADICTS")])
    s = E.scores(E.confusion_matrix(worked))
    check("worked by hand: 3 true alerts (the wrong alert class still counts as an alert), 2 false, 1 missed, 2 quiet and right", (s["tp"], s["fp"], s["fn"], s["tn"]) == (3, 2, 1, 2), s)
    check("so alert precision 3/5, recall 3/4, false alarm rate 2/4", close(s["alert_precision"], 3 / 5) and close(s["alert_recall"], 3 / 4) and close(s["false_alarm"], 2 / 4), s)
    check("and accuracy is 4 of 8", close(s["accuracy"], 4 / 8), s)

    rng = random.Random(7)
    worst = 0.0
    for _ in range(200):
        pairs = [(rng.choice(E.CLASSES), rng.choice(E.CLASSES)) for _ in range(rng.randint(12, 90))]
        # every class must be a gold class at least once, as in the benchmark, or macro-F1 over six classes is not what scikit-learn averages
        pairs += [(c, rng.choice(E.CLASSES)) for c in E.CLASSES]
        rows = make_rows(pairs)
        mine = E.scores(E.confusion_matrix(rows))
        oracle = f1_score([g for g, _ in pairs], [p for _, p in pairs], labels=list(E.CLASSES), average="macro", zero_division=0)
        worst = max(worst, abs(mine["macro_f1"] - oracle), abs(mine["accuracy"] - sum(g == p for g, p in pairs) / len(pairs)))
    check("macro-F1 and accuracy equal scikit-learn's on 200 random label sets", worst < 1e-12, worst)

    values = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0]
    check("P50 and P95 use linear interpolation, like numpy", close(E.percentile(values, 50), 55.0) and close(E.percentile(values, 95), 95.5))
    check("and an empty list has no percentile", math.isnan(E.percentile([], 95)))
    check("summarise reads the latencies of exactly the rows it is given", E.summarise(make_rows([("UPDATES", "UPDATES")] * 3), 2.5, False)["p50_ms"] == 101.0)


def bootstrap_checks() -> None:
    rng = random.Random(3)
    rows = []
    for k in range(28):
        for c in E.CLASSES:
            for _ in range(2):
                rows.append({"id": f"{k}{c}{len(rows)}", "series_id": f"S{k:02d}", "gold_label": c, "pred": c if rng.random() < 0.7 else rng.choice(E.CLASSES), "latency_ms": 1.0})
    point = E.scores(E.confusion_matrix(rows))["macro_f1"]
    first, second = E.cluster_bootstrap(rows), E.cluster_bootstrap(rows)
    low, high = first["macro_f1"]
    check("the bootstrap is deterministic", first == second)
    check("its interval holds the point estimate and is neither empty nor the whole range", low <= point <= high and 0.005 < high - low < 0.3, (low, point, high))
    identical = [{**r, "series_id": f"S{i % 28:02d}"} for i, r in enumerate(rows)]
    flat = [{"id": str(i), "series_id": f"S{i % 28:02d}", "gold_label": "UPDATES", "pred": "UPDATES", "latency_ms": 1.0} for i in range(56)]
    check("when every series is perfect the interval has no width", E.cluster_bootstrap(flat, ("accuracy",))["accuracy"] == (1.0, 1.0))
    check("the intervals are not drawn for a handful of series", "ci" not in E.summarise(rows[:20], 1.0, True) and "ci" in E.summarise(rows, 1.0, True))


def paired_checks() -> None:
    rng = random.Random(13)
    a, b = [], []
    for k in range(28):
        for c in E.CLASSES:
            for j in range(2):
                base = {"id": f"{k}{c}{j}", "series_id": f"S{k:02d}", "gold_label": c, "latency_ms": 1.0}
                a.append({**base, "pred": c if rng.random() < 0.9 else "UPDATES"})
                b.append({**base, "pred": c if rng.random() < 0.5 else "UPDATES"})
    delta, low, high = E.paired_bootstrap(a, b, ("macro_f1",))["macro_f1"]
    check("a system that is right far more often is better with an interval that excludes zero", delta > 0.2 and 0 < low <= delta <= high, (delta, low, high))
    same = E.paired_bootstrap(a, a, ("macro_f1", "alert_recall"))
    check("a system against itself differs by exactly zero, with no width", all(v == (0.0, 0.0, 0.0) for v in same.values()), same)
    swapped = E.paired_bootstrap(b, a, ("macro_f1",))["macro_f1"]
    check("swapping the two systems flips the sign and the interval", abs(swapped[0] + delta) < 1e-12 and abs(swapped[1] + high) < 1e-12 and abs(swapped[2] + low) < 1e-12, (swapped, delta, low, high))
    check("the comparison is deterministic", E.paired_bootstrap(a, b, ("macro_f1",)) == E.paired_bootstrap(a, b, ("macro_f1",)))


def tuning_checks() -> None:
    sims = [0.2, 0.25, 0.3, 0.6, 0.65, 0.7, 0.9]
    alert = [False, False, False, True, True, True, False]
    check("an alert threshold is found where one separates the alerts perfectly, and it is the first value that does", E.tune_alert_threshold([0.2, 0.3, 0.6, 0.7], [False, False, True, True]) == 0.6)
    check("with data that no threshold separates, the tuned one still has the best alert F1 available", E.tune_alert_threshold(sims, alert) in (0.6, 0.65, 0.7, 0.9), E.tune_alert_threshold(sims, alert))
    check("ties go to the higher threshold, which raises fewer alerts", E.tune_alert_threshold([0.5, 0.5], [True, True]) == 0.5 and E.tune_alert_threshold([0.4, 0.8], [False, False]) >= 0.8)
    gold = ["IRRELEVANT", "IRRELEVANT", "CONTRADICTS", "CONTRADICTS", "SUPPORTED_CURRENT", "SUPPORTED_CURRENT"]
    low, high = E.tune_bands([0.1, 0.2, 0.5, 0.55, 0.9, 0.95], gold)
    check("three bands are cut where three groups are", [E.band_label(s, low, high) for s in (0.1, 0.2, 0.5, 0.55, 0.9, 0.95)] == gold, (low, high))
    check("band labels: below low is unrelated, from high up is a restatement, between is a possible conflict (an alert)", (E.band_label(0.1, 0.3, 0.8), E.band_label(0.5, 0.3, 0.8), E.band_label(0.8, 0.3, 0.8)) == ("IRRELEVANT", "CONTRADICTS", "SUPPORTED_CURRENT"))


def report_checks() -> None:
    rng = random.Random(11)
    predictions, basis = [], {}
    for system, accuracy in (("B0", 0.2), ("M2", 0.9)):
        for k, series in enumerate(["ES2004", "ES2014", "IS1009", "TS3003", "TS3007"] + [f"X{n:02d}" for n in range(23)]):
            for c in E.CLASSES:
                for j in range(2):
                    row_id = f"{series}-{c[0]}{j}"
                    basis[row_id] = "real-supersession" if (c == "OUTDATED" and k < 2) else "synthetic-supersession"
                    predictions.append({"system": system, "id": row_id, "series_id": series, "gold_label": c, "pred": c if rng.random() < accuracy else "UPDATES", "latency_ms": 50.0 + 10 * k + j})
    with tempfile.TemporaryDirectory() as scratch:
        folder = Path(scratch)
        text = E.report(predictions, {"B0": {"peak_gb": 2.5}, "M2": {"peak_gb": 4.25}}, basis, folder / "t.csv", folder / "c.csv")
        check("the report prints the full table and the official-subset table, each with the systems in the table's order", text.index("Table 6.1:") < text.index("Table 6.1b") and text.index("B0: Closed-Book") < text.index("M2: Full Memoria"))
        check("the full table counts 336 probes and the subset 60", "(MemoriaBench N=336)" in text and "(N=60, 5 series: ES2004, ES2014, IS1009, TS3003, TS3007)" in text)
        check("memory is shown in GB from the worker's own meta", "2.5 GB" in text and "4.2 GB" in text or "4.3 GB" in text)
        check("OUTDATED recall is shown apart for the real and the synthetic probes", "Out(real)" in text and "Out(syn.)" in text)
        rows = list(csv.DictReader((folder / "t.csv").open()))
        check("the CSV has a row per system per cut, with the headline numbers", [(r["split"], r["system"]) for r in rows] == [("full", "B0"), ("full", "M2"), ("official_subset", "B0"), ("official_subset", "M2")], rows)
        full_m2 = next(r for r in rows if r["split"] == "full" and r["system"] == "M2")
        mine = E.scores(E.confusion_matrix([p for p in predictions if p["system"] == "M2"]))
        check("a number in the CSV is the number the metrics compute", close(float(full_m2["macro_f1"]), round(mine["macro_f1"], 4)) and full_m2["n"] == "336", full_m2)
        check("the full cut has an interval, the 5-series subset has none", full_m2["macro_f1_lo"] != "" and next(r for r in rows if r["split"] == "official_subset")["macro_f1_lo"] == "")
        per_class = list(csv.DictReader((folder / "c.csv").open()))
        check("the per-class CSV holds recall for every class", {"SUPPORTED_CURRENT", "OUTDATED", "OUT-real", "OUT-syn", "CONTRADICTS", "UPDATES", "IRRELEVANT", "INSUFFICIENT_EVIDENCE"} <= set(per_class[0]), list(per_class[0]))
    table = E.comparison_table("T", {"B1": {"accuracy": 0.5, "macro_f1": 0.31, "alert_precision": math.nan, "alert_recall": 0.0, "false_alarm": 0.0, "p50_ms": 40.0, "p95_ms": 51.0, "peak_gb": None}})
    check("a number that does not exist is printed n/a", "n/a" in table.splitlines()[-2] and "nan" not in table.lower(), table)
    widths = {len(line) for line in table.splitlines() if line.startswith(("B1", "System", "-"))}
    check("every row of the table is as wide as its header", len(widths) == 1, widths)


# ------------------------------------------------------------------ the runner's plumbing

def chunk_checks() -> None:
    rng = random.Random(5)
    utterances = [{"meeting": "ES2004b", "speaker": "A", "role": "PM", "start": 10.0 * i, "end": 10.0 * i + 4, "text": " ".join("w" * 3 for _ in range(rng.randint(1, 30)))} for i in range(300)]
    chunks = R.chunk_utterances(utterances)
    covered = set()
    for c in chunks:
        covered |= {i for i, u in enumerate(utterances) if u["text"] in c["text"] and f"[{c['meeting']}" in c["text"]}
    check("every utterance is in some chunk", len(covered) >= 290 and R.chunk_utterances([]) == [])
    sizes = [len(c["text"].split()) for c in chunks[:-1]]
    check("every chunk but the last has at least the target number of words", all(n >= R.CHUNK_WORDS for n in sizes), min(sizes))
    check("chunk ids are unique, in time order, and say the meeting and the minute", len({c["id"] for c in chunks}) == len(chunks) and [c["start"] for c in chunks] == sorted(c["start"] for c in chunks) and chunks[1]["id"].startswith("ES2004b@"))
    check("consecutive chunks overlap, so a sentence cut by one is whole in the next", all(set(a["text"].split(" PM: ")[1:]) & set(b["text"].split(" PM: ")[1:]) for a, b in zip(chunks, chunks[1:])))
    one = R.chunk_utterances([{"meeting": "m", "speaker": "A", "role": "PM", "start": 0.0, "end": 1.0, "text": "word " * 500}])
    check("one very long utterance is one chunk and the loop ends", len(one) == 1)
    check("a chunk names who spoke", "PM: " in chunks[0]["text"])


def memory_item_checks() -> None:
    items = R.memory_items("- [ES2007c:28:10] The remote will use a kinetic battery. (replaces regular batteries)\n- [ES2013c:36:00#2] The remote will contain a hard plastic inner shell.\nnot a bullet\n")
    check("memory items are the lines an auditor reads, with the replaces note and without the citation in the text", items == [
        {"citation": "[ES2007c:28:10]", "text": "The remote will use a kinetic battery. (replaces regular batteries)"},
        {"citation": "[ES2013c:36:00#2]", "text": "The remote will contain a hard plastic inner shell."}], items)


def guard_checks() -> None:
    listing = "\n".join(["101 /opt/homebrew/bin/python3.11 /Users/x/Documents/memoria/hud.py", "102 /usr/bin/python3 /Users/x/Documents/memoria/mcp_server.py",
                         "103 python3.11 run_benchmarks.py --worker M2 --split test", "104 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "105 python3.11 /Users/x/Documents/memoria/hud.py"])
    sizes = {101: 3.1, 102: 0.4, 103: 4.2, 104: 5.0, 105: 3.3}
    found = R.busy_model_processes(listing, own=105, measure=lambda pid: (sizes[pid], sizes[pid]))
    check("the guard names the HUD and a running worker that hold a model, and nothing else", sorted(p for p, _, _ in found) == [101, 103], found)
    check("it does not count itself, a small process, or a browser", all(p not in (102, 104, 105) for p, _, _ in found))


def freeze_checks() -> None:
    saved = (R.BENCH_FILE, R.PROVENANCE_FILE, R.HASH_FILE)
    with tempfile.TemporaryDirectory() as scratch:
        folder = Path(scratch)
        R.BENCH_FILE, R.PROVENANCE_FILE, R.HASH_FILE = folder / "b.jsonl", folder / "p.jsonl", folder / "b.sha256"
        try:
            R.BENCH_FILE.write_text("a\n")
            R.PROVENANCE_FILE.write_text("b\n")
            check("a benchmark that was never frozen is refused, and told to run the validator", "does not exist" in (R.verify_freeze() or "") and "validate_bench.py" in R.verify_freeze())
            R.HASH_FILE.write_text(f"{R.sha256(R.BENCH_FILE)}  b.jsonl\n{R.sha256(R.PROVENANCE_FILE)}  p.jsonl\n")
            check("a benchmark that matches its freeze is accepted", R.verify_freeze() is None)
            R.BENCH_FILE.write_text("changed\n")
            check("one that has changed is refused, by name", "b.jsonl" in (R.verify_freeze() or ""))
        finally:
            R.BENCH_FILE, R.PROVENANCE_FILE, R.HASH_FILE = saved


def reading_checks() -> None:
    cases = {"CONTRADICTS | exceeds the cap | [M1:02:00]": (True, "CONTRADICTS"), "OUTDATED | old option": (True, "OUTDATED"), "supported_current": (True, "SUPPORTED_CURRENT"),
             "SUPPORTED CURRENT": (True, "SUPPORTED_CURRENT"), "UPDATES": (True, "UPDATES"), "The answer is probably yes.": (False, "INSUFFICIENT_EVIDENCE"), "": (False, "INSUFFICIENT_EVIDENCE")}
    for raw, wanted in cases.items():
        check(f"a reply {raw[:36]!r} is read as {wanted[1]}{'' if wanted[0] else ' and counted as unreadable'}", R.label_of(raw) == wanted, R.label_of(raw))
    check("the closed-book prompt states that there is no memory, and the RAG guide never speaks of approved decisions", "no approved decisions" in R.NO_MEMORY and "approved decision" not in R.RAG_CLASS_GUIDE.lower())
    import memoria

    check("the RAG guide has the same six classes, in the auditor's order", all(R.RAG_CLASS_GUIDE.index(f"{n}. {c}") < len(R.RAG_CLASS_GUIDE) for n, c in enumerate(memoria.LABELS_IN_GUIDE if hasattr(memoria, "LABELS_IN_GUIDE") else ("IRRELEVANT", "OUTDATED", "CONTRADICTS", "SUPPORTED_CURRENT", "UPDATES", "INSUFFICIENT_EVIDENCE"), 1)))
    messages = R.rag_messages(["[ES2004b 12:30] PM: kinetic it is", "[ES2004c 01:00] ID: rubber"], "We will use wood.")
    text = messages[1]["content"]
    check("the RAG prompt holds the excerpts and the statement, in that order, and nothing that is gold", text.index("kinetic it is") < text.index("We will use wood.") and "gold" not in text.lower() and "expected" not in text.lower())
    check("and its system prompt is the auditor's own", messages[0]["content"] == memoria.SYSTEM_PROMPT)


def embedding_checks() -> None:
    class Fake:
        def encode(self, texts):
            return np.array([[1.0, 0.0] if "kinetic" in t else [0.0, 1.0] for t in texts], dtype="float32")

    system = object.__new__(R.EmbeddingOnly)
    system.embedder = Fake()
    system.items = {"S": [{"citation": "[S:1]", "text": "kinetic"}, {"citation": "[S:2]", "text": "price"}]}
    system.vectors = {"S": np.array([[1.0, 0.0], [0.0, 1.0]], dtype="float32")}
    system.limits = {"tau_alert": 0.95, "low": 0.4, "high": 0.99}
    both = {r["system"]: r for r in system.predict("S", "a kinetic remote")}
    check("B1 raises an alert on a statement as close as the threshold, and cites the nearest decision", both["B1"]["alert"] and both["B1"]["pred"] == "CONTRADICTS" and both["B1"]["citation"] == "[S:1]" and both["B1"]["sim"] == 1.0, both["B1"])
    check("B1b reads the same similarity as a restatement, so no alert", both["B1b"]["pred"] == "SUPPORTED_CURRENT" and not both["B1b"]["alert"] and both["B1b"]["citation"] == "", both["B1b"])
    system.limits = {"tau_alert": 0.95, "low": 0.4, "high": 1.5}
    both = {r["system"]: r for r in system.predict("S", "a kinetic remote")}
    check("with a higher top band the same similarity is a possible conflict, and that is an alert", both["B1b"]["alert"] and both["B1b"]["pred"] == "CONTRADICTS")
    system.limits = None
    check("before any thresholds exist B1 predicts nothing, so a development run can only supply the similarities", all(r["pred"] == "" and not r["alert"] for r in system.predict("S", "x")))


class Spy:
    """A stand-in system that notes exactly what it was given."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def predict(self, series: str, statement: str) -> list[dict]:
        self.calls.append((series, statement))
        return [{"system": "SPY", "pred": "UPDATES", "alert": False, "citation": "", "raw": "UPDATES", "readable": True}]


def worker_checks() -> None:
    saved = (R.CACHE, R.RESULTS, R.files_for, R.make_system, R.footprint_gb)
    with tempfile.TemporaryDirectory() as scratch:
        folder = Path(scratch)
        probes = [{"id": f"ES9-{i}", "series_id": "ES9", "statement": f"Statement {i}.", "gold_label": "UPDATES", "gold_citation": None if i % 2 else "[ES9a:01:01]", "expected_alert": False} for i in range(10)]
        (folder / "bench.jsonl").write_text("".join(json.dumps(p) + "\n" for p in probes))
        (folder / "cache").mkdir()
        (folder / "cache" / "test.json").write_text(json.dumps({"series": {}}))
        spy = Spy()
        R.CACHE, R.RESULTS = folder / "cache", folder / "results"
        R.files_for = lambda split: (folder / "bench.jsonl", folder / "prov.jsonl")
        R.make_system = lambda name, cache, split: spy
        R.footprint_gb = lambda pid=None: (1.0, 2.5)
        try:
            check("the worker finishes", R.worker("SPY", "test", None) == 0)
            check("a system is handed a series id and a statement, and nothing else: no id, no gold label, no citation", all(isinstance(a, str) and isinstance(b, str) for a, b in spy.calls) and all(len(c) == 2 for c in spy.calls))
            handed = [b for a, b in spy.calls if b.startswith("Statement")]
            check("every probe's statement was handed over, once, after one untimed warm-up", handed == [p["statement"] for p in probes] and len(spy.calls) == 11)
            rows = [json.loads(l) for l in (folder / "results" / "_work" / "SPY.jsonl").read_text().splitlines()]
            check("each prediction is written with the gold label beside it, and a latency", len(rows) == 10 and all({"gold_label", "gold_citation", "latency_ms", "pred", "id"} <= set(r) for r in rows))
            meta = json.loads((folder / "results" / "_work" / "SPY.meta.json").read_text())
            check("the worker's meta records the process' lifetime-maximum footprint, not its current one", meta["peak_gb"] == 2.5 and meta["probes"] == 10, meta)
            spy.calls.clear()
            R.worker("SPY", "test", None)
            again = (folder / "results" / "_work" / "SPY.jsonl").read_text().splitlines()
            check("run again, it finds every probe done and asks the system about none of them", len(again) == 10 and len(spy.calls) == 1, (len(again), len(spy.calls)))
            (folder / "results" / "_work" / "SPY.jsonl").write_text("\n".join(again[:4]) + "\n")
            spy.calls.clear()
            R.worker("SPY", "test", None)
            resumed = [json.loads(l)["id"] for l in (folder / "results" / "_work" / "SPY.jsonl").read_text().splitlines()]
            check("a run that stopped after four probes resumes at the fifth, with no probe twice", resumed == [p["id"] for p in probes], resumed)
            sample = R.pick_probes(probes, 4)
            check("a smoke-test sample is evenly spaced, starts at the first probe and never repeats one", [p["id"] for p in sample] == ["ES9-0", "ES9-2", "ES9-5", "ES9-7"] and R.pick_probes(probes, None) == probes and R.pick_probes(probes, 99) == probes)
        finally:
            R.CACHE, R.RESULTS, R.files_for, R.make_system, R.footprint_gb = saved


def threshold_flow_checks() -> None:
    saved = (R.THRESHOLDS, R.RESULTS)
    with tempfile.TemporaryDirectory() as scratch:
        folder = Path(scratch)
        R.RESULTS, R.THRESHOLDS = folder, folder / "limits.json"
        dev = folder / "dev" / "_work"
        dev.mkdir(parents=True)
        rows = [{"sim": s, "gold_label": g, "expected_alert": a} for s, g, a in [
            (0.2, "IRRELEVANT", False), (0.3, "IRRELEVANT", False), (0.5, "CONTRADICTS", True), (0.55, "OUTDATED", True), (0.9, "SUPPORTED_CURRENT", False), (0.95, "SUPPORTED_CURRENT", False)]]
        (dev / "B1.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        try:
            limits = R.tune_thresholds()
            check("B1's thresholds are tuned from the development run, written to disk, and say where they came from", json.loads(R.THRESHOLDS.read_text()) == limits and limits["tuned_on"] == "development series" and limits["probes"] == 6)
            check("on data where the alerts sit in the middle, the alert threshold is the lowest alert, and the bands put that one on the conflict band", limits["tau_alert"] == 0.5 and limits["low"] <= 0.5 < limits["high"], limits)
        finally:
            R.THRESHOLDS, R.RESULTS = saved


def run_meta_checks() -> None:
    saved = (R.RESULTS, R.THRESHOLDS)
    with tempfile.TemporaryDirectory() as scratch:
        folder = Path(scratch)
        R.RESULTS, R.THRESHOLDS = folder, folder / "limits.json"
        (folder / "_work").mkdir()
        (folder / "_work" / "M2.meta.json").write_text(json.dumps({"probes": 336, "peak_gb": 3.5, "load_s": 5.0, "wall_s": 800.0, "model": "qwen", "secret": "x"}))
        try:
            record = R.write_run_meta(folder / "run_meta.json")
            on_disk = json.loads((folder / "run_meta.json").read_text())
            check("the run record is written, and what it says about the benchmark is its real hash", on_disk == record and record["benchmark"]["sha256"] == R.sha256(R.BENCH_FILE))
            check("it names the machine, the software, the models and the settings of the run", {"chip", "memory_gb", "macos"} <= set(record["machine"]) and {"mlx", "mlx_lm", "torch", "python"} <= set(record["software"]) and record["models"]["embedder"] == R.EMBEDDER and record["settings"]["top_k"] == R.TOP_K)
            check("it keeps only what a worker measured, per system", record["workers"] == {"M2": {"probes": 336, "peak_gb": 3.5, "load_s": 5.0, "wall_s": 800.0}}, record["workers"])
        finally:
            R.RESULTS, R.THRESHOLDS = saved


def main() -> int:
    metric_checks()
    bootstrap_checks()
    paired_checks()
    tuning_checks()
    report_checks()
    chunk_checks()
    memory_item_checks()
    guard_checks()
    freeze_checks()
    reading_checks()
    embedding_checks()
    worker_checks()
    threshold_flow_checks()
    run_meta_checks()
    print(f"All {len(passed)} benchmark-runner checks passed: metrics against scikit-learn, the plumbing, and the fairness rules.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
