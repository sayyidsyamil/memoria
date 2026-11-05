"""Validate data/memoria_bench.jsonl, and freeze it.

Run: python3.11 validate_bench.py [--refreeze]

The checks, in the order they are printed:
    the 336 rows (28 series x 12), 56 per class, two per class per series, unique ids, the strict six-field schema;
    alerts: every OUTDATED and CONTRADICTS row is an alert and cites a decision, every other row is silent;
    citations: each one is a real decision of that series' meetings a-c in the AMI corpus (never meeting d), and
    the replaced decisions of a real supersession are never cited as if they were current;
    the provenance file describes every row, and each OUTDATED row has the "(replaces ...)" note that
    generate_bench.memory_text() will show an auditor.

Freezing: the SHA-256 of the dataset and of its provenance are written to data/memoria_bench.sha256 the first time
this passes. After that, any change to either file fails the run until you say --refreeze, so that an evaluation
can never be run against a benchmark that moved.
"""

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from functools import lru_cache
from pathlib import Path

from generate_bench import (ALERTS, BENCH_FILE, CLASSES, CODES, FIELDS, HASH_FILE, HERE, PER_CLASS, PROVENANCE_FILE, memory_text)
from ami_loader import Series, test_series

SERIES_COUNT = 28
PER_SERIES = PER_CLASS * len(CLASSES)
TOTAL = SERIES_COUNT * PER_SERIES
PER_CLASS_TOTAL = SERIES_COUNT * PER_CLASS
CITATION = re.compile(r"^\[((?:ES|IS|TS)\d{4})([abc]):(\d{2}):(\d{2})(?:#(\d+))?\]$")
IDENT = re.compile(r"^((?:ES|IS|TS)\d{4})-([SOCUIE])-(\d{2})$")
REAL, SYNTHETIC = "real-supersession", "synthetic-supersession"
STOP = frozenset("""the a an to of and or in on for will be is are it that this with as at by from have has we our us you your they their
there what about could should would can into over after before when which while than then also just very much more most some any each
every other another these those been being were was had does did done make made let's lets add adding added include includes
including remote remotes button buttons device team product design""".split())


@lru_cache(maxsize=1)
def corpus_history() -> dict[str, list]:
    """{series: its decisions with evidence}, read from the AMI corpus, meetings a-c only; also proves that no
    file about meeting d was opened to get them."""
    history = {}
    for name in test_series():
        series = Series(name, history_only=True)
        leaked = [m for m in series.memory_reads if re.search(rf"{name}d\b", m)]
        if leaked or series.live_reads:
            raise RuntimeError(f"{name}: meeting d was opened: {leaked or series.live_reads}")
        history[name] = list(series.decisions)
    return history


def read_lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def seconds(citation: str) -> tuple[str, int]:
    meeting, minutes, rest = citation.split("#")[0].split(":")
    return meeting[-1], int(minutes) * 60 + int(rest)


def check(rows: list[dict], provenance: list[dict], history: dict[str, list]) -> tuple[list[str], list[str], dict]:
    """(failures, warnings, facts about the dataset). Nothing here raises on bad data: every problem is a line."""
    failures: list[str] = []
    warnings: list[str] = []
    facts: dict = {}

    def fail(message: str) -> None:
        failures.append(message)

    # --- the six fields
    schema_ok = True
    for n, row in enumerate(rows, 1):
        if not isinstance(row, dict) or tuple(row) != FIELDS:
            fail(f"row {n}: fields are {list(row) if isinstance(row, dict) else type(row).__name__}, not exactly {list(FIELDS)} in order")
            schema_ok = False
            continue
        types_ok = all(isinstance(row[k], str) for k in ("id", "series_id", "statement", "gold_label")) \
            and (row["gold_citation"] is None or isinstance(row["gold_citation"], str)) and isinstance(row["expected_alert"], bool)
        if not types_ok:
            fail(f"{row.get('id', n)}: a field has the wrong type")
            schema_ok = False
    if not schema_ok:
        return failures, warnings, facts
    facts["rows"] = len(rows)

    # --- size and balance
    if len(rows) != TOTAL:
        fail(f"Total rows must equal exactly {TOTAL} ({SERIES_COUNT} series x {PER_SERIES}); there are {len(rows)}")
    unknown = sorted({r["gold_label"] for r in rows} - set(CLASSES))
    if unknown:
        fail(f"unknown gold_label values: {unknown}")
    by_class = Counter(r["gold_label"] for r in rows)
    facts["by_class"] = {label: by_class.get(label, 0) for label in CLASSES}
    for label in CLASSES:
        if by_class.get(label, 0) != PER_CLASS_TOTAL:
            fail(f"{label} has {by_class.get(label, 0)} rows, not exactly {PER_CLASS_TOTAL}")
    expected_series = set(history)
    if len(expected_series) != SERIES_COUNT:
        fail(f"the corpus gives {len(expected_series)} test series, not {SERIES_COUNT}")
    if {r["series_id"] for r in rows} != expected_series:
        fail(f"series in the dataset differ from the corpus' test series: {sorted({r['series_id'] for r in rows} ^ expected_series)}")
    grid = Counter((r["series_id"], r["gold_label"]) for r in rows)
    for series in sorted(expected_series):
        for label in CLASSES:
            if grid[(series, label)] != PER_CLASS:
                fail(f"{series} has {grid[(series, label)]} {label} rows, not {PER_CLASS}")

    # --- ids
    ids = Counter(r["id"] for r in rows)
    for identifier, count in ids.items():
        if count > 1:
            fail(f"duplicate id {identifier} ({count} rows)")
    for r in rows:
        match = IDENT.match(r["id"])
        if not match or match.group(1) != r["series_id"] or CODES.get(r["gold_label"]) != match.group(2) or match.group(3) not in {f"{n:02d}" for n in range(1, PER_CLASS + 1)}:
            fail(f"{r['id']}: id does not match its series_id {r['series_id']} and class {r['gold_label']}")

    # --- alerts
    for r in rows:
        should = r["gold_label"] in ALERTS
        if r["expected_alert"] is not should:
            fail(f"{r['id']}: expected_alert is {r['expected_alert']} for {r['gold_label']}")
    alerts = [r for r in rows if r["gold_label"] in ALERTS]
    facts["alerts"] = len(alerts)
    facts["silent"] = len(rows) - len(alerts)

    # --- citations
    known = {name: {d.citation: d for d in decisions} for name, decisions in history.items()}
    must_cite = set(ALERTS) | {"SUPPORTED_CURRENT"}
    valid_alert_citations = 0
    for r in rows:
        citation = r["gold_citation"]
        label = r["gold_label"]
        if label in must_cite and citation is None:
            fail(f"{r['id']}: {label} must cite a decision")
            continue
        if label not in must_cite:
            if citation is not None:
                fail(f"{r['id']}: {label} must not cite anything")
            continue
        match = CITATION.match(citation)
        if not match or match.group(1) != r["series_id"]:
            fail(f"{r['id']}: citation {citation!r} is not [{r['series_id']}a-c:MM:SS]")
            continue
        if match.group(0)[1:-1] not in known.get(r["series_id"], {}):
            fail(f"{r['id']}: {citation} is not a decision of {r['series_id']} meetings a-c")
            continue
        if label in ALERTS:
            valid_alert_citations += 1
    facts["valid_alert_citations"] = valid_alert_citations

    # --- the statements
    seen: dict[tuple[str, str], str] = {}
    across: dict[str, set[str]] = {}
    for r in rows:
        text = r["statement"]
        if not text.strip() or "\n" in text or len(text) > 240 or not text[0].isupper() or not text.endswith((".", "?", "!")) or "  " in text:
            fail(f"{r['id']}: statement is not a clean single sentence: {text!r}")
        key = (r["series_id"], re.sub(r"[^a-z0-9 ]", "", text.lower()))
        if key in seen:
            fail(f"{r['id']} repeats the statement of {seen[key]}: {text!r}")
        seen[key] = r["id"]
        across.setdefault(re.sub(r"[^a-z0-9 ]", "", text.lower()), set()).add(r["series_id"])
    facts["statements_in_several_series"] = sum(1 for v in across.values() if len(v) > 1)

    # --- provenance
    by_id = {p.get("id"): p for p in provenance}
    if len(provenance) != len(rows) or set(by_id) != {r["id"] for r in rows}:
        fail(f"the provenance file does not describe exactly the {len(rows)} rows of the dataset")
    dropped: dict[str, set[str]] = {}
    replaced: dict[str, dict[str, list[str]]] = {}
    basis = Counter()
    for r in rows:
        p = by_id.get(r["id"])
        if p is None:
            continue
        if r["gold_label"] == "OUTDATED":
            basis[p.get("basis")] += 1
            if p.get("basis") not in (REAL, SYNTHETIC) or not p.get("replaces") or r["gold_citation"] != f"[{p.get('decision')}]":
                fail(f"{r['id']}: OUTDATED needs a basis, a 'replaces' note and the replacing decision it cites: {p}")
                continue
            replaced.setdefault(r["series_id"], {}).setdefault(p["decision"], []).append(p["replaces"])
            if p["basis"] == REAL:
                old = p.get("old_decision")
                if old not in known.get(r["series_id"], {}) or seconds(old) >= seconds(p["decision"]):
                    fail(f"{r['id']}: the replaced decision {old} must be a real decision of the series, earlier than {p['decision']}")
                else:
                    dropped.setdefault(r["series_id"], set()).add(old)
        elif r["gold_label"] in ("SUPPORTED_CURRENT", "CONTRADICTS") and r["gold_citation"] != f"[{p.get('decision')}]":
            fail(f"{r['id']}: provenance names {p.get('decision')} but the row cites {r['gold_citation']}")
    facts["outdated_basis"] = dict(basis)
    for r in rows:
        if r["gold_label"] in must_cite and r["gold_citation"] and r["gold_citation"][1:-1] in dropped.get(r["series_id"], set()):
            fail(f"{r['id']} cites {r['gold_citation']}, a decision that a real supersession replaced")

    # --- what an auditor will read
    for series, decisions in history.items():
        text = memory_text(decisions, replaced.get(series, {}), sorted(dropped.get(series, set())))
        for r in rows:
            if r["series_id"] != series or r["gold_label"] not in must_cite or not r["gold_citation"]:
                continue
            line = next((l for l in text.splitlines() if l.startswith(f"- {r['gold_citation']} ")), None)
            if line is None:
                fail(f"{r['id']}: {r['gold_citation']} is not in the memory an auditor reads for {series}")
            elif r["gold_label"] == "OUTDATED" and by_id.get(r["id"]) and f"(replaces " not in line:
                fail(f"{r['id']}: the memory line for {r['gold_citation']} has no '(replaces ...)' note")

    # --- items that should be about no decision, but share a distinctive word with one (read these by hand)
    def words(text: str) -> set[str]:
        return {w for w in re.findall(r"[a-z]{5,}", text.lower()) if w not in STOP}

    for r in rows:
        if r["gold_label"] in ("UPDATES", "INSUFFICIENT_EVIDENCE"):
            shared = words(re.sub(r"^(?:So|Right|Okay|Well|I think),? ", "", r["statement"])) & words(" ".join(d.text for d in history.get(r["series_id"], [])))
            if shared:
                warnings.append(f"{r['id']} shares {sorted(shared)} with a decision of its series: {r['statement']}")
    return failures, warnings, facts


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def freeze(refreeze: bool) -> tuple[str, str | None]:
    """(the dataset hash, None or why the freeze is broken)."""
    current = {BENCH_FILE.name: sha256(BENCH_FILE), PROVENANCE_FILE.name: sha256(PROVENANCE_FILE)}
    if HASH_FILE.exists() and not refreeze:
        frozen = {line.split()[1]: line.split()[0] for line in HASH_FILE.read_text().splitlines() if line.strip()}
        moved = [name for name, digest in current.items() if frozen.get(name) != digest]
        if moved:
            return current[BENCH_FILE.name], f"{', '.join(moved)} no longer match {HASH_FILE.name}: the frozen benchmark was changed (run with --refreeze only if that was meant)"
        return current[BENCH_FILE.name], None
    HASH_FILE.write_text("".join(f"{digest}  {name}\n" for name, digest in current.items()), encoding="utf-8")
    return current[BENCH_FILE.name], None


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Validate and freeze data/memoria_bench.jsonl")
    parser.add_argument("--refreeze", action="store_true", help="write new hashes even though the benchmark was frozen before")
    args = parser.parse_args(argv)
    print("[Validation Suite]")
    try:
        rows, provenance = read_lines(BENCH_FILE), read_lines(PROVENANCE_FILE)
    except (OSError, ValueError) as error:
        print(f"  └── cannot read the dataset: {error}", file=sys.stderr)
        return 1
    failures, warnings, facts = check(rows, provenance, corpus_history())
    if failures:
        print(f"  └── FAILED: {len(failures)} problem(s)")
        for message in failures[:40]:
            print(f"        - {message}")
        if len(failures) > 40:
            print(f"        ... and {len(failures) - 40} more")
        return 1

    by_class = facts["by_class"]
    print(f"  ├── Total Test Cases: {facts['rows']} (PASSED)")
    print(f"  ├── Class Distribution ({PER_CLASS_TOTAL} per class):")
    for n, label in enumerate(CLASSES):
        print(f"  │     {'└' if n == len(CLASSES) - 1 else '├'}── {label + ':':<23}{by_class[label]}")
    print(f"  ├── Series: {SERIES_COUNT} test series x {PER_SERIES} probes, {PER_CLASS} per class in each (PASSED)")
    print(f"  ├── Citation Integrity: {facts['valid_alert_citations']}/{facts['alerts']} alerts carry valid citations (PASSED)")
    print(f"  ├── Alert Balance: {facts['alerts']} True Alerts / {facts['silent']} Silent Passes (PASSED)")
    basis = facts["outdated_basis"]
    print(f"  ├── OUTDATED: {basis.get(REAL, 0)} rest on a decision the annotations replaced, {basis.get(SYNTHETIC, 0)} on a synthetic '(replaces ...)' note")
    if warnings:
        print(f"  ├── Read by hand: {len(warnings)} UPDATES/INSUFFICIENT_EVIDENCE statements share a distinctive word with a decision")
        for message in warnings:
            print(f"  │     · {message}")
    digest, broken = freeze(args.refreeze)
    if broken:
        print(f"  └── NOT FROZEN: {broken}")
        return 1
    print(f"  └── Benchmark Frozen: SHA-256 hash [{digest[:4]}...{digest[-4:]}] ({digest})")
    print("\nMemoriaBench validation passed with exit code 0. Dataset is locked for evaluation.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
