"""Test of make_ch6_draft.py: every number in the Chapter 6 draft comes from a result file, and the headline figures agree with a recomputation.

No language model is loaded. Three kinds of check:
  - RECOMPUTATION  the main table (N3) is recomputed from results/predictions_raw.jsonl, the memory-size table (N7) from the six prediction files of the
                   scoping experiment, the benchmark facts (counts, hash, real and synthetic OUTDATED) from data/, and one cell of the retriever table (N8)
                   from the decisions and statements. None of this uses eval_metrics.py or the generator's own reading of the summaries.
  - FLOW-THROUGH   a number in a source file is changed and the draft must change with it: nothing in the prose is typed by hand.
  - HYGIENE        every file the draft names exists, every table is numbered once, no overclaiming phrase, the draft on disk is what the generator writes.

Run: python3.11 test_ch6_draft.py
"""

import copy
import hashlib
import json
import math
import re
import statistics
import sys
from pathlib import Path

import make_ch6_draft as D

HERE = Path(__file__).resolve().parent
R = HERE / "results"
SC = R / "scoping"
passed: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


def jlines(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def macro_f1(rows) -> float:
    scores = []
    for c in D.CLASSES:
        tp = sum(r["gold_label"] == c and r["pred"] == c for r in rows)
        fp = sum(r["gold_label"] != c and r["pred"] == c for r in rows)
        fn = sum(r["gold_label"] == c and r["pred"] != c for r in rows)
        scores.append(2 * tp / (2 * tp + fp + fn) if tp else 0.0)
    return sum(scores) / len(scores)


def alert_counts(rows) -> dict:
    tp = sum(r["gold_label"] in D.ALERTS and r["pred"] in D.ALERTS for r in rows)
    fp = sum(r["gold_label"] not in D.ALERTS and r["pred"] in D.ALERTS for r in rows)
    fn = sum(r["gold_label"] in D.ALERTS and r["pred"] not in D.ALERTS for r in rows)
    tn = sum(r["gold_label"] not in D.ALERTS and r["pred"] not in D.ALERTS for r in rows)
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn}


def table_row(text: str, start: str) -> list[str]:
    """The cells of the first table line that starts with `start`, bold marks removed."""
    for line in text.splitlines():
        if line.startswith(start):
            return [cell.strip().replace("**", "") for cell in line.strip("|").split("|")]
    raise AssertionError(f"no table row starting {start!r}")


def number(cell: str) -> float:
    return float(re.match(r"-?[\d,]*\.?\d+", cell.replace("−", "-")).group(0).replace(",", ""))


def section(text: str, first: str, after: str) -> str:
    """The part of the draft from the caption of table `first` up to the caption of table `after`."""
    start, end = text.index(f"\nTable {first} "), text.index(f"\nTable {after} ")
    return text[start:end]


# --- recomputation -----------------------------------------------------------------------------------------------------

OFFICIAL = ("ES2004", "ES2014", "IS1009", "TS3003", "TS3007")


def recompute_main_table(text: str, subset: bool = False) -> None:
    rows = jlines(R / "predictions_raw.jsonl")
    check("the raw predictions hold 6 systems x 336 statements", len(rows) == 6 * 336 and len({r["system"] for r in rows}) == 6)
    label = "N6" if subset else "N3"
    if subset:
        rows = [r for r in rows if r["series_id"] in OFFICIAL]
        check("the official subset is 60 statements of 5 series for each system", len(rows) == 6 * 60 and len({r["series_id"] for r in rows}) == 5)
    for code, start in (("B0", "| B0 "), ("B1", "| B1 Embeddings, alert"), ("B1b", "| B1b "), ("B2", "| B2 "), ("M2", "| M2 "), ("A1", "| A1 ")):
        mine = [r for r in rows if r["system"] == code]
        cells = table_row(section(text, "N6", "N7") if subset else section(text, "N3", "N4"), start)
        counts = alert_counts(mine)
        accuracy = 100 * sum(r["pred"] == r["gold_label"] for r in mine) / len(mine)
        precision = counts["tp"] / (counts["tp"] + counts["fp"])
        recall = counts["tp"] / (counts["tp"] + counts["fn"])
        false_alarm = 100 * counts["fp"] / (counts["fp"] + counts["tn"])
        check(f"{code}: accuracy in Table {label} is {accuracy:.1f}", number(cells[1]) == round(accuracy, 1), cells[1])
        check(f"{code}: Macro-F1 in Table {label} is {macro_f1(mine):.2f}", number(cells[2]) == round(macro_f1(mine), 2), cells[2])
        check(f"{code}: alert precision, recall and false-alarm rate in Table {label}", (number(cells[3]), number(cells[4]), number(cells[5])) == (round(precision, 2), round(recall, 2), round(false_alarm, 1)), cells[3:6])
        latencies = sorted(r["latency_ms"] for r in mine)
        check(f"{code}: median latency in Table {label} is {statistics.median(latencies):,.0f} ms", number(cells[6]) == round(statistics.median(latencies)), cells[6])
    if subset:
        return
    m2 = alert_counts([r for r in rows if r["system"] == "M2"])
    b2 = alert_counts([r for r in rows if r["system"] == "B2"])
    b1 = alert_counts([r for r in rows if r["system"] == "B1"])
    check("the text says M2 finds the right number of alerts and raises the right number of false alarms",
          f"M2 finds {m2['tp']} of the {m2['tp'] + m2['fn']} alerts" in text and f"raises {m2['fp']} false alarm among the {m2['fp'] + m2['tn']} statements" in text)
    by_id = {s: {r["id"]: r for r in rows if r["system"] == s} for s in ("M2", "B2")}
    right = lambda r: (r["pred"] in D.ALERTS) == (r["gold_label"] in D.ALERTS)
    b = sum(right(by_id["M2"][i]) and not right(by_id["B2"][i]) for i in by_id["M2"])
    c = sum(right(by_id["B2"][i]) and not right(by_id["M2"][i]) for i in by_id["M2"])
    n = b + c
    p = min(1.0, 2 * sum(math.comb(n, i) for i in range(min(b, c) + 1)) / 2 ** n)
    check(f"the McNemar counts and exact p-value of M2 against B2 are b={b}, c={c}, p={p:.1e}, recomputed from the predictions",
          f"M2 is right on {b} alert decisions where transcript retrieval is wrong, and wrong on {c} where it is right (exact McNemar p = {p:.1e})" in text, (b, c, p))
    check("and B2 and B1 likewise", f"Transcript retrieval is quiet ({b2['fp']} false alarms) but finds only {b2['tp']} of {b2['tp'] + b2['fn']} alerts" in text and f"B1 finds {b1['tp']} alerts too" in text)


def recompute_examples(text: str) -> None:
    bench = jlines(HERE / "data" / "memoria_bench.jsonl")
    block = section(text, "N1", "N2")
    rows = [line for line in block.splitlines() if line.startswith("| ") and not line.startswith(("| Class", "|---"))]
    check("Table N1 has one example for each of the six classes", len(rows) == 6 and [r.split("|")[1].strip() for r in rows] == list(D.CLASSES), rows)
    for line in rows:
        cells = [c.strip() for c in line.strip("|").split("|")]
        matches = [r for r in bench if r["statement"] == cells[3] and r["series_id"] == D.EXAMPLE_SERIES and r["gold_label"] == cells[0]]
        check(f"Table N1: the {cells[0]} example is a real statement of that class in {D.EXAMPLE_SERIES}", len(matches) >= 1, cells[3])
        citation = cells[4].split(" ")[0] if cells[4] != "none" else None
        check(f"Table N1: the {cells[0]} example cites its own gold citation and marks the alert correctly", any((r["gold_citation"] == citation) and (cells[2] == "yes") == r["expected_alert"] for r in matches), cells)


def recompute_scale_table(text: str) -> None:
    for condition in ("C0", "C1", "C2"):
        for system in ("M2", "M3"):
            rows = jlines(SC / "_work" / f"{system}@{condition}.jsonl")
            check(f"{system}@{condition}: 336 statements", len(rows) == 336)
            cells = [c for c in text.splitlines() if c.startswith(f"| {condition} (") and f"| {system} |" in c]
            check(f"{system}@{condition}: one row in Table N7", len(cells) == 1)
            cells = [c.strip().replace("**", "") for c in cells[0].strip("|").split("|")]
            counts = alert_counts(rows)
            check(f"{system}@{condition}: Macro-F1 {macro_f1(rows):.2f} in Table N7", number(cells[4]) == round(macro_f1(rows), 2), cells[4])
            check(f"{system}@{condition}: alert recall {counts['tp'] / (counts['tp'] + counts['fn']):.2f}, false alarms {counts['fp']}", (number(cells[5]), number(cells[6])) == (round(counts["tp"] / (counts["tp"] + counts["fn"]), 2), counts["fp"]), cells[5:7])
            check(f"{system}@{condition}: median time of the batch run", number(cells[7]) == round(statistics.median(r["latency_ms"] for r in rows) / 1000, 2), cells[7])


def recompute_benchmark_facts(d: dict, text: str) -> None:
    bench = jlines(HERE / "data" / "memoria_bench.jsonl")
    prov = {r["id"]: r for r in jlines(HERE / "data" / "memoria_bench.provenance.jsonl")}
    digest = hashlib.sha256((HERE / "data" / "memoria_bench.jsonl").read_bytes()).hexdigest()
    check("the hash in the draft is the SHA-256 of the benchmark file as it is now", f"`{digest[:8]}…{digest[-4:]}`" in text)
    check("the file holds 336 statements, 28 series, 112 alerts", (len(bench), len({r["series_id"] for r in bench}), sum(r["expected_alert"] for r in bench)) == (336, 28, 112))
    outdated = [prov[r["id"]]["basis"] for r in bench if r["gold_label"] == "OUTDATED"]
    real, synthetic = outdated.count("real-supersession"), outdated.count("synthetic-supersession")
    check("the draft says 5 real and 51 synthetic OUTDATED statements, counted from the provenance", (real, synthetic) == (5, 51) and f"only **{real}** of the {real + synthetic} OUTDATED" in text and f"For the other **{synthetic}**" in text, (real, synthetic))
    check("the draft names the five development series", all(s in text for s in ("ES2003", "ES2011", "IS1008", "TS3004", "TS3006")) and not any(r["series_id"] in ("ES2003", "ES2011", "IS1008", "TS3004", "TS3006") for r in bench))
    check("each class has 56 statements", all(sum(r["gold_label"] == c for r in bench) == 56 for c in D.CLASSES) and "each class has 56 statements" in text)
    m2_rows = {r["id"]: r for r in jlines(R / "predictions_raw.jsonl") if r["system"] == "M2"}
    found_real = sum(m2_rows[i]["pred"] == "OUTDATED" for i, p in prov.items() if p["basis"] == "real-supersession" and m2_rows[i]["gold_label"] == "OUTDATED")
    found_synthetic = sum(m2_rows[i]["pred"] == "OUTDATED" for i, p in prov.items() if p["basis"] == "synthetic-supersession" and m2_rows[i]["gold_label"] == "OUTDATED")
    check("M2 finds 4 of the 5 real and 36 of the 51 synthetic replacements, as the draft says, counted from the predictions", f"Of the {real} real replacements M2 finds {found_real}, and of the {synthetic} synthetic ones {found_synthetic}." in text, (found_real, found_synthetic))
    audit = json.loads((HERE / "data" / "memoria_bench.audit.json").read_text(encoding="utf-8"))
    r1, r2, r3 = audit["rounds"]
    check("the audit rounds in the draft are the ones on file", f"agreed on {r1['agree']} of {r1['rows']} statements" in text and f"agreed on {r2['agree']} of {r2['rows']}" in text and f"({r3['agree']} of {r3['rows']})" in text)
    check("the audit round 3 hash is the benchmark's hash", r3["dataset_sha256"] == digest, (r3["dataset_sha256"][:8], digest[:8]))


def recompute_retriever_cell(d: dict, text: str) -> None:
    import retriever_bakeoff as B
    c = B.corpus()
    items = B.memories_for("test", c, "C2")
    probes = c["test"]["probes"]
    found = B.recall_at(B.rankings_for("bm25", probes, items, None, None), probes, items, ks=(8,))
    row = table_row(section(text, "N8", "N8") if False else text[text.index("\nTable N8 "):], "| BM25 |")
    check(f"BM25 at C2: {found['found'][8]} of {found['n']} in Table N8, recomputed from the decisions", number(row[3]) == round(100 * found["found"][8] / found["n"]), (row, found))
    check("the number of statements with a gold decision is 168", found["n"] == 168 and "For the 168 statements that have a gold decision" in text)


# --- flow-through ------------------------------------------------------------------------------------------------------

def flow_through() -> None:
    base = D.load()
    original = D.build(base)

    def changed(name, mutate, needle):
        d = copy.deepcopy(base)
        mutate(d)
        text = D.build(d)
        check(f"flow-through: {name}", needle in text and needle not in original, needle)

    changed("M2's true alerts", lambda d: d["rows"][("full", "M2")].__setitem__("tp", "99"), "M2 finds 99 of the")
    changed("the McNemar count", lambda d: d["stats"]["comparisons"]["B2"]["mcnemar_alert"].__setitem__("only_first", 77), "M2 is right on 77 alert decisions")
    changed("the accuracy margin", lambda d: d["scale"]["verdicts"]["E1"].__setitem__("delta", -0.0123), "differs from M2 by −0.012")
    changed("the interleaved latency", lambda d: d["post"]["paired"]["C2"]["p50_ms"].__setitem__("M2", 4321.0), "3.78 s at C2".replace("3.78", "4.32"))
    changed("a retriever cell", lambda d: d["bakeoff"]["result"]["test"]["C2"]["bm25"]["found"].__setitem__("8", 100), "| BM25 | 96% | 89% | 60% |")
    changed("the Malay recall", lambda d: d["malay"]["results"]["bge-small | C0 | Malay"].__setitem__("4", 28), "for 50% of Malay statements with bge-small")
    changed("the first audit round", lambda d: d["audit"]["rounds"][0].__setitem__("agree", 300), "agreed on 300 of 336")
    changed("a scale row", lambda d: [r.__setitem__("macro_f1", 0.5) for r in d["scale"]["table"] if r["system"] == "M2@C2"], "0.50 with 86")
    changed("an M3 alert recall", lambda d: [r.__setitem__("alert_recall", 0.11) for r in d["scale"]["table"] if r["system"] == "M3@C1"], "and 0.11 and 0.66 against 0.97 and 0.90 at C1 and C2")
    sc = lambda d: d["scale"]
    changed("the scope recall at C2", lambda d: sc(d)["scope_recall"]["C2"].__setitem__("recall", 0.5), "and 50% at C2")
    changed("the out-of-scope count at C2", lambda d: sc(d)["attribution"]["M3@C2"].__setitem__("gold_outside_scope", 12), "12 of 39 at C2")
    changed("the paired latency ratio at C0", lambda d: d["post"]["paired"]["C0"]["ratio_of_medians"].__setitem__("ratio", 0.55), "ratio 0.55 [")
    changed("the paired latency ratio at C2", lambda d: d["post"]["paired"]["C2"]["ratio_of_medians"].__setitem__("ratio", 0.31), "(ratio 0.31)")
    changed("the share of statements where M3 was faster", lambda d: d["post"]["paired"]["C0"].__setitem__("share_of_probes_where_m3_was_faster", 0.5), "faster on 50% of the statements")
    changed("the interleaved sample size", lambda d: d["post"]["paired"]["C0"].__setitem__("probes", 113), "on the same 113 statements")
    changed("the topic call time", lambda d: sc(d)["topic_latency"]["llm_topic_call_ms"].__setitem__("p50", 999.0), "a median of 999 ms")
    changed("the embedding step time", lambda d: sc(d)["topic_latency"]["embedding_step_ms"].__setitem__("p50", 41.0), "against 41 ms for the embedding step")
    changed("the recall-safe rule", lambda d: d["bakeoff"]["rule"].__setitem__("recall", 0.9), "below the 90% that was required")
    changed("the number of extra decisions", lambda d: d["config"].__setitem__("extra", 3), "plus up to 3 decisions")
    changed("the size of condition C1", lambda d: d["conditions"].__setitem__("C1", 31), "C1 adds 31 decisions")
    changed("the development scope recall", lambda d: d["config"]["development"]["sweep"]["rule"]["4"].__setitem__("found", 28), "(28 of 30)")
    changed("the number of changed answers", lambda d: d["post"]["movement_m2_c0_c2"].__setitem__("changed", 58), "Of the 58 statements whose answer changed")
    changed("the BM25 time", lambda d: d["bakeoff"]["bm25_ms"]["C3"].__setitem__("p50_ms", 0.5), "| BM25 | 96% | 89% | 89% | 65% | 0.50 ms | no model |")
    changed("the degradation of M2 at C1", lambda d: sc(d)["verdicts"]["E4_degrade_C1"].__setitem__("delta", -0.2), "−0.200 [")
    changed("the series sign count", lambda d: d["stats"]["comparisons"]["B2"]["series_sign_alert"].__setitem__("first_better", 20), "M2 is better in 20 of the 28 series")
    changed("the false-alarm test", lambda d: d["stats"]["comparisons"]["B2"]["mcnemar_false_alarms"].__setitem__("exact_p", 0.5), "(p = 0.500)")
    changed("the permutation p", lambda d: d["stats"]["comparisons"]["B2"]["permutation_series"].__setitem__("p", 0.0123), "gives p = 0.012")
    changed("the official subset", lambda d: d["rows"][("official_subset", "M2")].__setitem__("macro_f1", "0.5"), "M2 reaches Macro-F1 0.50")
    changed("the OUTDATED recall of M2", lambda d: d["per_class"][("full", "M2")].__setitem__("OUTDATED", "0.9"), "falls from 90.0% to 5.4%")
    changed("the closed-book alert recall", lambda d: d["rows"][("full", "B0")].__setitem__("alert_recall", "0.5"), "(recall 0.50), which gives no sign")
    changed("the time of M2 in the main run", lambda d: d["rows"][("full", "M2")].__setitem__("p50_ms", "3000"), "M2 took a median of 3.00 s")
    changed("the minutes of model time", lambda d: d["work_meta"][0].__setitem__("wall_s", d["work_meta"][0]["wall_s"] + 6000), "168 minutes of model time")
    changed("the machine's memory", lambda d: d["meta"]["machine"].__setitem__("memory_gb", 34.4), "Apple M5, 32 GB")
    changed("the bge-small time", lambda d: d["bakeoff"]["meta"]["bge-small"].__setitem__("p50_ms", 9.9), "| 9.9 ms | 0.79 GB (CPU) |")
    changed("the EmbeddingGemma memory", lambda d: d["bakeoff"]["meta"]["eg2-5bit-asym"].__setitem__("mlx_peak_gb", 2.0), "| 2.00 GB (Metal) |")
    changed("the margin of the accuracy test", lambda d: sc(d)["verdicts"]["E1"].__setitem__("text", "Scoping preserves accuracy at C0: the lower bound -0.036 is above -0.08."), "the margin of −0.08")
    changed("the scope recall at C0", lambda d: sc(d)["scope_recall"]["C0"].__setitem__("recall", 0.5), "for 50% of the 168 statements")
    changed("the scope recall at C1", lambda d: sc(d)["scope_recall"]["C1"].__setitem__("recall", 0.5), ", 50% at C1")
    changed("the out-of-scope count at C0", lambda d: sc(d)["attribution"]["M3@C0"].__setitem__("gold_outside_scope", 3), "3 of 10 at C0")
    changed("the out-of-scope count at C1", lambda d: sc(d)["attribution"]["M3@C1"].__setitem__("gold_outside_scope", 3), "3 of 30 at C1")
    changed("the wrong-with-gold count at C0", lambda d: sc(d)["attribution"]["M3@C0"].__setitem__("wrong_with_gold_decision", 11), "9 of 11 at C0")
    changed("M2's alert recall at C1", lambda d: [r.__setitem__("alert_recall", 0.5) for r in sc(d)["table"] if r["system"] == "M2@C1"], "falls from 0.98 to 0.50 and 0.90")
    changed("M2's alert recall at C2", lambda d: [r.__setitem__("alert_recall", 0.5) for r in sc(d)["table"] if r["system"] == "M2@C2"], "to 0.97 and 0.50, while")
    changed("M2's alert recall at C0", lambda d: [r.__setitem__("alert_recall", 0.5) for r in sc(d)["table"] if r["system"] == "M2@C0"], "falls from 0.50 to 0.97")
    changed("M3's alert recall at C0", lambda d: [r.__setitem__("alert_recall", 0.5) for r in sc(d)["table"] if r["system"] == "M3@C0"], "it is 0.50 against 0.98 at C0")
    changed("M2's Macro-F1 at C1", lambda d: [r.__setitem__("macro_f1", 0.5) for r in sc(d)["table"] if r["system"] == "M2@C1"], "to 0.50 with 42")
    changed("M2's false alarms at C2", lambda d: [r.__setitem__("false_alarms", 9) for r in sc(d)["table"] if r["system"] == "M2@C2"], "stay at 1, 1 and 9")
    changed("the prompt tokens at C2", lambda d: [r.__setitem__("prompt_tokens_p50", 5000.0) for r in sc(d)["table"] if r["system"] == "M2@C2"], "from 914 to 5000 tokens")
    changed("the OUTDATED recall of M2 at C2", lambda d: d["post"]["class_recall"]["M2@C2"].__setitem__("OUTDATED", 0.2), "from 71% to 20%")
    changed("the recall for CONTRADICTS of M2 at C0", lambda d: d["post"]["class_recall"]["M2@C0"].__setitem__("CONTRADICTS", 0.9), "for CONTRADICTS from 90% to")
    changed("the chunk size of B2", lambda d: d["meta"]["settings"].__setitem__("chunk_words", 77), "chunks of about 77 words")
    changed("the number of chunks of B2", lambda d: d["meta"]["settings"].__setitem__("top_k", 7), "the 7 nearest chunks")
    changed("a retriever cell at C3", lambda d: d["bakeoff"]["result"]["test"]["C3"]["eg2-5bit-asym@768 hybrid"]["found"].__setitem__("8", 100), "| EmbeddingGemma 2, 5-bit + BM25 | 99% | 93% | 90% | 60% |")
    changed("the best variant at C2", lambda d: d["bakeoff"]["result"]["test"]["C2"]["eg2-4bit-asym@256 hybrid"]["found"].__setitem__("8", 160), "The best of the 23 variants tried reaches 95% in C2")
    changed("the best dense EmbeddingGemma variant", lambda d: d["bakeoff"]["result"]["test"]["C2"]["eg2-8bit-asym@768 dense"]["found"].__setitem__("8", 150), "best dense variant 89%")
    changed("the 5-bit memory in the text", lambda d: d["bakeoff"]["meta"]["eg2-5bit-asym"].__setitem__("mlx_peak_gb", 2.5), "at about 2.5 GB of Metal memory")
    changed("the Malay recall of EmbeddingGemma at C2", lambda d: d["malay"]["results"]["eg2-5bit | C2 | Malay"].__setitem__("4", 28), "with the larger memory (C2) 34% and 50%")
    changed("the existing table number", lambda d: d.__setitem__("last_table", 25), "Tables 6.1 to 6.25")
    changed("the scope-size range", lambda d: d["config"].__setitem__("rule_for_k", "smallest k in [3, 4, 5, 6, 7] with development scope recall >= 0.9"), "smallest from 3 to 7 whose scope held the gold decision for at least 90%")
    changed("a round number of the audit", lambda d: d["audit"]["rounds"][2].__setitem__("round", 9), "Round 9 re-checked")
    changed("the interleaved latency of M3 at C2", lambda d: d["post"]["paired"]["C2"]["p50_ms"].__setitem__("M3", 2000.0), "2.00 s against 3.78 s at C2")
    changed("the C2 95th percentile", lambda d: d["post"]["paired"]["C2"]["p95_ms"].__setitem__("M2", 9000.0), "with a 95th percentile of 9.00 s at C2")
    d = copy.deepcopy(base)
    for k in [k for k in d["prov"] if k.endswith("-O-02")][:3]:
        d["prov"][k]["basis"] = "real-supersession"
    text = D.build(d)
    check("flow-through: three synthetic statements turned real read as 8 and 48", "only **8** of the 56 OUTDATED" in text and "For the other **48**" in text)


# --- helpers and hygiene -----------------------------------------------------------------------------------------------

def helper_checks() -> None:
    check("signed: a tiny negative shows as 0.000, not -0.000", D.signed(-0.0000334) == "0.000")
    check("signed: a positive gets +, a negative a real minus sign", D.signed(0.0123) == "+0.012" and D.signed(-0.2) == "\u22120.200")
    check("dci writes both bounds with signs", D.dci(-0.036, 0.032) == "[\u22120.036, +0.032]")
    check("model_name", D.model_name("gpt-5.5") == "GPT-5.5" and D.model_name("gpt-5.6-sol") == "GPT-5.6 Sol")
    check("sci: plain for ordinary p-values and scientific for tiny ones", D.sci(0.0129) == "0.013" and D.sci(1.58e-15) == "1.6e-15")
    toy = {"changed": 6, "became_right": 1, "became_wrong": 4, "moves": [[["OUTDATED", "OUTDATED", "CONTRADICTS"], 2], [["CONTRADICTS", "CONTRADICTS", "SUPPORTED_CURRENT"], 1], [["UPDATES", "UPDATES", "SUPPORTED_CURRENT"], 1], [["IRRELEVANT", "INSUFFICIENT_EVIDENCE", "IRRELEVANT"], 1], [["CONTRADICTS", "OUTDATED", "SUPPORTED_CURRENT"], 1]]}
    check("movement_summary on a toy example: 2 swapped, 1 lost, 1 other; right-to-wrong only", D.movement_summary(toy) == {"wrong": 4, "swap": 2, "lost": 1, "other": 1}, D.movement_summary(toy))
    real = D.load()["post"]["movement_m2_c0_c2"]
    mv = D.movement_summary(real)
    check("movement_summary on the real data agrees with the stored count and sums up", mv["wrong"] == real["became_wrong"] and mv["swap"] + mv["lost"] + mv["other"] == mv["wrong"], mv)
    parts, notes = D.export_parts("chapter_6_table_1.md")
    check("export_parts: a table of 6 systems plus header and rule, and a note without the bold title", len(parts) == 8 and parts[0].startswith("| System") and notes.startswith("Bold marks") and "Results on MemoriaBench" not in notes, (len(parts), notes[:30]))


def hygiene(text: str) -> None:
    d = D.load()
    check("the draft on disk is what the generator writes now", (R / "chapter6_memoriabench_draft.md").read_text(encoding="utf-8") == text)
    titles = re.findall(r"^Table (N\d+) ", text, flags=re.M)
    check("tables N1 to N8 each appear once, in order", titles == [f"N{i}" for i in range(1, 9)], titles)
    check("the opening note names the same range of tables", "called N1 to N8" in text, text[:1200])
    names = set(re.findall(r"`([^`\s]+\.(?:py|json|jsonl|csv|md|txt|sha256))`", text))
    missing = sorted(n for n in names if not any(p.exists() for p in (HERE / n, R / n, HERE / "data" / n, SC / n, SC / "bakeoff" / n)))
    check("every file the draft names exists", not missing, missing)
    for pattern in (r"never mix", r"\bprove[sd]?\b", r"\bperfect", r"\bsolved\b", r"guarantee", r"significantly faster", r"significant improvement in false"):
        check(f"no overclaim: the draft does not match '{pattern}'", not re.search(pattern, text.lower()))
    check("it keeps the honest limits: synthetic notes, language-model auditors only, small samples", all(s in text for s in ("synthetic", "No person labelled any statement", "not a benchmark", "**not** significant")))
    check("it says the Malay statements were written by the AI assistant and not reviewed", "by the AI assistant, not reviewed by a second Malay speaker" in text)
    check("it states the post-run parser fix and where the old code is kept", "results/memoria_as_run.py" in text and "found after the scale runs" in text)
    check("it states that no retriever passed the rule and gives the best figures", "No retriever is recall-safe" in text and "below the 95% that was required" in text)
    check("it says in so many words that similarity scoping is not safe here and no further run was made", "so no further language-model run was made and similarity scoping is not safe on this benchmark" in text)
    check("it does not claim that scoping helps", "there is no evidence that it helps" in text and "Scoping is faster but loses alerts" in text)
    chapter = D.CHAPTER_6
    if chapter.exists():
        body = chapter.read_text(encoding="utf-8")
        check("every section the draft cites exists in the report's Chapter 6", all(re.search(rf"^#+ {re.escape(sec)} ", body, flags=re.M) for sec in ("6.4.2", "6.4.5", "6.7", "6.8")), "")
        check("Table 6.1 of the report is the evidence map the note refers to", "Table 6.1 Evidence for each objective and research question" in body)
        highest = max(int(x) for x in re.findall(r"Table 6\.(\d+)\b", body))
        check(f"the note says the report's tables run to 6.{highest}", f"Tables 6.1 to 6.{highest}" in text)
        check("the report's objectives are O1 to O3 and its questions RQ1 to RQ3, as the note says", all(f"| O{i} " in body or f"O{i} " in body for i in (1, 2, 3)) and "RQ4" not in body)
    check("the decision note to the author is present and says to agree it with the supervisor", "Agree this with the supervisor first." in text)
    check("the draft is not in the report build", "ch06_memoriabench_draft" not in Path("~/Desktop/FYP/report/ap2/build_ap2.sh").expanduser().read_text(encoding="utf-8") if Path("~/Desktop/FYP/report/ap2/build_ap2.sh").expanduser().exists() else True)
    check("the generator writes only the draft file", D.OUT.parent == R and D.REPORT_COPY.name == "ch06_memoriabench_draft.md")


def main() -> int:
    helper_checks()
    d = D.load()
    text = D.build(d)
    recompute_main_table(text)
    recompute_main_table(text, subset=True)
    recompute_examples(text)
    recompute_scale_table(text)
    recompute_benchmark_facts(d, text)
    recompute_retriever_cell(d, text)
    flow_through()
    hygiene(text)
    print(f"All {len(passed)} Chapter 6 draft checks passed: the figures match a recomputation, flow from the files, and the limits are stated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
