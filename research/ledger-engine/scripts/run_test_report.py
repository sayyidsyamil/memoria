#!/usr/bin/env python3
"""Run every unittest in tests/ and write the test-case table, a summary and, with --coverage, a coverage report.

    /opt/homebrew/bin/python3.11 scripts/run_test_report.py              # table + summary
    /opt/homebrew/bin/python3.11 scripts/run_test_report.py --coverage   # also results/testing/coverage.txt

Outputs, by default in results/testing/:
    test_case_table.md    the table for report chapters 6.2 and 6.3
    test_case_table.csv   the same rows for a spreadsheet (first seven columns as in the brief, then extras)
    summary.json          counts per file, level, origin and requirement; runtime; code hashes; known defects
    coverage.txt          line coverage per module (only with --coverage)

Nothing in the table is typed in by hand. The ID, requirement, input and expected result of a test come from its
docstring ("TC-ERR-01 | FR4 | Input: ... | Expected: ..."), the actual result is what the test recorded with
self.observe(...), and pass or fail is what unittest reported. Tests written before the table existed have no such
docstring: they get an LEG-... ID, a level inferred from the file name and an expected result derived from the test
name, all marked as inferred.

A test marked @known_defect asserts the correct behaviour of a defect that is still open (results/testing/defect_log.md).
unittest reports it as an "expected failure"; the table shows it as FAIL (known defect DEF-nn) so that nothing is hidden.
The exit status is 0 when there is no unexpected failure, error or unexpected success.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import time
import traceback
import unittest
from collections import Counter, OrderedDict
from datetime import datetime, timezone
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent.parent

# Levels of the tests written before the table existed, inferred from the file name (the brief's rule).
LEGACY_LEVEL = {
    "test_ledger": "unit", "test_durability": "unit", "test_properties": "unit", "test_metrics": "unit",
    "test_select_baselines": "unit",  # not named in the brief: a small helper script, so unit
    "test_pipeline": "integration", "test_router": "integration", "test_padding": "integration",
    "test_workflow": "integration", "test_scaling": "system", "test_scaling_report": "system",
}
LEGACY_PREFIX = {
    "test_ledger": "LEDGER", "test_durability": "DURABILITY", "test_properties": "PROPERTY", "test_metrics": "METRICS",
    "test_select_baselines": "SELECT", "test_pipeline": "PIPELINE", "test_router": "ROUTER", "test_padding": "PADDING",
    "test_workflow": "WORKFLOW", "test_scaling": "SCALING", "test_scaling_report": "SCALEREPORT",
}
HARNESS = "evaluation harness (no FR)"
# Requirement of an older test, inferred from its class name. (file, class) -> requirement
LEGACY_REQUIREMENT = {
    ("test_durability", "TestSchemaGuards"): "FR5", ("test_durability", "TestEventLog"): "NFR-Recoverability, FR5",
    ("test_ledger", "TestSupersession"): "FR5", ("test_ledger", "TestOrdering"): "FR5, FR6",
    ("test_ledger", "TestReconfirm"): "FR5", ("test_ledger", "TestCorrectAndRetract"): "FR5, NFR-Traceability",
    ("test_ledger", "TestSlots"): "FR4, NFR-Robustness",
    ("test_pipeline", "TestDatasetParser"): "FR1, FR2", ("test_pipeline", "TestOracleReproducesTheGold"): "FR4, FR5, FR6",
    ("test_pipeline", "TestGrounding"): "FR3, NFR-Traceability", ("test_pipeline", "TestPipelineRules"): "FR3, FR4, FR5",
    ("test_pipeline", "TestExtractorParsing"): "FR4, NFR-Robustness", ("test_pipeline", "TestKeywordBaseline"): HARNESS,
    ("test_properties", "TestEnvelope"): "FR5, FR6", ("test_properties", "TestAgainstTheOracle"): "FR5, FR6",
    ("test_router", "TestParseRoute"): "FR6", ("test_router", "TestRoutedAnswers"): "FR6", ("test_router", "TestRouterPrompt"): "FR6",
    ("test_workflow", "TestProposals"): "FR5", ("test_workflow", "TestAliases"): "FR4",
    ("test_workflow", "TestClock"): "FR5, NFR-Recoverability",
}
for _file in ("test_metrics", "test_padding", "test_select_baselines"):
    LEGACY_REQUIREMENT[(_file, "*")] = HARNESS
for _file in ("test_scaling", "test_scaling_report"):
    LEGACY_REQUIREMENT[(_file, "*")] = "FR6"

DOC_PIPES = re.compile(r"^\s*(TC-[A-Z]+-\d+)\s*\|\s*(.*)$", re.S)  # TC-ERR-01 | FR4 | Input: ... | Expected: ...
DOC_PARENS = re.compile(r"^\s*(TC-[A-Z]+-\d+)\s*\(([^)]*)\)\s*:\s*(.*)$", re.S)  # TC-SVC-01 (FR3): text
LIMITATION = re.compile(r"^KNOWN LIMITATION \((DEF-L\d+)\):\s*(?:input\s*)?(.*)$", re.S)


# ---- run the suite and record every test ---------------------------------------------------------------------------

def first_line(text, limit=230):
    line = next((ln.strip() for ln in str(text).splitlines() if ln.strip()), "")
    return line if len(line) <= limit else line[: limit - 1] + "…"


def test_level(test):
    method = getattr(test, test._testMethodName, None)
    return getattr(method, "level", None) or getattr(type(test), "level", None)


class Recorder(unittest.TestResult):
    """Keeps one record per test: outcome, time, the message of a failure and whatever the test chose to observe."""

    def __init__(self):
        super().__init__()
        self.records = []
        self._record = None
        self._started = 0.0

    def startTest(self, test):
        super().startTest(test)
        method = getattr(test, test._testMethodName, None)
        self._record = {
            "test": test, "module": type(test).__module__, "class": type(test).__name__, "method": test._testMethodName,
            "doc": test._testMethodDoc, "level": test_level(test), "known_defects": tuple(getattr(method, "known_defects", ())),
            "status": None, "message": "", "subfailures": [],
        }
        self._started = time.perf_counter()

    def stopTest(self, test):
        record = self._record
        record["seconds"] = time.perf_counter() - self._started
        record["observed"] = "; ".join(getattr(test, "observed", []) or [])
        if record["status"] is None:
            record["status"] = "fail" if record["subfailures"] else "pass"
            record["message"] = record["message"] or "; ".join(record["subfailures"][:3])
        record.pop("test")
        self.records.append(record)
        self._record = None
        super().stopTest(test)

    def addSuccess(self, test):
        super().addSuccess(test)
        self._record["status"] = "pass"

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._record.update(status="fail", message=first_line("".join(traceback.format_exception_only(*err[:2]))))

    def addError(self, test, err):
        super().addError(test, err)
        self._record.update(status="error", message=first_line("".join(traceback.format_exception_only(*err[:2]))))

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._record.update(status="skip", message=reason)

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._record.update(status="known_defect", message=first_line("".join(traceback.format_exception_only(*err[:2]))))

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._record["status"] = "unexpected_success"

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            label = subtest._subDescription() if hasattr(subtest, "_subDescription") else "subtest"
            self._record["subfailures"].append(f"{label}: {first_line(''.join(traceback.format_exception_only(*err[:2])), 150)}")


def load_and_run():
    tests_dir = ENGINE_DIR / "tests"
    suite = unittest.defaultTestLoader.discover(str(tests_dir), pattern="test_*.py", top_level_dir=str(tests_dir))
    recorder = Recorder()
    started = time.perf_counter()
    suite.run(recorder)
    return recorder, time.perf_counter() - started


# ---- turn a record into a table row ---------------------------------------------------------------------------------

def sentence(name):
    text = name[5:] if name.startswith("test_") else name
    text = text.replace("_", " ").strip()
    return text[:1].upper() + text[1:]


def camel_words(name):
    words = re.sub(r"(?<!^)(?=[A-Z])", " ", name[4:] if name.startswith("Test") else name).lower()
    return words[:1].upper() + words[1:]


def describe(record, serial):
    """The row for one test: ID, level, requirement, input, expected, plus how each field was obtained."""
    file_stem = record["module"]
    doc = (record["doc"] or "").strip()
    row = {"inferred": [], "note": ""}
    pipes, parens = DOC_PIPES.match(doc), DOC_PARENS.match(doc)
    if pipes:
        parts = [p.strip() for p in pipes.group(2).split(" | ", 2)]
        parts += [""] * (3 - len(parts))
        row.update(id=pipes.group(1), requirement=parts[0], expected=re.sub(r"^Expected:\s*", "", parts[2]))
        data = re.sub(r"^Input:\s*", "", parts[1])
        limitation = LIMITATION.match(data)
        if limitation:
            row["note"] = f"known limitation {limitation.group(1)}: behaviour deliberately kept and pinned down by this test"
            data = limitation.group(2)
        row["input"] = data
        row["origin"] = "error-handling tests (new)"
    elif parens:
        row.update(id=parens.group(1), requirement=parens.group(2), input="scripted extractor and a service folder created by the test",
                   expected=parens.group(3), origin="service tests (added by another session)")
        row["inferred"] = ["level"]
    else:
        prefix = LEGACY_PREFIX.get(file_stem, file_stem.replace("test_", "").upper())
        requirement = LEGACY_REQUIREMENT.get((file_stem, record["class"])) or LEGACY_REQUIREMENT.get((file_stem, "*")) or "unclassified"
        row.update(id=f"LEG-{prefix}-{serial:02d}", requirement=requirement,
                   input=f"fixtures created inside the test ({file_stem}.py, {record['class']})",
                   expected=f"{camel_words(record['class'])}: {sentence(record['method']).lower()}",
                   origin="existing tests (before this work)")
        row["inferred"] = ["requirement", "expected result (from the test name)", "level"]
    level = record["level"]
    if level is None:
        level = LEGACY_LEVEL.get(file_stem) or ("integration" if file_stem == "test_service" else "unit")
    row["level"] = level
    row["test"] = f"{file_stem}.{record['class']}.{record['method']}"
    row["file"] = f"{file_stem}.py"
    row["seconds"] = round(record["seconds"], 4)
    status, message = record["status"], record["message"]
    defects = ", ".join(record["known_defects"])
    if status == "pass":
        row["actual"] = record["observed"] or "as expected (every assertion held)"
        row["result"] = "PASS"
    elif status == "known_defect":
        detail = record["observed"] or message
        row["actual"] = f"defect reproduced: {detail}" if detail else "defect reproduced"
        row["result"] = f"FAIL (known defect {defects})" if defects else "FAIL (expected failure)"
        row["note"] = (row["note"] + "; " if row["note"] else "") + f"known defect {defects or '?'} is open, see defect_log.md"
    elif status == "unexpected_success":
        row["actual"] = "passed although marked as a known defect: the defect is fixed, remove the marker"
        row["result"] = "FAIL (stale known-defect marker)"
    elif status == "skip":
        row["actual"] = f"skipped: {message}"
        row["result"] = "SKIP"
    else:
        row["actual"] = message or "failed"
        row["result"] = "ERROR" if status == "error" else "FAIL"
    row["status"] = status
    row["known_defects"] = list(record["known_defects"])
    return row


def build_rows(records):
    counters = Counter()
    rows = []
    for record in records:
        counters[record["module"]] += 1
        rows.append(describe(record, counters[record["module"]]))
    return rows


# ---- summary --------------------------------------------------------------------------------------------------------

def tally(rows):
    counts = Counter(r["status"] for r in rows)
    return {"tests": len(rows), "passed": counts["pass"], "known_defects": counts["known_defect"],
            "failed": counts["fail"], "errors": counts["error"], "unexpected_successes": counts["unexpected_success"],
            "skipped": counts["skip"], "seconds": round(sum(r["seconds"] for r in rows), 2)}


def grouped(rows, key):
    out = OrderedDict()
    for value in sorted({key(r) for r in rows}):
        out[value] = tally([r for r in rows if key(r) == value])
    return out


def engine_hashes():
    files = sorted(p for p in (ENGINE_DIR / "memoria_engine").rglob("*") if p.is_file() and p.suffix in (".py", ".sql") and "__pycache__" not in p.parts)
    per_file = {str(p.relative_to(ENGINE_DIR)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    combined = hashlib.sha256("".join(f"{k}:{v}\n" for k, v in sorted(per_file.items())).encode()).hexdigest()[:12]
    return per_file, combined


def requirement_counts(rows):
    counts = Counter()
    for r in rows:
        for part in re.split(r",\s*", r["requirement"]):
            part = part.strip()
            if re.match(r"^(FR\d|NFR-[A-Za-z-]+)$", part):
                counts[part] += 1
    return dict(sorted(counts.items()))


def summarise(rows, runtime, label, coverage_percent):
    per_file, combined = engine_hashes()
    by_file = OrderedDict()
    for name in sorted({r["file"] for r in rows}):
        sub = [r for r in rows if r["file"] == name]
        entry = tally(sub)
        entry.update(level=sub[0]["level"] if len({r["level"] for r in sub}) == 1 else "mixed",
                     levels=dict(Counter(r["level"] for r in sub)), origin=sub[0]["origin"])
        by_file[name] = entry
    defects = OrderedDict()
    for r in rows:
        for d in r["known_defects"]:
            defects.setdefault(d, []).append(r["id"])
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "label": label,
        "python": sys.version.split()[0],
        "command": "python3.11 scripts/run_test_report.py" + (" --coverage" if coverage_percent is not None else ""),
        "runtime_seconds": round(runtime, 2),
        "totals": tally(rows),
        "wall_clock_note": "runtime_seconds is the wall-clock time of the whole run; per-test seconds are summed in totals.seconds",
        "by_origin": grouped(rows, lambda r: r["origin"]),
        "by_level": grouped(rows, lambda r: r["level"]),
        "by_file": by_file,
        "by_requirement_mentions": requirement_counts(rows),
        "known_defects": {d: ids for d, ids in defects.items()},
        "inferred_fields_note": "level, requirement and expected result of the 'existing tests' rows are inferred from file, class and test names",
        "slowest_tests": [{"id": r["id"], "seconds": r["seconds"]} for r in sorted(rows, key=lambda r: -r["seconds"])[:8]],
        "duplicate_ids": sorted(i for i, n in Counter(r["id"] for r in rows).items() if n > 1),
        "line_coverage_percent_memoria_engine": coverage_percent,
        "engine_code_hash": combined,
        "engine_file_sha256": per_file,
    }


# ---- output files ---------------------------------------------------------------------------------------------------

def cell(text):
    return re.sub(r"\s+", " ", str(text)).replace("|", "\\|").strip()


def table(rows):
    head = "| ID | Level | Requirement | Test data / input | Expected result | Actual result | Pass/Fail |\n|---|---|---|---|---|---|---|\n"
    return head + "".join(
        f"| {cell(r['id'])} | {r['level']} | {cell(r['requirement'])}{' *' if 'requirement' in r['inferred'] else ''} | {cell(r['input'])} | "
        f"{cell(r['expected'])} | {cell(r['actual'])} | {cell(r['result'])} |\n" for r in rows)


def write_markdown(path, rows, summary):
    totals = summary["totals"]
    new = [r for r in rows if r["origin"].startswith("error-handling")]
    old = [r for r in rows if r["origin"].startswith("existing")]
    svc = [r for r in rows if r["origin"].startswith("service")]
    unhappy = totals["failed"] + totals["errors"] + totals["unexpected_successes"]
    counts = ["| Group | Tests | Passed | Known defects | Failed or errored | Seconds |\n|---|---|---|---|---|---|\n"]
    for title, groups in (("Level", summary["by_level"]), ("Origin", summary["by_origin"])):
        for name, t in groups.items():
            counts.append(f"| {title}: {name} | {t['tests']} | {t['passed']} | {t['known_defects']} | "
                          f"{t['failed'] + t['errors'] + t['unexpected_successes']} | {t['seconds']} |\n")
    counts.append(f"| **All** | {totals['tests']} | {totals['passed']} | {totals['known_defects']} | {unhappy} | {totals['seconds']} |\n")
    blocks = [
        "# Test-case table (generated by scripts/run_test_report.py)\n",
        f"Run on {summary['generated_at']} with Python {summary['python']} ({summary['label']}). Engine code hash {summary['engine_code_hash']}.\n",
        f"**{totals['tests']} tests ran in {summary['runtime_seconds']} s: {totals['passed']} passed, {totals['known_defects']} reproduced a "
        f"known defect (expected failures, see defect_log.md), {totals['failed']} failed, {totals['errors']} errored, "
        f"{totals['unexpected_successes']} unexpected successes, {totals['skipped']} skipped.**\n",
        *([f"Line coverage of memoria_engine: {summary['line_coverage_percent_memoria_engine']}% (see coverage.txt).\n"]
          if summary["line_coverage_percent_memoria_engine"] is not None else []),
        "## Counts\n", "".join(counts),
        "Requirement IDs: FR1 ingest sources, FR2 structured transcripts with speaker and time, FR3 evidence kept separately and cited, "
        "FR4 typed decisions and commitments, FR5 append-only history with supersession, FR6 answer current, as-of and change questions, "
        "NFR-Traceability, NFR-Recoverability, NFR-Robustness, NFR-Privacy-local.\n",
        f"## A. New failure-injection and error-handling tests ({len(new)}; tests/test_error_handling.py)\n",
        "Test data are the canned model replies, transcripts and log files that each test builds (named in the Input column); "
        "no language model, GPU or network is used. \"Actual result\" is what the test observed when it ran. "
        "\"FAIL (known defect ...)\" rows are tests that assert the correct behaviour of a defect that is still open; "
        "unittest reports them as expected failures"
        + ("; results/testing/defect_log.md lists the defects and results/testing/proposed_fixes.patch holds the fixes.\n" if totals["known_defects"] else ".\n"),
        table(new),
        f"## B. Tests that existed before this work ({len(old)})\n",
        "These tests have no docstrings. Level (from the file name), requirement (from the class name) and the expected "
        "result (from the test name) are inferred; rows marked * have an inferred requirement.\n",
        table(old),
    ]
    if svc:
        blocks += [f"## C. Service-layer tests added by another session ({len(svc)}; tests/test_service.py)\n", table(svc)]
    if summary["known_defects"]:
        listing = "| Defect | Tests |\n|---|---|\n" + "".join(f"| {d} | {', '.join(ids)} |\n" for d, ids in sorted(summary["known_defects"].items()))
        blocks += ["## Known defects reproduced by this run\n", listing]
    path.write_text("\n".join(blocks), encoding="utf-8")


def write_csv(path, rows):
    columns = ["ID", "Level", "Requirement", "Test data / input", "Expected result", "Actual result", "Pass/Fail", "Test", "Origin", "Seconds", "Note"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(columns)
        for r in rows:
            requirement = r["requirement"] + (" (inferred)" if "requirement" in r["inferred"] else "")
            note = "; ".join(filter(None, [r["note"], ("inferred: " + ", ".join(r["inferred"])) if r["inferred"] else ""]))
            writer.writerow([r["id"], r["level"], requirement, r["input"], r["expected"], r["actual"], r["result"],
                             r["test"], r["origin"], r["seconds"], note])


# ---- coverage -------------------------------------------------------------------------------------------------------

GROUPS = (
    ("core engine", ("memoria_engine/__init__.py", "memoria_engine/envelope.py", "memoria_engine/ledger.py",
                     "memoria_engine/pipeline.py", "memoria_engine/extractors.py")),
    ("support (service, demo, cache, windowing)", ("memoria_engine/service.py", "memoria_engine/demo.py",
                                                   "memoria_engine/llmcache.py", "memoria_engine/windowed.py")),
)


def coverage_report(cov, path, n_tests, runtime):
    lines = []
    totals = {}
    for file in sorted((ENGINE_DIR / "memoria_engine").rglob("*.py")):
        if "__pycache__" in file.parts:
            continue
        _name, statements, _excluded, missing, formatted = cov.analysis2(str(file))
        totals[str(file.relative_to(ENGINE_DIR))] = (len(statements), len(missing), formatted)

    def pct(stmts, miss):
        return 100.0 if stmts == 0 else 100.0 * (stmts - miss) / stmts

    def block(title, names):
        stmts = sum(totals[n][0] for n in names)
        miss = sum(totals[n][1] for n in names)
        return f"{title:46s} {stmts:6d} {miss:6d} {pct(stmts, miss):7.1f}%", pct(stmts, miss)

    core = [n for g, names in GROUPS[:1] for n in names]
    support = [n for g, names in GROUPS[1:] for n in names]
    evaluation = sorted(n for n in totals if n.startswith("memoria_engine/evaluation/"))
    everything = sorted(totals)
    lines += [
        "Line coverage of memoria_engine, measured with coverage.py " + __import__("coverage").__version__
        + f" while running the whole test suite ({n_tests} tests, {runtime:.1f} s with the tracer switched on).",
        f"Command: python3.11 scripts/run_test_report.py --coverage    Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "Line coverage only (a statement counts as covered if it ran at least once); branches are not measured.",
        "Not measured: the child processes started by the crash test (their lines are exercised by other tests too).",
        "Not run on purpose: the model-loading and generation path of MLXExtractor (no language model or GPU is used in any test).",
        "", f"{'Module':46s} {'Stmts':>6s} {'Miss':>6s} {'Cover':>8s}", "-" * 70,
    ]
    for name in sorted(totals):
        stmts, miss, _ = totals[name]
        lines.append(f"{name:46s} {stmts:6d} {miss:6d} {pct(stmts, miss):7.1f}%")
    lines += ["-" * 70]
    summary_lines = {}
    for title, names in (("core engine (ledger, envelope, pipeline, extractors)", core),
                         ("support (service, demo, llmcache, windowed)", support),
                         ("evaluation scripts (memoria_engine/evaluation)", evaluation),
                         ("ALL of memoria_engine", everything)):
        text, value = block(title, names)
        lines.append(text)
        summary_lines[title] = round(value, 1)
    lines += ["", "Lines not executed in the core engine (line numbers):"]
    for name in core:
        stmts, miss, formatted = totals[name]
        if miss:
            lines.append(f"  {name}: {formatted}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return summary_lines


# ---- main -----------------------------------------------------------------------------------------------------------

def measure_coverage(outdir):
    """Runs the whole suite under coverage.py in this (fresh) interpreter and writes coverage.txt."""
    import coverage  # started before memoria_engine is imported, so import-time lines count too
    cov = coverage.Coverage(data_file=None, source=[str(ENGINE_DIR / "memoria_engine")])
    cov.start()
    recorder, runtime = load_and_run()
    cov.stop()
    return coverage_report(cov, outdir / "coverage.txt", len(recorder.records), runtime)


def coverage_in_fresh_process(outdir):
    """The timed run above has already imported memoria_engine, so coverage is measured by a second, fresh process."""
    import subprocess
    done = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--measure-coverage", "--outdir", str(outdir)],
                          capture_output=True, text=True, cwd=str(ENGINE_DIR))
    marker = [line for line in done.stdout.splitlines() if line.startswith("COVERAGE_JSON ")]
    if done.returncode or not marker:
        sys.exit(f"coverage run failed (exit {done.returncode}): {(done.stderr or done.stdout)[-600:]}")
    return json.loads(marker[-1][len("COVERAGE_JSON "):])


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--outdir", default=str(ENGINE_DIR / "results" / "testing"), help="where the files are written")
    parser.add_argument("--coverage", action="store_true",
                        help="also measure line coverage of memoria_engine (runs the suite a second time under coverage.py)")
    parser.add_argument("--label", default="live engine tree", help="free text printed in the table header")
    parser.add_argument("--measure-coverage", action="store_true", help=argparse.SUPPRESS)  # internal: the child process of --coverage
    args = parser.parse_args()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    os.chdir(ENGINE_DIR)
    sys.path[:0] = [str(ENGINE_DIR), str(ENGINE_DIR / "tests")]
    if args.measure_coverage:
        print("COVERAGE_JSON " + json.dumps(measure_coverage(outdir)))
        return 0

    recorder, runtime = load_and_run()
    rows = build_rows(recorder.records)
    rows.sort(key=lambda r: (not r["id"].startswith("TC-ERR"), r["id"]))
    coverage_summary = coverage_in_fresh_process(outdir) if args.coverage else None
    summary = summarise(rows, runtime, args.label, coverage_summary["ALL of memoria_engine"] if coverage_summary else None)
    if coverage_summary:
        summary["line_coverage_percent_by_group"] = coverage_summary
    write_markdown(outdir / "test_case_table.md", rows, summary)
    write_csv(outdir / "test_case_table.csv", rows)
    (outdir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    t = summary["totals"]
    print(f"{t['tests']} tests in {summary['runtime_seconds']} s: {t['passed']} passed, {t['known_defects']} known defects, "
          f"{t['failed']} failed, {t['errors']} errors, {t['unexpected_successes']} unexpected successes, {t['skipped']} skipped")
    for name, g in summary["by_level"].items():
        print(f"  {name:12s} {g['tests']:4d} tests, {g['passed']:4d} passed, {g['known_defects']:3d} known defects")
    if coverage_summary:
        print("  line coverage:", coverage_summary)
    print("wrote", outdir)
    return 0 if not (t["failed"] or t["errors"] or t["unexpected_successes"]) else 1


if __name__ == "__main__":
    sys.exit(main())
