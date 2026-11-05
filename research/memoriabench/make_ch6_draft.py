"""Draft of one Chapter 6 subsection for the MemoriaBench work (Steps 10 to 13), written from the result files.

No number in the text is typed by hand: every figure is read from a file under results/ or data/ and put into the prose here, and
test_ch6_draft.py recomputes the headline figures from the raw predictions and compares them with what the draft says.
The draft is a stand-alone file. It is NOT in the report's build (build_ap2.sh lists its chapter files by name) and it changes no chapter.

    python3.11 make_ch6_draft.py            writes results/chapter6_memoriabench_draft.md
    python3.11 make_ch6_draft.py --report   also copies it to ~/Documents/Memoria-FYP/report/ap2/ch06_memoriabench_draft.md
"""

import csv
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
R = HERE / "results"
DATA = HERE / "data"
SC = R / "scoping"
BK = SC / "bakeoff"
OUT = R / "chapter6_memoriabench_draft.md"
# The private report moved from ~/Desktop/FYP to ~/Documents/Memoria-FYP when the repositories were consolidated.
REPORT_DIR = next((path for path in (Path.home() / "Documents" / "Memoria-FYP" / "report" / "ap2",
                                     Path.home() / "Desktop" / "FYP" / "report" / "ap2") if path.exists()),
                  Path.home() / "Documents" / "Memoria-FYP" / "report" / "ap2")
REPORT_COPY = REPORT_DIR / "ch06_memoriabench_draft.md"
CHAPTER_6 = REPORT_DIR / "ch06_results_discussion.md"

CLASSES = ("SUPPORTED_CURRENT", "OUTDATED", "CONTRADICTS", "UPDATES", "IRRELEVANT", "INSUFFICIENT_EVIDENCE")
EXAMPLE_SERIES = "ES2004"


def jload(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def jlines(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def pct(x, digits=0):
    return f"{100 * x:.{digits}f}%"


def f2(x):
    return f"{x:.2f}"


def f3(x):
    return f"{x:.3f}"


MINUS = "\u2212"
ALERTS = ("OUTDATED", "CONTRADICTS")


def signed(x, digits=3):
    text = f"{abs(x):.{digits}f}"
    if float(text) == 0:
        return text
    return ("+" if x > 0 else MINUS) + text


def dci(lo, hi, digits=3):
    """An interval of a difference, with signs: [-0.036, +0.032]."""
    return f"[{signed(lo, digits)}, {signed(hi, digits)}]"


def model_name(raw):
    return raw.replace("gpt-", "GPT-").replace("-sol", " Sol")


def movement_summary(movement):
    """Among the statements M2 answered right at C0 and wrong at C2: alert swapped for the other alert class, alert lost, or a non-alert mixed up."""
    wrong = swap = lost = other = 0
    for (gold, before, after), count in movement["moves"]:
        if before == gold and after != gold:
            wrong += count
            if gold in ALERTS and after in ALERTS:
                swap += count
            elif gold in ALERTS:
                lost += count
            else:
                other += count
    return {"wrong": wrong, "swap": swap, "lost": lost, "other": other}


def ci(lo, hi, digits=2):
    return f"[{lo:.{digits}f}, {hi:.{digits}f}]"


def sci(p):
    """A p-value the way the exports print it: plain below 0.1, scientific for tiny ones."""
    return f"{p:.3f}" if p >= 0.001 else f"{p:.1e}"


def p_text(p):
    """'p below 0.001' or 'p = 0.013'."""
    return "p below 0.001" if p < 0.001 else f"p = {p:.3f}"


def secs(ms):
    return f"{ms / 1000:.2f} s"


def export_parts(name):
    """The markdown export as (table lines, note text): its bold title line is dropped, the caption is written here."""
    lines = (R / name).read_text(encoding="utf-8").splitlines()
    table = [line for line in lines if line.startswith("|")]
    notes = " ".join(line.strip() for line in lines if line.strip() and not line.startswith(("|", "**")))
    return table, notes


def last_table_of_chapter_6():
    """The highest table number the report's Chapter 6 uses, or None when the chapter file is not on this machine."""
    if not CHAPTER_6.exists():
        return None
    numbers = [int(x) for x in re.findall(r"Table 6\.(\d+)\b", CHAPTER_6.read_text(encoding="utf-8"))]
    return max(numbers) if numbers else None


def load():
    d = {}
    d["bench"] = jlines(DATA / "memoria_bench.jsonl")
    d["prov"] = {r["id"]: r for r in jlines(DATA / "memoria_bench.provenance.jsonl")}
    d["hash"] = (DATA / "memoria_bench.sha256").read_text(encoding="utf-8").split()[0]
    d["audit"] = jload(DATA / "memoria_bench.audit.json")
    d["meta"] = jload(R / "run_meta.json")
    d["rows"] = {}
    for r in csv.DictReader((R / "table_6_1.csv").open(encoding="utf-8")):
        d["rows"][(r["split"], r["system"])] = r
    d["per_class"] = {}
    for r in csv.DictReader((R / "per_class.csv").open(encoding="utf-8")):
        d["per_class"][(r["split"], r["system"])] = r
    d["stats"] = jload(R / "stat_tests.json")
    d["scale"] = jload(SC / "scoping_results.json")
    d["post"] = jload(SC / "posthoc_results.json")
    d["bakeoff"] = jload(BK / "bakeoff_results.json")
    d["malay"] = jload(BK / "malay_results.json")
    d["prereg"] = jload(SC / "preregistration.json")
    d["last_table"] = last_table_of_chapter_6()
    d["config"] = jload(SC / "config.json")
    d["work_meta"] = [jload(path) for path in sorted((SC / "_work").glob("*.meta.json"))]
    d["conditions"] = jload(SC / "conditions.json")["conditions"]
    return d


def cell(row, key, digits=2):
    return f"{float(row[key]):.{digits}f}"


def class_example(d, label):
    """One real probe of the example series: its statement, its citation and the decision it rests on."""
    row = next(r for r in d["bench"] if r["series_id"] == EXAMPLE_SERIES and r["gold_label"] == label)
    return row, d["prov"][row["id"]]


def scale_row(d, system, condition):
    return next(r for r in d["scale"]["table"] if r["system"] == f"{system}@{condition}")


def build(d):
    n = len(d["bench"])
    series = sorted({r["series_id"] for r in d["bench"]})
    n_series = len(series)
    per_class = n // len(CLASSES)
    alerts = sum(r["expected_alert"] for r in d["bench"])
    basis = [d["prov"][r["id"]]["basis"] for r in d["bench"] if r["gold_label"] == "OUTDATED"]
    real, synthetic = basis.count("real-supersession"), basis.count("synthetic-supersession")
    meta = d["meta"]
    lm = meta["models"]["language_model"]
    existing_tables = f"Tables 6.1 to 6.{d['last_table']}" if d["last_table"] else "numbered tables"
    ram = round(meta["machine"]["memory_gb"] * 1e9 / 2**30)
    model = "Qwen3.5-4B, 4-bit" if "Qwen3.5-4B" in lm and "4bit" in lm else lm
    rounds = d["audit"]["rounds"]
    m2, b2 = d["rows"][("full", "M2")], d["rows"][("full", "B2")]
    b1, b0 = d["rows"][("full", "B1")], d["rows"][("full", "B0")]
    a1 = d["rows"][("full", "A1")]
    sub = d["rows"][("official_subset", "M2")]
    sub_n = int(sub["n"])
    st_b2 = d["stats"]["comparisons"]["B2"]
    st_b1 = d["stats"]["comparisons"]["B1"]
    pcm, pca = d["per_class"][("full", "M2")], d["per_class"][("full", "A1")]
    non_alerts = n - alerts
    sc = d["scale"]
    verdicts = sc["verdicts"]
    paired = d["post"]["paired"]
    movement = d["post"]["movement_m2_c0_c2"]
    mv = movement_summary(movement)
    assert mv["wrong"] == movement["became_wrong"], (mv, movement["became_wrong"])
    audit_scope = d["post"]["audit"]
    topic_latency = sc["topic_latency"]
    scope_recall = sc["scope_recall"]
    attribution = sc["attribution"]
    c = sc["contrasts"]
    k = sc["k"]
    margin = float(re.search(r"above (-\d+\.\d+)", verdicts["E1"]["text"]).group(1))
    run_minutes = round(sum(m["wall_s"] for m in d["work_meta"]) / 60)
    extra = d["config"]["extra"]
    dev = d["config"]["development"]["sweep"]["rule"][str(k)]
    dev_found, dev_n = dev["found"], dev["n"]
    conds = d["conditions"]
    sizes = [int(x) for x in re.search(r"\[(.*?)\]", d["config"]["rule_for_k"]).group(1).split(",")]
    k_low, k_high = min(sizes), max(sizes)
    k_floor = float(re.search(r">= ([\d.]+)", d["config"]["rule_for_k"]).group(1))
    k_c0, k_c1, k_c2 = (scale_row(d, "M2", cond) for cond in ("C0", "C1", "C2"))
    s_c0, s_c1, s_c2 = (scale_row(d, "M3", cond) for cond in ("C0", "C1", "C2"))
    mem = {cond: scale_row(d, "M2", cond)["decisions_in_memory_p50"] for cond in ("C0", "C1", "C2")}
    result = d["bakeoff"]["result"]["test"]
    bmeta = d["bakeoff"]["meta"]
    n_gold = result["C0"]["bm25"]["n"]
    malay = d["malay"]["results"]
    malay_n = d["malay"]["n"]

    L = []
    add = L.append

    add("<!-- DRAFT. Not part of the build. Written from the result files by make_ch6_draft.py; remove this block and the note at the end before it goes into the report. -->")
    add("")
    add("> **Draft for Chapter 6, not in the report's build.** Every number is read from a result file by `make_ch6_draft.py`, and `test_ch6_draft.py` recomputes the headline figures from the raw predictions.")
    add(">")
    add("> **A decision is needed before this goes in.** The report's objectives and research questions (O1 to O3, RQ1 to RQ3) are about the ledger. MemoriaBench tests a different use of the same decisions, checking live statements. Either (a) add it as a fourth objective and question, which changes Chapter 1, Chapter 3, the evidence map (Table 6.1) and Section 6.7; or (b) keep it as an extension subsection and move its claims to the discussion (Section 6.8). Agree this with the supervisor first.")
    add(">")
    add(f"> **Numbering.** Chapter 6 already uses {existing_tables}, so the tables below are called @@N_TABLES@@ and must be renumbered. A natural place is after Section 6.4.5.")
    add("")
    add("### 6.4.6 Checking live statements against approved decisions (MemoriaBench)")
    add("")
    add(f"Sections 6.4.2 to 6.4.5 test the ledger by asking it questions. The same approved decisions can also be used while a meeting is running: each new statement is checked against them, and the user is warned if it is **outdated** (it repeats something a later decision replaced) or **contradicts** a decision that is still current. This section tests that check on a new benchmark, MemoriaBench. It uses the same language model as the rest of the chapter ({model}, greedy decoding) on the same machine ({meta['machine']['chip']}, {ram} GB). An *alert* is a statement judged OUTDATED or CONTRADICTS; a *false alarm* is an alert on a statement that is neither.")
    add("")
    add(f"**Data.** MemoriaBench has {n} statements from {n_series} AMI series. The five development series (ES2003, ES2011, IS1008, TS3004 and TS3006), on which baseline settings were tuned, and the two incomplete series (IS1002 and IS1005) are left out. In each series the history is meetings a to c: the decisions the annotators wrote down, each tied to the moment in the meeting it rests on. Meeting d is never opened. Twelve statements are made per series, two for each of six classes (Table N1), so each class has {per_class} statements and {alerts} of the {n} are alerts. The tables call a statement a *probe*.")
    add("")
    add(f"No language model writes or labels a statement. The generator is a fixed program (same bytes on every run), and each gold label is true by construction. For OUTDATED this needed one compromise. The annotators almost never recorded a changed decision, so only **{real}** of the {real + synthetic} OUTDATED statements rest on a decision the annotators recorded as replaced (*real*). For the other **{synthetic}** the generator gives an active decision a note \"(replaces X)\", as Memoria's own approval step would, and the statement asserts X (*synthetic*). The model is shown these notes; without them nothing in the memory says that X was ever replaced. Results for OUTDATED are therefore mostly a test of whether a system uses a replacement note it is given, and the {real} real cases are counts, not estimates.")
    add("")
    add("Table N1 The six classes, with one statement of each from series " + EXAMPLE_SERIES)
    add("")
    add("| Class | What the statement does | Alert | Example statement | Cited decision |")
    add("|---|---|---|---|---|")
    meaning = {
        "SUPPORTED_CURRENT": "Restates a decision that is still current",
        "OUTDATED": "Asserts something a later decision replaced",
        "CONTRADICTS": "Asserts the opposite of a current decision",
        "UPDATES": "Proposes a feature no decision covers",
        "IRRELEVANT": "Banter and meeting logistics",
        "INSUFFICIENT_EVIDENCE": "Claims a result that no decision can confirm or refute",
    }
    for label in CLASSES:
        row, prov = class_example(d, label)
        text = prov.get("decision_text", "")
        snippet = text if len(text) <= 70 else text[:70].rsplit(" ", 1)[0] + " …"
        note = f" (replaces {prov['replaces']})" if prov.get("replaces") else ""
        cited = f"{row['gold_citation']} {snippet}{note}" if row["gold_citation"] else "none"
        add(f"| {label} | {meaning[label]} | {'yes' if row['expected_alert'] else 'no'} | {row['statement']} | {cited} |")
    add("")
    add(f"Source: `data/memoria_bench.jsonl` and `data/memoria_bench.provenance.jsonl`, made by `generate_bench.py`.")
    add("")
    r1, r2, r3 = rounds
    add(f"**Checks on the labels.** The file was fixed by its SHA-256 hash (`{d['hash'][:8]}…{d['hash'][-4:]}`) before any system ran, and a test regenerates it from the AMI files and compares the bytes. The labels were also audited by blind language-model labellers that saw only a series' decisions (with the notes) and the class definitions, never the gold labels. Round {r1['round']} ({model_name(d['audit']['labellers']['round 1'])}) agreed on {r1['agree']} of {r1['rows']} statements and led to changes in the generator. Round {r2['round']} ({model_name(d['audit']['labellers']['rounds 2 and 3'])}), on the revised file, agreed on {r2['agree']} of {r2['rows']}. Round {r3['round']} re-checked the {r3['rows']} statements of the two series that changed after round {r2['round']} ({r3['agree']} of {r3['rows']}). Both labellers are language models and both were shown the synthetic notes. The audit therefore shows that the labels follow the class definitions; it does not show that a person would agree, or that the statements are hard, because they come from templates.")
    add("")
    add("**Systems.** Every system is given the same statements and the same history of meetings a to c, and never a gold label or a citation (Table N2).")
    add("")
    add("Table N2 The systems compared")
    add("")
    add("| System | What it does |")
    add("|---|---|")
    add("| B0 Closed book | The model gets no memory. A high score on the alert classes would mean that the statements give themselves away, or that the model has seen the AMI meetings. |")
    add("| B1 Embeddings | Cosine similarity (bge-small-en-v1.5) of the statement with each decision. An alert is raised when the highest similarity reaches a threshold τ chosen on the development series. B1b cuts the same similarity into three bands. |")
    add(f"| B2 Transcript RAG | The raw words of meetings a to c, cut into chunks of about {meta['settings']['chunk_words']} words ({meta['settings']['chunk_overlap_words']} words overlap); the {meta['settings']['top_k']} nearest chunks are read by the model. No decision list, no replacement notes. |")
    add("| M2 Full Memoria | The approved decisions with their replacement notes and a short class guide are read by the model, which answers with a class, one sentence and the decision it cites. |")
    add("| A1 M2 without notes | M2 with the \"(replaces X)\" notes removed: it shows what the notes contribute. |")
    add("")
    add("**Results.** Table N3 gives the results on all statements and Table N4 the paired tests of M2 against each other system. Every system answered the same statements, so each test is paired.")
    add("")
    table, notes = export_parts("chapter_6_table_1.md")
    add(f"Table N3 Results on MemoriaBench ({n} statements, {n_series} series)")
    add("")
    L.extend(table)
    add("")
    add(f"Source: `results/table_6_1.csv`, `results/chapter_6_table_1.md`, made by `run_benchmarks.py`, `eval_metrics.py` and `export_thesis_tables.py`. {notes}")
    add("")
    table, notes = export_parts("chapter_6_table_3.md")
    add("Table N4 Paired tests of M2 against each other system")
    add("")
    L.extend(table)
    add("")
    add(f"Source: `results/stat_tests.json`, made by `stat_tests.py`. {notes}")
    add("")
    add(f"Full Memoria reaches a Macro-F1 of {cell(m2, 'macro_f1')} {ci(float(m2['macro_f1_lo']), float(m2['macro_f1_hi']))}. Transcript retrieval reaches {cell(b2, 'macro_f1')} {ci(float(b2['macro_f1_lo']), float(b2['macro_f1_hi']))}, the closed-book control {cell(b0, 'macro_f1')} and the two embedding baselines {cell(d['rows'][('full', 'B1')], 'macro_f1')} and {cell(d['rows'][('full', 'B1b')], 'macro_f1')}. The closed-book score is above chance because the classes UPDATES and IRRELEVANT can be recognised from the wording alone ({pct(float(d['per_class'][('full', 'B0')]['UPDATES']))} and {pct(float(d['per_class'][('full', 'B0')]['IRRELEVANT']))} recall), but it finds almost no alert (recall {cell(b0, 'alert_recall')}), which gives no sign that the model has memorised the meetings.")
    add("")
    add(f"For the warning itself, M2 finds {m2['tp']} of the {alerts} alerts (recall {cell(m2, 'alert_recall')}) and raises {m2['fp']} false alarm among the {non_alerts} statements that are not alerts ({pct(float(m2['false_alarm']), 1)}); its alert precision is {cell(m2, 'alert_precision')}. The embedding baseline B1 finds {b1['tp']} alerts too (recall {cell(b1, 'alert_recall')}) but raises a false alarm on {pct(float(b1['false_alarm']), 1)} of the non-alerts, because a statement that restates a decision is as similar to it as one that contradicts it. Transcript retrieval is quiet ({b2['fp']} false alarms) but finds only {b2['tp']} of {alerts} alerts (recall {cell(b2, 'alert_recall')}): given raw passages, the model does not know which of two statements about the same thing is the later one.")
    add("")
    add(f"The paired tests agree. M2 is right on {st_b2['mcnemar_alert']['only_first']} alert decisions where transcript retrieval is wrong, and wrong on {st_b2['mcnemar_alert']['only_second']} where it is right (exact McNemar p = {sci(st_b2['mcnemar_alert']['exact_p'])}); M2 is better in {st_b2['series_sign_alert']['first_better']} of the {n_series} series and worse in {st_b2['series_sign_alert']['second_better']} (sign test p = {sci(st_b2['series_sign_alert']['exact_p'])}); the Macro-F1 gain is {signed(st_b2['paired_bootstrap']['macro_f1'][0], 2)} {dci(st_b2['paired_bootstrap']['macro_f1'][1], st_b2['paired_bootstrap']['macro_f1'][2], 2)} and the permutation test over series gives {p_text(st_b2['permutation_series']['p'])}. One difference is **not** significant: M2 raises {m2['fp']} false alarm and B2 {b2['fp']}, which is too few to separate (p = {st_b2['mcnemar_false_alarms']['exact_p']:.3f}). The claim is that M2 finds far more of the alerts at a false-alarm rate that is no worse, not that it raises fewer false alarms than retrieval.")
    add("")
    table, notes = export_parts("chapter_6_table_2.md")
    add(f"Table N5 Recall by gold class on MemoriaBench ({n} statements)")
    add("")
    L.extend(table)
    add("")
    add(f"Source: `results/per_class.csv`, `results/chapter_6_table_2.md`. {notes}")
    add("")
    add(f"**What the replacement notes do.** Without them (A1) the recall for OUTDATED falls from {pct(float(pcm['OUTDATED']), 1)} to {pct(float(pca['OUTDATED']), 1)}, while the other classes hardly move (Table N5), and Macro-F1 falls from {cell(m2, 'macro_f1')} to {cell(a1, 'macro_f1')}. This shows that M2 uses a note it is given. It does not show that a model can find a replaced decision unaided, and it does not show that Memoria's approval step will write such notes as well as the generator did: that step is tested in Section 6.4.5. Of the {real} real replacements M2 finds {round(float(pcm['OUT-real']) * real)}, and of the {synthetic} synthetic ones {round(float(pcm['OUT-syn']) * synthetic)}.")
    add("")
    table, notes = export_parts("chapter_6_table_1b.md")
    add(f"**The five official test series.** Table N6 repeats the comparison on the {sub_n} statements of the five AMI test series (ES2004, ES2014, IS1009, TS3003 and TS3007), the series the earlier sections of this chapter also use. With {sub_n} statements no interval is meaningful, and the ranking of the systems is the same as on all {n}. M2 reaches Macro-F1 {cell(sub, 'macro_f1')}, alert recall {cell(sub, 'alert_recall')} and alert precision {cell(sub, 'alert_precision')}.")
    add("")
    add(f"Table N6 Results on the five official AMI test series ({sub_n} statements)")
    add("")
    L.extend(table)
    add("")
    add(f"Source: `results/table_6_1.csv`, `results/chapter_6_table_1b.md`. {notes}")
    add("")
    add(f"**Time and memory.** In this run M2 took a median of {secs(float(m2['p50_ms']))} per statement (95th percentile {secs(float(m2['p95_ms']))}), warm, with a peak footprint of {float(m2['peak_gb']):.1f} GB. The embedding baseline took {float(b1['p50_ms']):.0f} ms. The report sets no speed target (requirement NFR10), so these are measurements, not a pass against a target. They also vary with what else the machine is doing: the same M2 check on the same statements took a median of {secs(float(k_c0['p50_ms']))} in a second full run, and {secs(paired['C0']['p50_ms']['M2'])} in a third, shorter run ({paired['C0']['probes']} statements) that alternated with M3, so one run should be read to about a factor of two.")
    add("")
    add("#### Growing memory and topic scoping")
    add("")
    add(f"MemoriaBench gives the auditor only the {mem['C0']:.0f} or so decisions of one series. A real memory grows with every meeting, and a full-memory prompt grows with it. A natural remedy is *topic scoping*: show the model only the decisions about the statement's topic. Two questions were asked: does the check get worse as the memory grows, and does a scoped version, M3, prevent that without losing alerts? The plan, the thresholds and the tests were written and hashed before the first test run (`results/scoping/preregistration.json`, written {d['prereg']['written']}).")
    add("")
    add(f"M3 shows the model the {k} decisions nearest to the statement by embedding similarity (bge-small), plus up to {extra} decisions about money or dates when the statement mentions them. The scope size {k} is the smallest from {k_low} to {k_high} whose scope held the gold decision for at least {pct(k_floor)} of the development statements that have one ({dev_found} of {dev_n}). The memory was enlarged with decisions of other series: C0 is the series' own memory ({mem['C0']:.0f} decisions, median), C1 adds {conds['C1']} decisions of other series ({mem['C1']:.0f}) and C2 adds up to {conds['C2']} ({mem['C2']:.0f}). The added decisions were filtered by fixed rules so that none shares a key word with the series' decisions or statements; the gold labels therefore stay valid, which a blind audit with the largest memory confirmed ({audit_scope['agree']} of {audit_scope['labelled']} agreed, and none used an added decision). A memory of every other series' decisions, unfiltered, could not be kept label-safe and was not used for the language-model runs.")
    add("")
    add(f"Table N7 Full memory (M2) and scoped memory (M3) as the memory grows ({n} statements)")
    add("")
    add("| Memory | System | Decisions read (median) | Prompt tokens (median) | Macro-F1 [95% CI] | Alert recall | False alarms | Median time, batch run (s) |")
    add("|---|---|--:|--:|--:|--:|--:|--:|")
    for cond in ("C0", "C1", "C2"):
        for system in ("M2", "M3"):
            row = scale_row(d, system, cond)
            add(f"| {cond} ({mem[cond]:.0f}) | {system} | {row['scope_p50'] if system == 'M3' else row['decisions_in_memory_p50']:.0f} | {row['prompt_tokens_p50']:.0f} | {row['macro_f1']:.2f} {ci(row['macro_f1_lo'], row['macro_f1_hi'])} | {row['alert_recall']:.2f} | {row['false_alarms']} | {row['p50_ms'] / 1000:.2f} |")
    add("")
    add(f"Source: `results/scoping/scoping_table.csv`, `scoping_results.json`, made by `run_scoping.py` and `scoping_report.py`. The times come from one long batch run in which the machine was also busy with other work, so they are rough; the cleaner comparison is the interleaved one in the text.")
    add("")
    add(f"**The full memory degrades as it grows.** M2's Macro-F1 falls from {k_c0['macro_f1']:.2f} with {mem['C0']:.0f} decisions to {k_c1['macro_f1']:.2f} with {mem['C1']:.0f} and {k_c2['macro_f1']:.2f} with {mem['C2']:.0f}: {signed(verdicts['E4_degrade_C1']['delta'])} {dci(verdicts['E4_degrade_C1']['lo'], verdicts['E4_degrade_C1']['hi'])} and {signed(verdicts['E4_degrade_C2']['delta'])} {dci(verdicts['E4_degrade_C2']['lo'], verdicts['E4_degrade_C2']['hi'])} in a paired bootstrap, both wholly below zero. Alert recall falls from {k_c0['alert_recall']:.2f} to {k_c1['alert_recall']:.2f} and {k_c2['alert_recall']:.2f}, while false alarms stay at {k_c0['false_alarms']}, {k_c1['false_alarms']} and {k_c2['false_alarms']}. Of the {movement['changed']} statements whose answer changed between C0 and C2, {movement['became_wrong']} became wrong and {movement['became_right']} became right. Of those that became wrong, {mv['swap']} were an alert given the other alert class (OUTDATED for CONTRADICTS or the reverse), {mv['lost']} were alerts that were no longer flagged, and {mv['other']} were statements that are not alerts, given another class that is not an alert. The recall for OUTDATED falls from {pct(d['post']['class_recall']['M2@C0']['OUTDATED'])} to {pct(d['post']['class_recall']['M2@C2']['OUTDATED'])} and for CONTRADICTS from {pct(d['post']['class_recall']['M2@C0']['CONTRADICTS'])} to {pct(d['post']['class_recall']['M2@C2']['CONTRADICTS'])}. The prompt grows from {k_c0['prompt_tokens_p50']:.0f} to {k_c2['prompt_tokens_p50']:.0f} tokens, and the model also gets slower: interleaved on {paired['C0']['probes']} statements, M2 took a median of {secs(paired['C0']['p50_ms']['M2'])} at C0 and {secs(paired['C2']['p50_ms']['M2'])} at C2, with a 95th percentile of {secs(paired['C2']['p95_ms']['M2'])} at C2.")
    add("")
    add(f"**Scoping is faster but loses alerts.** The preregistered test of accuracy passes: at C0 the Macro-F1 of M3 differs from M2 by {signed(verdicts['E1']['delta'])} {dci(verdicts['E1']['lo'], verdicts['E1']['hi'])}, and the lower bound is above the margin of {MINUS}{abs(margin):.2f}. The alert recall does not hold: it is {s_c0['alert_recall']:.2f} against {k_c0['alert_recall']:.2f} at C0 ({signed(c['M3@C0 vs M2@C0']['bootstrap']['alert_recall'][0])} {dci(c['M3@C0 vs M2@C0']['bootstrap']['alert_recall'][1], c['M3@C0 vs M2@C0']['bootstrap']['alert_recall'][2])}; M3 right and M2 wrong on {c['M3@C0 vs M2@C0']['mcnemar_alert']['only_first']} alert decisions, the reverse on {c['M3@C0 vs M2@C0']['mcnemar_alert']['only_second']}; exact McNemar p = {c['M3@C0 vs M2@C0']['mcnemar_alert']['exact_p']:.3f}), and {s_c1['alert_recall']:.2f} and {s_c2['alert_recall']:.2f} against {k_c1['alert_recall']:.2f} and {k_c2['alert_recall']:.2f} at C1 and C2. Scoping does not repair the degradation of the full memory either: the Macro-F1 of M3 minus that of M2 is {signed(verdicts['E4_help_C1']['delta'])} {dci(verdicts['E4_help_C1']['lo'], verdicts['E4_help_C1']['hi'])} at C1 and {signed(verdicts['E4_help_C2']['delta'])} {dci(verdicts['E4_help_C2']['lo'], verdicts['E4_help_C2']['hi'])} at C2, so there is no evidence that it helps. The reason is the scope, not the model: the decision a statement was about was inside the scope for {pct(scope_recall['C0']['recall'])} of the {scope_recall['C0']['n']} statements that have one at C0, {pct(scope_recall['C1']['recall'])} at C1 and {pct(scope_recall['C2']['recall'])} at C2, and of the M3 answers that were wrong although a gold decision existed, the gold decision lay outside the scope in {attribution['M3@C0']['gold_outside_scope']} of {attribution['M3@C0']['wrong_with_gold_decision']} at C0, {attribution['M3@C1']['gold_outside_scope']} of {attribution['M3@C1']['wrong_with_gold_decision']} at C1 and {attribution['M3@C2']['gold_outside_scope']} of {attribution['M3@C2']['wrong_with_gold_decision']} at C2.")
    add("")
    add(f"What scoping does buy is time. Interleaved with M2 on the same {paired['C0']['probes']} statements, M3 took a median of {secs(paired['C0']['p50_ms']['M3'])} against {secs(paired['C0']['p50_ms']['M2'])} at C0 (ratio {paired['C0']['ratio_of_medians']['ratio']:.2f} {ci(paired['C0']['ratio_of_medians']['lo'], paired['C0']['ratio_of_medians']['hi'])}, faster on {pct(paired['C0']['share_of_probes_where_m3_was_faster'])} of the statements) and {secs(paired['C2']['p50_ms']['M3'])} against {secs(paired['C2']['p50_ms']['M2'])} at C2 (ratio {paired['C2']['ratio_of_medians']['ratio']:.2f}), because its prompt does not grow. Naming the topic with the language model was measured and rejected for cost: one call took a median of {topic_latency['llm_topic_call_ms']['p50']:.0f} ms ({topic_latency['llm_topic_call_ms']['p95']:.0f} ms at the 95th percentile) against {topic_latency['embedding_step_ms']['p50']:.0f} ms for the embedding step.")
    add("")
    add("#### Can a better retriever make the scope safe?")
    add("")
    add(f"Because the scope, not the model, lost the alerts, the retriever was examined on its own, without any language model. For the {n_gold} statements that have a gold decision the question is whether that decision is among the {d['bakeoff']['rule']['k']} highest-ranked ones. The rule was written before any embedding was computed: a retriever is *recall-safe* if it reaches {pct(d['bakeoff']['rule']['recall'])} at k = {d['bakeoff']['rule']['k']} on the test series in C2 and in C3 (the series' own decisions plus all the other series' decisions, unfiltered), and only a recall-safe retriever would justify another language-model run. Table N8 gives the main candidates: bge-small (what M3 used), EmbeddingGemma 2 (an open multilingual embedder, run through MLX at several precisions), BM25, and a fusion of dense and BM25 rankings.")
    add("")
    add(f"Table N8 Share of the {n_gold} statements with a gold decision whose decision is among the {d['bakeoff']['rule']['k']} highest-ranked (test series)")
    add("")
    add("| Retriever | C0 | C1 | C2 | C3 (unfiltered) | Time per statement | Memory |")
    add("|---|--:|--:|--:|--:|--:|--:|")
    rows8 = [
        ("bge-small, dense", "bge-small dense", "bge-small"),
        ("bge-small + BM25", "bge-small hybrid", "bge-small"),
        ("BM25", "bm25", None),
        ("EmbeddingGemma 2, bf16, dense", "eg2-bf16-asym@768 dense", "eg2-bf16-asym"),
        ("EmbeddingGemma 2, 5-bit, dense", "eg2-5bit-asym@768 dense", "eg2-5bit-asym"),
        ("EmbeddingGemma 2, 5-bit + BM25", "eg2-5bit-asym@768 hybrid", "eg2-5bit-asym"),
    ]
    for label, key, meta_key in rows8:
        vals = " | ".join(pct(result[cond][key]["found"][str(d["bakeoff"]["rule"]["k"])] / n_gold) for cond in ("C0", "C1", "C2", "C3"))
        if meta_key is None:
            speed, memory = f"{d['bakeoff']['bm25_ms']['C3']['p50_ms']:.2f} ms", "no model"
        else:
            bm = bmeta[meta_key]
            speed = f"{bm['p50_ms']:.1f} ms"
            memory = f"{bm['mlx_peak_gb']:.2f} GB (Metal)" if "mlx_peak_gb" in bm else f"{bm['peak_rss_gb']:.2f} GB (CPU)"
        add(f"| {label} | {vals} | {speed} | {memory} |")
    add("")
    best_c2 = max(v["found"]["8"] for v in result["C2"].values())
    best_c3 = max(v["found"]["8"] for v in result["C3"].values())
    eg_c2 = max(v["found"]["8"] for name, v in result["C2"].items() if name.startswith("eg2") and name.endswith("dense"))
    bge_c2 = result["C2"]["bge-small dense"]["found"]["8"]
    add(f"Source: `results/scoping/bakeoff/bakeoff_results.json`, made by `retriever_bakeoff.py` and `embed_texts.py`. BM25 does well in C1 and C2 because the added decisions were chosen to share no word with the statements; C3 is the fair lexical test. For the combined rows the time is that of the dense step; BM25 adds about {d['bakeoff']['bm25_ms']['C3']['p50_ms']:.1f} ms. C3 is a stress test, not a realistic memory: it holds the decisions of the other {n_series - 1} groups that designed the same product.")
    add("")
    add(f"**No retriever is recall-safe.** The best of the {len(result['C2'])} variants tried reaches {pct(best_c2 / n_gold)} in C2 and {pct(best_c3 / n_gold)} in C3, below the {pct(d['bakeoff']['rule']['recall'])} that was required, so no further language-model run was made and similarity scoping is not safe on this benchmark. EmbeddingGemma 2 is a better dense retriever than bge-small (best dense variant {pct(eg_c2 / n_gold)} against {pct(bge_c2 / n_gold)} in C2), and its 5-bit conversion is as good as the 16-bit one at about {bmeta['eg2-5bit-asym']['mlx_peak_gb']:.1f} GB of Metal memory, but adding BM25 helps more than changing the embedder, and the gain does not reach the rule. A likely reason (not tested) is that nearly all the decisions share one template (\"The remote will …\"), so embedding similarity says little about the topic.")
    add("")
    mk = lambda lang, system, cond, kk: malay[f"{system} | {cond} | {lang}"][str(kk)] / malay_n
    add(f"**Malay.** Because users in Malaysia often speak Malay or mix it with English, {malay_n} of the statements with a gold decision were also written in Malay and in mixed Malay and English (by the AI assistant, not reviewed by a second Malay speaker, so this is a small sample and not a benchmark) and searched against the English decisions with dense retrieval. With the series' own memory (C0) the gold decision is among the four nearest for {pct(mk('Malay', 'bge-small', 'C0', 4))} of Malay statements with bge-small and {pct(mk('Malay', 'eg2-5bit', 'C0', 4))} with EmbeddingGemma 2 (5-bit); with the larger memory (C2) {pct(mk('Malay', 'bge-small', 'C2', 4))} and {pct(mk('Malay', 'eg2-5bit', 'C2', 4))}. For mixed statements the figures are {pct(mk('Malay-English mixed', 'bge-small', 'C0', 4))} and {pct(mk('Malay-English mixed', 'eg2-5bit', 'C0', 4))} at C0 and {pct(mk('Malay-English mixed', 'bge-small', 'C2', 4))} and {pct(mk('Malay-English mixed', 'eg2-5bit', 'C2', 4))} at C2, and for the English originals {pct(mk('English', 'bge-small', 'C0', 4))} and {pct(mk('English', 'eg2-5bit', 'C0', 4))} at C0. An English-only embedder is therefore a poor choice for Malay input, and the multilingual one is a reasonable choice if Malay is to be supported. Whether the auditing model itself checks Malay statements correctly was not tested.")
    add("")
    add("#### Threats to validity for this section")
    add("")
    add(f"- **Labels.** The statements are made from templates and the labels are true by construction, but they were audited only by two language models, and {synthetic} of the {real + synthetic} OUTDATED statements depend on a replacement note the generator wrote. No person labelled any statement.")
    add("- **Realism.** The statements are clean sentences, not transcribed speech with recognition errors, interruptions or half-finished thoughts, and the history is the annotators' decision summary, not the output of Memoria's own extraction. The result is the accuracy of the check given a correct memory.")
    add(f"- **Memory growth.** The larger memories are made of other series' decisions with every shared word filtered out. A real memory has decisions that touch the same topics, which is harder for the full memory and for any scope. The drop from {k_c0['macro_f1']:.2f} to {k_c2['macro_f1']:.2f} is measured on memories of {mem['C0']:.0f} to {mem['C2']:.0f} decisions and should not be extended past that.")
    add("- **Order of work.** The scale experiment and the retriever test were designed after the main benchmark had been read. Each was fixed in writing before its own test runs, but the choice to run them was not blind. A bug in how the cited decision is read from the model's reply (a citation with a suffix could be read as another id) was found after the scale runs and fixed; the labels and reasons were checked to be unchanged, and the code as it ran is kept (`results/memoria_as_run.py`).")
    add("- **Settings.** One model, one machine, greedy decoding; the thresholds of B1 and the scope size were chosen on five development series. Timing varies by about a factor of two between sessions.")
    add("- **Multiple tests.** The tests in Table N4 are adjusted for the five comparisons (Holm); the tests in the scale experiment are not, and several were run.")
    add("")
    add("#### How to reproduce")
    add("")
    add("```")
    add("python3.11 generate_bench.py --verify && python3.11 validate_bench.py      # the benchmark and its hash")
    add("python3.11 run_benchmarks.py                                               # B0, B1, B2, M2, A1, one model at a time (Memoria.app closed)")
    add("python3.11 eval_metrics.py && python3.11 stat_tests.py && python3.11 export_thesis_tables.py   # Tables N3 to N6")
    add("python3.11 run_scoping.py prepare && python3.11 run_scoping.py tune && python3.11 run_scoping.py freeze")
    add(f"python3.11 run_scoping.py run                                              # six conditions, {run_minutes} minutes of model time in this study")
    add(f"python3.11 scoping_report.py && python3.11 latency_paired.py --condition C0 --probes {paired['C0']['probes']} && python3.11 scoping_posthoc.py   # Table N7 and the text")
    add("python3.11 retriever_bakeoff.py prepare                                    # then embed_texts.py in each embedder's own environment")
    add("python3.11 retriever_bakeoff.py analyse && python3.11 bakeoff_malay.py     # Table N8 and the Malay check")
    add("```")
    add("")
    text = "\n".join(L) + "\n"
    count = len(re.findall(r"^Table N\d+ ", text, flags=re.M))
    return text.replace("@@N_TABLES@@", f"N1 to N{count}")


def main(argv):
    text = build(load())
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(HERE)} ({len(text.split())} words)")
    if "--report" in argv:
        REPORT_COPY.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(OUT, REPORT_COPY)
        print(f"copied to {REPORT_COPY}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
