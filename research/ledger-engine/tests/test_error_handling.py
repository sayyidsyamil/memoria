"""Failure-injection and error-handling tests for the Memoria engine (report chapters 6.2 and 6.3).

The tests feed the pipeline garbage model output, cut files in the middle of a write, crash the process, replay
transcripts in the wrong order and break the disk, then check that the engine fails safe: nothing wrong is stored,
nothing is stored by halves, the whole history can be rebuilt from the append-only log, and every refusal is explained.

Conventions
* Every test docstring is one line: "TC-ERR-NN | requirement | Input: ... | Expected: ...". scripts/run_test_report.py
  turns those lines into the test-case table (results/testing/test_case_table.md and .csv).
* ErrCase.level is unit, integration or system (a test can override it with @at_level); self.observe(...) records the
  actual result that the table shows.
* The language model is never used. ScriptedLLM drives the real MLXExtractor prompt and parser with canned text,
  ScriptedExtractor returns canned candidates. mlx is never imported.
* Scratch files live in tests/.scratch (project-relative, ignored by git through its own .gitignore), never in /tmp.
* A test whose docstring says KNOWN LIMITATION pins down behaviour that is deliberately left as it is
  (see results/testing/defect_log.md).
"""
import ast
import copy
import errno
import hashlib
import json
import os
import random
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import memoria_engine.ledger as ledger_module
from helpers import Env
from memoria_engine import Evidence, Ledger
from memoria_engine.evaluation.dataset import Question, load_chains
from memoria_engine.evaluation.oracle import ledger_answer, values_equal
from memoria_engine.extractors import MLXExtractor, OracleExtractor, parse_events
from memoria_engine.ledger import (AliasConflict, AlreadyDone, InvalidAssertion, LedgerError, LogCorrupt, StaleProposal,
                                   UnknownReference, ts)
from memoria_engine.pipeline import (AttributeSpec, Candidate, Meeting, ObjectSpec, Pipeline, Registry, Turn, ground,
                                     make_policy)

ENGINE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ENGINE_DIR / "data" / "pilot_v0"
RESULTS_DIR = ENGINE_DIR / "results"
SCRATCH_ROOT = Path(__file__).resolve().parent / ".scratch"
RUN_DIR = SCRATCH_ROOT / f"run-{os.getpid()}"  # one directory per process, so two test runs never delete each other's files


def setUpModule():
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    (SCRATCH_ROOT / ".gitignore").write_text("*\n")  # git then ignores everything below tests/.scratch


def tearDownModule():
    shutil.rmtree(RUN_DIR, ignore_errors=True)


def at_level(name):
    """Override the class-level test level for one test method."""
    def mark(fn):
        fn.level = name
        return fn
    return mark


def known_defect(*defect_ids):
    """Marks a test that reproduces a defect still open in the engine (see results/testing/defect_log.md).

    The test asserts the correct behaviour, so it fails on the engine as it is today; unittest reports that as an
    expected failure and scripts/run_test_report.py lists it as a known defect. Once the fix is applied the test passes,
    unittest reports an unexpected success, and the marker must be removed (results/testing/proposed_fixes.patch does it).
    """
    def mark(fn):
        fn.known_defects = defect_ids
        return unittest.expectedFailure(fn)
    return mark


def short(value, width=28):
    text = repr(value)
    return text if len(text) <= width else text[: width - 1] + "…"


class ErrCase(unittest.TestCase):
    level = "unit"

    def setUp(self):
        self.observed = []

    def observe(self, text):
        self.observed.append(str(text))

    def scratch(self):
        path = Path(tempfile.mkdtemp(dir=RUN_DIR))
        self.addCleanup(shutil.rmtree, path, ignore_errors=True)
        return path


# ---- a small tracked-items registry and scripted fakes ------------------------------------------------------------

def build_registry():
    return Registry(
        objects={
            "vendor": ObjectSpec("vendor", "decision", "Which CRM vendor", (
                AttributeSpec("outcome", "enum", ("Vendor A", "Vendor B"), "REVERSE"),)),
            "rollout": ObjectSpec("rollout", "commitment", "CRM rollout", (
                AttributeSpec("deadline", "date"), AttributeSpec("owner", "person"),
                AttributeSpec("status", "enum", ("done", "cancelled")))),
            "budget": ObjectSpec("budget", "decision", "CRM budget in MYR", (AttributeSpec("amount", "number"),)),
        },
        people={"chair": "Chair", "ali": "Ali", "siti": "Siti Nurhaliza"})


def at(day, hour=9):
    return ts(f"{day}T{hour:02d}:00:00Z")


def make_meeting(meeting_id, day, lines, *, ingested=None, step=20.0):
    turns = tuple(Turn(i, speaker, i * step, text) for i, (speaker, text) in enumerate(lines))
    return Meeting(meeting_id, at(day), at(ingested or day, 12), turns)


JAN = make_meeting("m1", "2026-01-10", [
    ("chair", "Morning everyone."),
    ("chair", "We go with Vendor A."),
    ("ali", "I will own the rollout, live by 1 March."),
    ("siti", "What if we looked at Vendor B instead?"),
    ("chair", "Budget is two and a half million ringgit."),
    ("siti", "Kita teruskan dengan pembekal yang sama."),
    ("ali", "The pilot rollout is done."),
])
MAR = make_meeting("m2", "2026-03-20", [
    ("chair", "Quick update on the CRM."),
    ("chair", "No, switch to Vendor B. That is decided."),
    ("ali", "The rollout slips, now due 30 April."),
    ("chair", "Budget goes up to RM3000000."),
])


def event(quote, obj, attr, value, *, turn=None, valid_from=None, confidence=0.9, unresolved=False):
    return {"turn": turn, "object_id": obj, "attribute": attr, "value": value, "quote": quote,
            "valid_from": valid_from, "confidence": confidence, "unresolved": unresolved}


def reply(*events, fence=False):
    text = json.dumps({"events": list(events)})  # json.dumps writes NaN and Infinity as bare tokens, as a model might
    return f"```json\n{text}\n```" if fence else text


def cand(quote, obj, attr, value, turn=None, valid_from=None, confidence=0.9, unresolved=False):
    return Candidate(obj, attr, value, quote, turn, valid_from, confidence, unresolved)


VENDOR_A = ("We go with Vendor A", "vendor", "outcome", "Vendor A")
OWNER_ALI = ("I will own the rollout", "rollout", "owner", "ali")
LIVE_MARCH = ("live by 1 March", "rollout", "deadline", "2026-03-01")


class ScriptedExtractor:
    """Returns canned candidates per meeting id, or raises the canned exception; records every call."""

    name = "scripted"

    def __init__(self, script):
        self.script, self.calls = dict(script), []

    def extract(self, ctx):
        self.calls.append(ctx.meeting.meeting_id)
        out = self.script[ctx.meeting.meeting_id]
        if isinstance(out, BaseException):
            raise out
        return list(out)


class ScriptedLLM(MLXExtractor):
    """The real MLXExtractor path (prompt, model text, parse_events) with canned model text instead of a model."""

    def __init__(self, replies):
        super().__init__("scripted/canned-replies")
        self.replies, self.prompts, self._meeting_id = dict(replies), {}, None

    def extract(self, ctx):
        self._meeting_id = ctx.meeting.meeting_id
        return super().extract(ctx)

    def complete(self, prompt, max_tokens=None):
        self.prompts[self._meeting_id] = prompt
        text = self.replies[self._meeting_id]
        if isinstance(text, BaseException):
            raise text
        return {"text": text, "seconds": 0.0, "prompt_tokens": len(prompt) // 4, "output_tokens": len(text) // 4}


class ScriptedReviewer:
    """A human stand-in: one decision per proposal ('accept', 'reject' or an exception to raise); accepts when the script runs out."""

    name = "scripted-reviewer"

    def __init__(self, decisions=()):
        self.decisions, self.seen = list(decisions), []

    def review(self, pipeline, meeting, d):
        index = len(self.seen)
        self.seen.append(d.proposal_id)
        decision = self.decisions[index] if index < len(self.decisions) else "accept"
        if isinstance(decision, BaseException):
            raise decision
        if decision == "accept":
            out = pipeline.ledger.accept(d.proposal_id, self.name)
            d.review, d.fact_id, d.outcome = "accepted", out.fact_id, out.status
        else:
            pipeline.ledger.reject(d.proposal_id, self.name, note="scripted rejection")
            d.review = "rejected"


def new_pipeline(extractor, policy="immediate", reviewer=None):
    return Pipeline(build_registry(), extractor, make_policy(policy), reviewer)


def durable_pipeline(extractor, directory, policy="immediate", reviewer=None):
    """A pipeline whose ledger lives on disk (database plus JSONL log) instead of in memory."""
    pipe = new_pipeline(extractor, policy, reviewer)
    pipe.ledger.close()
    pipe.ledger = Ledger(str(directory / "ledger.db"), log_path=str(directory / "events.jsonl"), clock=pipe.clock)
    pipe.registry.install(pipe.ledger)
    return pipe


def statuses(result):
    return [d.status for d in result.dispositions]


def value_at(ledger, obj, attr, day=None, tx=None):
    belief = ledger.current(obj, attr) if day is None and tx is None else \
        ledger.as_of(obj, attr, valid_at=at(day or "2100-01-01", 0), tx_at=tx)
    return belief.value if belief else None


def n_changes(ledger, obj, attr):
    return ledger_answer(ledger, Question("q", "n_changes", obj, attr, None, None, None), 0)


def facts_in(ledger):
    return len(ledger.dump()["facts"])


def log_bytes(path):
    return Path(path).read_bytes() if Path(path).exists() else b""


def log_seqs(path):
    return [json.loads(line)["seq"] for line in log_bytes(path).split(b"\n") if line]


def traceable_evidence(test, pipe, meetings):
    """Every stored piece of evidence must point at the exact span of the source it came from, with the right speaker."""
    by_id = {m.meeting_id: m for m in meetings}
    checked = 0
    for obj, attr in pipe.registry.slots():
        for row in pipe.ledger.history(obj, attr):
            test.assertTrue(row["evidence"], f"fact {row['fact_id']} has no evidence")
            for e in row["evidence"]:
                meeting = by_id[pipe.meeting_of_source[e["source_id"]]]
                test.assertEqual(meeting.text[e["char_start"]:e["char_end"]], e["span_text"])
                owner = next(t for t, (a, b) in zip(meeting.turns, meeting.spans()) if a <= e["char_start"] < b)
                test.assertEqual(owner.speaker, e["speaker_id"])
                checked += 1
    return checked


# ---- A. what the model says: parse_events must never raise and must keep what is salvageable -----------------------

GOOD = [
    event("We go with Vendor A", "vendor", "outcome", "Vendor A", turn=1),
    event("I will own the rollout", "rollout", "owner", "ali", turn=2),
    event("live by 1 March", "rollout", "deadline", "2026-03-01", turn=2),
]
GOOD_CANDIDATES = [
    Candidate("vendor", "outcome", "Vendor A", "We go with Vendor A", 1, None, 0.9, False),
    Candidate("rollout", "owner", "ali", "I will own the rollout", 2, None, 0.9, False),
    Candidate("rollout", "deadline", "2026-03-01", "live by 1 March", 2, None, 0.9, False),
]
FUZZ_JUNK = [None, True, False, 0, -1, 1.5, 1e999, float("nan"), "", "x", "null", [], {}, [None], {"a": 1}, 10 ** 30,
             "2026-13-45", 95, -0.5, "high", ["vendor"], {"quote": "q"}, 20260301, "20260301", "2026-W10-1"]
FUZZ_CHARS = list('{}[]":,\\ \n0123456789.-eE') + ["Infinity", "NaN", "null", "\u2028", "\x00", "é"]


def _walk(node, path=()):
    yield path, node
    if isinstance(node, dict):
        for key, value in list(node.items()):
            yield from _walk(value, path + (key,))
    elif isinstance(node, list):
        for i, value in enumerate(list(node)):
            yield from _walk(value, path + (i,))


def mutate_structure(rng, doc):
    """Replace one to three random values anywhere in a parsed reply with junk of a random JSON type."""
    doc = copy.deepcopy(doc)
    for _ in range(rng.randint(1, 3)):
        paths = [p for p, _ in _walk(doc) if p]
        if not paths:
            break
        target = doc
        path = rng.choice(paths)
        for step in path[:-1]:
            target = target[step]
        target[path[-1]] = copy.deepcopy(rng.choice(FUZZ_JUNK))
    return doc


def mutate_text(rng, text):
    """Delete, insert, duplicate or truncate characters, as a failing sampler might."""
    chars = list(text)
    for _ in range(rng.randint(1, 6)):
        if not chars:
            break
        i = rng.randrange(len(chars))
        op = rng.choice(("delete", "insert", "duplicate", "truncate"))
        if op == "delete":
            del chars[i]
        elif op == "insert":
            chars.insert(i, rng.choice(FUZZ_CHARS))
        elif op == "duplicate":
            chars[i:i] = chars[i:i + rng.randint(1, 20)]
        else:
            chars = chars[:i]
    return "".join(chars)


class TestModelOutputParsing(ErrCase):
    level = "unit"

    def test_empty_output(self):
        """TC-ERR-01 | NFR-Robustness | Input: the model returns "", spaces only, or a newline | Expected: ([], False) and no exception"""
        for text in ("", "   ", "\n\t\n"):
            with self.subTest(text=text):
                self.assertEqual(parse_events(text), ([], False))
        self.observe("three empty replies -> ([], parsed_cleanly=False)")

    def test_output_without_json(self):
        """TC-ERR-02 | NFR-Robustness | Input: refusal or prose, a bare [], null, a bullet list (no object at all) | Expected: ([], False), nothing invented"""
        for text in ("I could not find any firm decisions in this transcript.", "Sorry, I cannot help with that.",
                     "[]", "null", "- vendor: A\n- owner: ali", "events: none"):
            with self.subTest(text=text):
                self.assertEqual(parse_events(text), ([], False))
        self.observe("six non-JSON replies -> no candidates, parsed_cleanly=False")

    def test_truncated_json_keeps_the_complete_events(self):
        """TC-ERR-03 | NFR-Robustness | Input: a 3-event reply cut off inside event 3 / after event 3 / inside event 1 / after the opening | Expected: only complete events survive, flagged not clean"""
        pieces = [json.dumps(e) for e in GOOD]
        head = '{"events": ['
        cases = {
            "cut inside event 3": (head + ", ".join(pieces[:2]) + ", " + pieces[2][:25], GOOD_CANDIDATES[:2]),
            "closing ]} missing": (head + ", ".join(pieces), GOOD_CANDIDATES),
            "cut inside event 1": (head + pieces[0][:20], []),
            "cut right after the opening": (head, []),
            "cut inside event 3 under a fence": ("```json\n" + head + ", ".join(pieces[:2]) + ", " + pieces[2][:25], GOOD_CANDIDATES[:2]),
        }
        for name, (text, expected) in cases.items():
            with self.subTest(name):
                self.assertEqual(parse_events(text), (expected, False))
        self.observe("truncated replies -> complete events kept (2, 3, 0, 0, 2), parsed_cleanly=False each time")

    def test_markdown_fences_and_chatter_are_stripped(self):
        """TC-ERR-04 | NFR-Robustness | Input: a valid reply wrapped in a ```json fence, a bare fence, a polite preamble, trailing notes | Expected: the same 3 candidates, parsed cleanly"""
        body = reply(*GOOD)
        wrapped = {
            "json fence": f"```json\n{body}\n```", "bare fence": f"```\n{body}\n```",
            "preamble": f"Sure, here is the JSON you asked for:\n{body}\nLet me know if you need more.",
            "trailing note": f"{body}\n\nNote: I only listed firm decisions.",
        }
        for name, text in wrapped.items():
            with self.subTest(name):
                self.assertEqual(parse_events(text), (GOOD_CANDIDATES, True))
        self.observe("four wrappers -> identical 3 candidates, parsed_cleanly=True")

    def test_braces_in_chatter_fall_back_to_salvage(self):
        """TC-ERR-05 | NFR-Robustness | Input: reasoning text containing braces before or after the JSON | Expected: all 3 events salvaged, flagged not clean"""
        body = reply(*GOOD)
        for name, text in {"braces before": "<think>Candidate {turn 2} looks firm.</think>\n" + body,
                           "braces after": body + "\n(see {note})"}.items():
            with self.subTest(name):
                self.assertEqual(parse_events(text), (GOOD_CANDIDATES, False))
        self.observe("braces around the JSON -> 3 events salvaged one by one, parsed_cleanly=False")

    def test_events_with_missing_fields_or_wrong_item_types(self):
        """TC-ERR-06 | NFR-Robustness | Input: events with only a quote, an empty event, no quote, and list items that are not objects | Expected: a Candidate per object with None/"" for the gaps; non-objects skipped"""
        cases = {
            '{"events":[{"quote":"We go with Vendor A"}]}': [Candidate(None, None, None, "We go with Vendor A")],
            '{"events":[{}]}': [Candidate(None, None, None, "")],
            '{"events":[{"object_id":"vendor","attribute":"outcome","value":"Vendor A"}]}': [Candidate("vendor", "outcome", "Vendor A", "")],
            '{"events":["x", 5, null, [1], {"quote":"q"}]}': [Candidate(None, None, None, "q")],
        }
        for text, expected in cases.items():
            with self.subTest(text):
                self.assertEqual(parse_events(text), (expected, True))
        self.observe("gaps become None/''; the pipeline then reports them as unresolved or ungrounded")

    def test_fields_of_the_wrong_type_are_coerced_or_dropped(self):
        """TC-ERR-07 | FR4, NFR-Robustness | Input: turn "2"/2.0, quote 123/null, confidence "high", valid_from ""/0, unresolved 1/0/null/true | Expected: turn/confidence/valid_from -> None, quote -> str, unresolved -> bool"""
        def one(**fields):
            return parse_events(json.dumps({"events": [{"quote": "q", **fields}]}))[0][0]

        table = [
            ("turn", "2", "turn", None), ("turn", 2.0, "turn", None), ("turn", 2, "turn", 2),
            ("quote", 123, "quote", "123"), ("quote", None, "quote", ""),
            ("confidence", "high", "confidence", None), ("confidence", "0.9", "confidence", None),
            ("confidence", None, "confidence", None),
            ("valid_from", "", "valid_from", None), ("valid_from", 0, "valid_from", None),
            ("unresolved", 1, "unresolved", True), ("unresolved", 0, "unresolved", False),
            ("unresolved", None, "unresolved", False), ("unresolved", True, "unresolved", True),
        ]
        for field, raw, attribute, expected in table:
            with self.subTest(field=field, raw=raw):
                self.assertEqual(getattr(one(**{field: raw}), attribute), expected)
        self.observe("14 type confusions handled without an exception")

    def test_unresolved_flag_written_as_text_is_read_literally(self):
        """TC-ERR-08 | FR4, NFR-Robustness | Input: unresolved is the string "false", "False", "no", "0" or "true", "yes" | Expected: the first four read as False (the event is kept), the others as True"""
        read = {}
        for raw in ("false", "False", " no ", "0", "true", "yes"):
            events, _ = parse_events(json.dumps({"events": [{"quote": "q", "unresolved": raw}]}))
            read[raw] = events[0].unresolved
        self.observe("unresolved text read as " + ", ".join(f"{raw.strip()!r} -> {value}" for raw, value in read.items()))
        self.assertEqual(read, {"false": False, "False": False, " no ": False, "0": False, "true": True, "yes": True})

    def test_reply_with_events_of_the_wrong_shape_never_raises(self):
        """TC-ERR-09 | NFR-Robustness | Input: "events" is null/5/"none"/true/an object, no "events" key, a bare event, a top-level array | Expected: never an exception; a lone event is recovered; clean only when "events" is a list"""
        one = [Candidate(None, None, None, "q")]
        two = [Candidate(None, None, None, "a"), Candidate(None, None, None, "b")]
        cases = [
            ('{"events": null}', ([], False)), ('{"events": 5}', ([], False)), ('{"events": "none"}', ([], False)),
            ('{"events": true}', ([], False)), ('{"events": []}', ([], True)), ('{}', ([], False)),
            ('{"results": []}', ([], False)),
            ('{"events": {"quote": "q"}}', (one, False)),
            ('[{"quote": "q"}]', (one, False)),
            ('{"quote": "q"}', (one, False)),
            ('[{"quote": "a"}, {"quote": "b"}]', (two, False)),
        ]
        wrong = []
        for text, expected in cases:
            try:
                got = parse_events(text)
            except Exception as exc:
                got = exc
            if got != expected:
                wrong.append(f"{text} -> {got if isinstance(got, Exception) else (len(got[0]), got[1])}")
        self.observe(f"{len(cases) - len(wrong)} of {len(cases)} odd shapes handled" + (f"; wrong: {'; '.join(wrong)}" if wrong else "; no exception, a bare event is not lost behind parsed_cleanly=True"))
        self.assertEqual(wrong, [])

    def test_non_finite_and_enormous_numbers_do_not_crash_the_parser(self):
        """TC-ERR-10 | NFR-Robustness | Input: value and confidence set to Infinity, -Infinity, NaN or 1e999 | Expected: no exception, a Candidate comes back (the pipeline later refuses the value)"""
        for name, literal in {"Infinity": "Infinity", "-Infinity": "-Infinity", "NaN": "NaN", "1e999": "1e999"}.items():
            with self.subTest(name):
                text = '{"events":[{"quote":"q","value":%s,"confidence":%s}]}' % (literal, literal)
                candidates, clean = parse_events(text)
                self.assertIsInstance(clean, bool)
                self.assertTrue(all(isinstance(c, Candidate) for c in candidates))
        self.observe("no exception for any of the four literals")

    def test_unicode_and_malay_quotes_survive_parsing(self):
        """TC-ERR-11 | FR2, NFR-Robustness | Input: Malay, Chinese, Arabic, smart quotes, emoji and U+2028 in quotes, raw and \\u-escaped | Expected: the quotes come back unchanged, parsed cleanly"""
        quotes = ["Kita teruskan dengan pembekal yang sama.", "我们选择供应商B。", "نختار المورد أ",
                  "naïve café — “smart quotes” ‘x’", "emoji 🙂 and \u2028 a line separator", "RM2.5 juta"]
        for ascii_only in (False, True):
            with self.subTest(ascii_only=ascii_only):
                text = json.dumps({"events": [event(q, "vendor", "outcome", "Vendor A") for q in quotes]}, ensure_ascii=ascii_only)
                candidates, clean = parse_events(text)
                self.assertTrue(clean)
                self.assertEqual([c.quote for c in candidates], quotes)
        self.observe("6 quotes x 2 encodings round-trip exactly")

    def test_pathological_sizes_finish_quickly_without_exceptions(self):
        """TC-ERR-12 | NFR-Robustness | Input: 200k "{", 200k "}", 30k unfinished events, 50k-deep nesting, a 5000-digit integer, 1 MB of prose, 5000 valid events | Expected: no exception, each under 5 s, the 5000 events all returned"""
        cases = {
            "200k open braces": "{" * 200_000, "200k close braces": "}" * 200_000,
            "30k unfinished events": '{"quote": "x"' * 30_000, "50k-deep nesting": '{"a":' * 50_000 + "}" * 50_000,
            "5000-digit integer": '{"events":[{"quote":"q","value":' + "9" * 5000 + "}]}",
            "1 MB prose": "no decisions were made. " * 45_000,
            "5000 events": reply(*[event(f"quote number {i}", None, None, None, unresolved=True) for i in range(5000)]),
        }
        timings, problems = [], []
        for name, text in cases.items():
            started = time.perf_counter()
            try:
                candidates, clean = parse_events(text)
            except Exception as exc:
                timings.append(f"{name}: raised {type(exc).__name__}")
                problems.append(name)
                continue
            elapsed = time.perf_counter() - started
            timings.append(f"{name}: {elapsed * 1000:.0f} ms")
            if elapsed >= 5.0 or not isinstance(clean, bool) or (name == "5000 events" and (len(candidates), clean) != (5000, True)):
                problems.append(name)
        self.observe("; ".join(timings))
        self.assertEqual(problems, [])

    def test_seeded_fuzz_of_model_replies_never_raises(self):
        """TC-ERR-13 | NFR-Robustness | Input: 3000 structurally and 3000 textually mutated replies (fixed seed) | Expected: parse_events always returns (list of Candidate, bool); zero exceptions"""
        rng = random.Random(20260513)
        base = json.loads(reply(*GOOD))
        failures, total = {}, 0
        for round_no in range(6000):
            if round_no % 2 == 0:
                text = json.dumps(mutate_structure(rng, base))
                if rng.random() < 0.3:
                    text = f"```json\n{text}\n```"
            else:
                text = mutate_text(rng, reply(*GOOD))
            total += 1
            try:
                candidates, clean = parse_events(text)
                self.assertTrue(isinstance(clean, bool) and all(isinstance(c, Candidate) for c in candidates))
            except AssertionError:
                raise
            except BaseException as exc:
                failures.setdefault(type(exc).__name__, []).append(text[:80])
        self.observe(f"{total} mutated replies, exceptions: {({k: len(v) for k, v in failures.items()} or 'none')}")
        self.assertEqual({k: len(v) for k, v in failures.items()}, {}, f"examples: {[v[0] for v in failures.values()]}")


# ---- B. turning loosely typed model values into ledger values -----------------------------------------------------

class TestValueNormalisation(ErrCase):
    level = "unit"

    def setUp(self):
        super().setUp()
        self.reg = build_registry()

    def rejected(self, obj, attr, values):
        for raw in values:
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    self.reg.normalise(obj, attr, raw)

    def test_enum_values_must_be_in_the_allowed_set(self):
        """TC-ERR-14 | FR4 | Input: "vendor a", " VENDOR B " (ok) and "Vendor C", "", None, 5, ["Vendor A"], {"v": "A"}, "A" | Expected: canonical spelling for the first two, ValueError for the rest"""
        self.assertEqual(self.reg.normalise("vendor", "outcome", "vendor a"), "Vendor A")
        self.assertEqual(self.reg.normalise("vendor", "outcome", " VENDOR B "), "Vendor B")
        self.rejected("vendor", "outcome", ["Vendor C", "", None, 5, ["Vendor A"], {"v": "A"}, "A"])
        self.observe("2 accepted in canonical spelling, 7 rejected with ValueError")

    def test_dates_must_be_real_calendar_dates_in_iso_form(self):
        """TC-ERR-15 | FR4, FR5 | Input: "2026-03-01", " 2026-03-01 " (ok) and "1 March 2026", "2026-13-01", "2026-02-30", "", None, "tomorrow", "2026/03/01", 2026 | Expected: the ISO date, ValueError for the rest"""
        for raw in ("2026-03-01", " 2026-03-01 "):
            with self.subTest(raw=raw):
                self.assertEqual(self.reg.normalise("rollout", "deadline", raw), "2026-03-01")
        self.rejected("rollout", "deadline", ["1 March 2026", "2026-13-01", "2026-02-30", "", None, "tomorrow", "2026/03/01", 2026])
        self.observe("2 ISO spellings accepted, 8 non-dates rejected with ValueError")

    def test_dates_in_other_iso_forms_are_stored_in_canonical_form(self):
        """TC-ERR-16 | FR4, FR5 | Input: the deadline "20260301", 20260301 and "2026-W10-1" (valid ISO 8601 spellings the model may use) | Expected: stored as "2026-03-01" / "2026-03-02", so one date is one value"""
        stored = {raw: self.reg.normalise("rollout", "deadline", raw) for raw in ("20260301", 20260301, "2026-W10-1")}
        self.observe("stored as " + ", ".join(f"{short(raw)} -> {value!r}" for raw, value in stored.items()))
        self.assertEqual(list(stored.values()), ["2026-03-01", "2026-03-01", "2026-03-02"])

    def test_numbers_must_be_finite(self):
        """TC-ERR-17 | FR4 | Input: 2500000, "2,500,000", "RM 2500000", 2.5, "2.50", "-5" (ok) and True, None, "abc", "", nan | Expected: numbers out, ValueError for the rest"""
        for raw, expected in ((2500000, 2500000), ("2,500,000", 2500000), ("RM 2500000", 2500000), (2.5, 2.5), ("2.50", 2.5), ("-5", -5)):
            with self.subTest(raw=raw):
                self.assertEqual(self.reg.normalise("budget", "amount", raw), expected)
        self.rejected("budget", "amount", [True, None, "abc", "", float("nan")])
        self.observe("6 numbers accepted; 5 non-numbers rejected with ValueError")

    def test_numbers_must_be_finite_and_scalar(self):
        """TC-ERR-18 | FR4, NFR-Robustness | Input: the amount inf, -inf, 10**400, "9"*400 (not finite), [1, 2] and {"a": 2} (not scalars) | Expected: ValueError every time (never OverflowError, never a silent inf or 12)"""
        outcomes = []
        for raw in (float("inf"), float("-inf"), 10 ** 400, "9" * 400, [1, 2], {"a": 2}):
            try:
                outcomes.append(f"{short(raw)} -> accepted as {short(self.reg.normalise('budget', 'amount', raw))}")
            except ValueError:
                outcomes.append(f"{short(raw)} -> ValueError")
            except Exception as exc:
                outcomes.append(f"{short(raw)} -> {type(exc).__name__}")
        self.observe("; ".join(outcomes))
        self.assertEqual([o for o in outcomes if not o.endswith("-> ValueError")], [])

    def test_people_must_be_known(self):
        """TC-ERR-19 | FR4 | Input: "ali", "ALI", " siti nurhaliza " (ok) and "Dato' Rahman", "", None, 7, ["ali"] | Expected: the person id, ValueError for unknown people"""
        for raw, expected in (("ali", "ali"), ("ALI", "ali"), (" siti nurhaliza ", "siti"), ("Chair", "chair")):
            with self.subTest(raw=raw):
                self.assertEqual(self.reg.normalise("rollout", "owner", raw), expected)
        self.rejected("rollout", "owner", ["Dato' Rahman", "", None, 7, ["ali"]])
        self.observe("4 known spellings accepted, 5 unknown values rejected")

    def test_unknown_slots_raise_key_error(self):
        """TC-ERR-20 | FR4 | Input: an object id or attribute that is not in the registry | Expected: KeyError("unknown slot ...") so the pipeline can mark the candidate invalid"""
        for obj, attr in (("ghost", "outcome"), ("vendor", "colour"), ("rollout", ""), ("", "owner")):
            with self.subTest(obj=obj, attr=attr):
                with self.assertRaises(KeyError):
                    self.reg.normalise(obj, attr, "x")
        self.observe("4 unknown slots -> KeyError")

    def test_known_limitation_units_in_numbers_are_dropped(self):
        """TC-ERR-21 | FR4 | KNOWN LIMITATION (DEF-L1): input "2.5 million", "RM2.5 juta", "1e5", "1,5" | Expected: current lenient behaviour is kept and documented: digits are extracted and units are lost (2.5, 2.5, 15, 15)"""
        got = [self.reg.normalise("budget", "amount", raw) for raw in ("2.5 million", "RM2.5 juta", "1e5", "1,5")]
        self.observe(f"digits kept, units dropped: {got}")
        self.assertEqual(got, [2.5, 2.5, 15, 15])


# ---- C. grounding: the quote must really be in the transcript -----------------------------------------------------

class TestGrounding(ErrCase):
    level = "unit"

    def test_quotes_that_are_not_in_the_transcript_are_not_grounded(self):
        """TC-ERR-22 | FR3, NFR-Traceability | Input: invented, foreign-language-paraphrased and unrelated quotes | Expected: ground() returns None (no evidence, no memory)"""
        for quote in ("I promise to deliver by Friday", "The board approved a nine million ringgit budget",
                      "Kita pilih Vendor B", "Vendor Z is the winner", "completely unrelated sentence about the weather today"):
            with self.subTest(quote=quote):
                self.assertIsNone(ground(JAN, quote))
        self.observe("5 invented quotes -> None")

    def test_hint_turn_is_only_a_preference(self):
        """TC-ERR-23 | FR3, NFR-Traceability | Input: a quote that sits in turn 1 while the model claims turn 0, 5, 99, -1; the same sentence also in turn 3 | Expected: the real turn is cited, the hint breaks ties only, offsets slice the quote"""
        for hint in (None, 0, 5, 99, -1):
            with self.subTest(hint=hint):
                turn, start, end, exact = ground(JAN, "We go with Vendor A", hint)
                self.assertEqual((turn, exact, JAN.text[start:end]), (1, True, "We go with Vendor A"))
        twice = make_meeting("tw", "2026-01-10", [("chair", "Hello."), ("chair", "We go with Vendor A."), ("ali", "Hmm."), ("siti", "We go with Vendor A.")])
        self.assertEqual([ground(twice, "We go with Vendor A", h)[0] for h in (None, 1, 3, 2)], [1, 1, 3, 1])
        self.observe("wrong hints are ignored; with the sentence in turns 1 and 3 the hint picks 3, else the first (1)")

    def test_empty_quotes_and_empty_transcripts(self):
        """TC-ERR-24 | NFR-Robustness | Input: quotes "", "   ", '""', "“”" and a transcript with zero turns | Expected: None, no exception"""
        for quote in ("", "   ", '""', "\u201c\u201d"):
            with self.subTest(quote=quote):
                self.assertIsNone(ground(JAN, quote))
        empty = Meeting("empty", at("2026-01-10"), at("2026-01-10", 12), ())
        self.assertEqual((empty.text, empty.spans()), ("", []))
        for quote in ("anything at all", ""):
            self.assertIsNone(ground(empty, quote))
        self.observe("blank quotes and an empty transcript -> None")

    def test_single_turn_transcript(self):
        """TC-ERR-25 | FR2 | Input: a transcript with exactly one turn; an exact quote and a near-verbatim one that includes the speaker name | Expected: both ground to turn 0 (exact, then fuzzy)"""
        one = make_meeting("one", "2026-01-10", [("chair", "We go with Vendor A.")])
        self.assertEqual(ground(one, "We go with Vendor A")[0::3], (0, True))
        turn, start, end, exact = ground(one, "chair: We go with Vendor A")
        self.assertEqual((turn, exact, (start, end) == one.spans()[0]), (0, False, True))
        self.observe("exact -> turn 0; speaker-prefixed quote -> turn 0 by fuzzy match over the whole turn")

    def test_very_long_turn(self):
        """TC-ERR-26 | NFR-Robustness | Input: one 300 KB turn; a quote at its very end, one with odd whitespace, and an absent quote | Expected: found with exact offsets, absent -> None, each call under 5 s"""
        filler = "the committee discussed other matters at length. " * 6000
        long_meeting = make_meeting("long", "2026-01-10", [("chair", filler + "We go with Vendor A. " + filler)])
        timings = []
        for quote, expect in (("We go with Vendor A", True), ("we  go\nwith   vendor a", True), ("we will certainly choose vendor zed", None)):
            with self.subTest(quote=quote):
                started = time.perf_counter()
                found = ground(long_meeting, quote)
                timings.append(f"{(time.perf_counter() - started) * 1000:.0f} ms")
                self.assertLess(time.perf_counter() - started, 5.0)
                if expect:
                    self.assertTrue(found[3])
                    self.assertEqual(long_meeting.text[found[1]:found[2]].casefold().split(), quote.casefold().split())
                else:
                    self.assertIsNone(found)
        self.observe(f"{len(long_meeting.text) // 1000} KB turn, timings {', '.join(timings)}")

    def test_unicode_malay_and_odd_whitespace_ground_exactly(self):
        """TC-ERR-27 | FR2 | Input: Malay, Chinese, Arabic text; NBSP and line breaks inside the quote; smart quotes around it; different case | Expected: grounded exactly in the right turn"""
        text = [("chair", "Kita teruskan dengan pembekal yang sama."), ("ali", "我们选择供应商B。"), ("siti", "نختار المورد أ"),
                ("chair", "We go with\u00a0Vendor\nA today.")]
        meeting = make_meeting("uni", "2026-01-10", text)
        cases = [("Kita teruskan dengan pembekal yang sama", 0), ("KITA TERUSKAN dengan Pembekal yang sama", 0),
                 ("\u201cKita teruskan dengan pembekal yang sama\u201d", 0), ("我们选择供应商B", 1), ("نختار المورد أ", 2),
                 ("We go with Vendor A", 3)]
        for quote, turn in cases:
            with self.subTest(quote=quote):
                found = ground(meeting, quote)
                self.assertEqual((found[0], found[3]), (turn, True))
        self.observe("6 quotes in 4 scripts/whitespace styles grounded exactly")

    def test_turn_indices_that_do_not_start_at_zero(self):
        """TC-ERR-28 | FR2, FR3 | Input: transcripts whose Turn.index is 1-based, gapped or offset by 10, quoted almost (not exactly) | Expected: the fuzzy match cites the turn's position in the transcript (no IndexError, no wrong turn)"""
        cited = {}
        for name, indices in {"1-based": [1, 2, 3, 4], "gapped": [0, 2, 4, 6], "offset by 10": [10, 11, 12, 13]}.items():
            lines = [("chair", "Morning everyone."), ("chair", "We go with Vendor A."), ("ali", "I will own the rollout."), ("siti", "Thanks all.")]
            meeting = Meeting("idx", at("2026-01-10"), at("2026-01-10", 12),
                              tuple(Turn(i, s, 20.0 * p, t) for p, (i, (s, t)) in enumerate(zip(indices, lines))))
            try:
                turn, start, end, exact = ground(meeting, "we go with vendor b a")
                cited[name] = (turn, exact, meeting.text[start:end])
            except Exception as exc:
                cited[name] = type(exc).__name__
        self.observe("fuzzy match of the second turn returned " + ", ".join(f"{name}: {got}" for name, got in cited.items()) + " (position 1 is right each time)")
        self.assertEqual(cited, {name: (1, False, "We go with Vendor A.") for name in cited})

    def test_known_limitation_quote_copied_with_the_speaker_header_is_refused(self):
        """TC-ERR-29 | FR3 | KNOWN LIMITATION (DEF-L2): input a short quote that still carries the "[1] chair:" header | Expected: None (fails closed instead of guessing); the prompt tells the model to quote the words only"""
        self.assertIsNone(ground(JAN, "[1] chair: We go with Vendor A."))
        self.observe("header-prefixed short quote -> None")


# ---- D. the pipeline fed with bad model output, bad transcripts and awkward orderings -----------------------------------

class TestPipelineWithBadModelOutput(ErrCase):
    level = "integration"

    def test_one_bad_candidate_never_blocks_the_good_ones(self):
        """TC-ERR-30 | FR3, FR4, NFR-Robustness | Input: one model reply with 3 valid events plus an unknown object, unknown attribute, value outside the enum, free-text date, non-numeric amount, unknown person, invented quote and an unresolved item | Expected: the 3 valid events are applied, every other one is dropped with its own status and reason, ledger invariants hold"""
        events = [
            event(*VENDOR_A, turn=1),
            event("We go with Vendor A", "marketing_plan", "outcome", "Vendor A", turn=1),
            event("We go with Vendor A", "vendor", "colour", "red", turn=1),
            event("What if we looked at Vendor B instead?", "vendor", "outcome", "Vendor Z", turn=3),
            event("live by 1 March", "rollout", "deadline", "1 March 2026", turn=2),
            event("Budget is two and a half million ringgit", "budget", "amount", "two and a half million", turn=4),
            event("I will own the rollout", "rollout", "owner", "Dato' Rahman", turn=2),
            event("I promise to deliver by Friday", "rollout", "owner", "ali", turn=2),
            event("Kita teruskan dengan pembekal yang sama", None, None, None, turn=5, unresolved=True),
            event(*OWNER_ALI, turn=2),
            event(*LIVE_MARCH, turn=2),
        ]
        pipe = new_pipeline(ScriptedLLM({"m1": reply(*events, fence=True)}))
        result = pipe.ingest(JAN)
        self.assertEqual(statuses(result), ["applied"] + ["invalid"] * 6 + ["ungrounded", "unresolved", "applied", "applied"])
        self.assertTrue(all(d.reason for d in result.dispositions if d.status != "applied"))
        self.assertTrue(result.stats["parsed_cleanly"])
        self.assertEqual(facts_in(pipe.ledger), 3)
        self.assertEqual([value_at(pipe.ledger, "vendor", "outcome"), value_at(pipe.ledger, "rollout", "owner"),
                          value_at(pipe.ledger, "rollout", "deadline"), value_at(pipe.ledger, "budget", "amount")],
                         ["Vendor A", "ali", "2026-03-01", None])
        self.assertEqual(traceable_evidence(self, pipe, [JAN]), 3)
        self.assertEqual(pipe.ledger.check_invariants(), [])
        self.observe("11 candidates -> 3 applied, 6 invalid, 1 ungrounded, 1 unresolved; the ledger holds exactly the 3 valid facts, each with traceable evidence")

    def test_garbage_replies_store_the_transcript_but_no_facts(self):
        """TC-ERR-31 | FR1, NFR-Robustness | Input: model replies that are empty, prose, an apology, an empty fence or cut off before the first event (and, as a contrast, a clean {"events": []}) | Expected: no exception, zero facts, the transcript is still stored, parsed_cleanly False (True only for the clean empty list)"""
        junk = {"empty": "", "prose": "There were no firm decisions in this meeting.", "apology": "I'm sorry, but I can't do that.",
                "empty fence": "```json\n```", "cut off": '{"events": [{"turn": 1, "object_id": "vendor", "attri'}
        for name, text in {**junk, "clean empty list": reply()}.items():
            with self.subTest(name):
                pipe = new_pipeline(ScriptedLLM({"m1": text}))
                result = pipe.ingest(JAN)
                self.assertEqual(result.dispositions, [])
                self.assertEqual(result.stats["parsed_cleanly"], name == "clean empty list")
                self.assertEqual(facts_in(pipe.ledger), 0)
                self.assertEqual(len(pipe.ledger.dump()["sources"]), 1)
                self.assertEqual(pipe.ledger.check_invariants(), [])
        self.observe("5 garbage replies -> no candidates, 1 stored transcript, 0 facts; the clean empty list is the only one flagged parsed_cleanly")

    def test_out_of_range_or_non_finite_confidence_does_not_abort_the_meeting(self):
        """TC-ERR-32 | FR4, NFR-Robustness | Input: events with confidence 95, -0.2, NaN and 1e999 followed by one with 0.75 | Expected: no exception, all five grounded events are applied, the four unusable confidences are stored as NULL and 0.75 is kept"""
        slots = (("vendor", "outcome"), ("rollout", "owner"), ("rollout", "deadline"), ("budget", "amount"), ("rollout", "status"))
        events = [event(*VENDOR_A, turn=1, confidence=95), event(*OWNER_ALI, turn=2, confidence=-0.2),
                  event(*LIVE_MARCH, turn=2, confidence=float("nan")),
                  event("Budget is two and a half million ringgit", "budget", "amount", 2500000, turn=4, confidence=1e999),
                  event("The pilot rollout is done", "rollout", "status", "done", turn=6, confidence=0.75)]
        pipe = new_pipeline(ScriptedLLM({"m1": reply(*events)}))
        try:
            result = pipe.ingest(JAN)
        except Exception as exc:
            self.observe(f"ingest aborted with {type(exc).__name__}: {str(exc)[:100]}; {facts_in(pipe.ledger)} facts stored")
            raise
        self.assertEqual(statuses(result), ["applied"] * 5)
        stored = [pipe.ledger.history(o, a)[0]["evidence"][0]["confidence"] for o, a in slots]
        self.assertEqual(stored, [None, None, None, None, 0.75])
        self.observe(f"5 applied; stored confidences {stored}")

    def test_a_ledger_rejection_for_one_candidate_does_not_abort_the_meeting(self):
        """TC-ERR-33 | FR5, NFR-Robustness | Input: three valid candidates and an injected fault (InvalidAssertion, then sqlite3.IntegrityError) on the ledger write of the second | Expected: that candidate is dropped as invalid with the ledger's reason, the other two are applied, no exception, invariants hold"""
        outcomes = {}
        for error in (InvalidAssertion("injected refusal"), sqlite3.IntegrityError("injected constraint failure")):
            pipe = new_pipeline(ScriptedExtractor({"m1": [cand(*VENDOR_A, 1), cand(*OWNER_ALI, 2), cand(*LIVE_MARCH, 2)]}))
            real, calls = pipe.ledger.assert_fact, []

            def flaky(*args, **kwargs):
                calls.append(args[:2])
                if len(calls) == 2:
                    raise error
                return real(*args, **kwargs)

            with mock.patch.object(pipe.ledger, "assert_fact", side_effect=flaky):
                try:
                    result = pipe.ingest(JAN)
                    outcomes[type(error).__name__] = (statuses(result), "injected" in result.dispositions[1].reason,
                                                      facts_in(pipe.ledger), pipe.ledger.check_invariants())
                except Exception as exc:
                    outcomes[type(error).__name__] = f"ingest raised {type(exc).__name__}, {facts_in(pipe.ledger)} of 3 facts stored"
        self.observe("; ".join(f"{name} on the 2nd write -> {got if isinstance(got, str) else ', '.join(got[0])}" for name, got in outcomes.items()))
        self.assertEqual(outcomes, {name: (["applied", "invalid", "applied"], True, 2, []) for name in outcomes})

    def test_extractor_exception_propagates_and_leaves_consistent_state(self):
        """TC-ERR-34 | NFR-Robustness, NFR-Recoverability | Input: the extractor raises RuntimeError on the second of two meetings, then works on retry | Expected: ingest re-raises (documented behaviour), the first meeting's facts are untouched, the failed transcript is stored but yields no facts, invariants hold, the retry succeeds without duplicating the source"""
        extractor = ScriptedExtractor({"m1": [cand(*VENDOR_A, 1)], "m2": RuntimeError("model ran out of memory")})
        pipe = new_pipeline(extractor)
        pipe.ingest(JAN)
        facts_before = pipe.ledger.dump()["facts"]
        with self.assertRaises(RuntimeError):
            pipe.ingest(MAR)
        self.assertEqual(pipe.ledger.dump()["facts"], facts_before)
        self.assertEqual(len(pipe.ledger.dump()["sources"]), 2)
        self.assertEqual(pipe.ledger.check_invariants(), [])
        extractor.script["m2"] = [cand("No, switch to Vendor B", "vendor", "outcome", "Vendor B", 1)]
        self.assertEqual(statuses(pipe.ingest(MAR)), ["applied"])
        self.assertEqual(len(pipe.ledger.dump()["sources"]), 2)
        self.assertEqual((value_at(pipe.ledger, "vendor", "outcome"), n_changes(pipe.ledger, "vendor", "outcome")), ("Vendor B", 1))
        self.observe("RuntimeError propagated; 1 fact kept, failed meeting stored as a source only; retry applied Vendor B")

    def test_non_finite_turn_times_are_refused_before_anything_is_stored(self):
        """TC-ERR-35 | FR2, NFR-Robustness | Input: a transcript whose second turn starts at NaN, Infinity or -Infinity seconds | Expected: ValueError before any write: no source row, the extractor is never called, the ledger is unchanged"""
        seen = {}
        for bad in (float("nan"), float("inf"), float("-inf")):
            turns = (Turn(0, "chair", 0.0, "We go with Vendor A."), Turn(1, "ali", bad, "I will own the rollout."))
            meeting = Meeting("bad", at("2026-01-10"), at("2026-01-10", 12), turns)
            extractor = ScriptedExtractor({"bad": [cand(*OWNER_ALI, 1)]})
            pipe = new_pipeline(extractor)
            before = pipe.ledger.dump()
            try:
                pipe.ingest(meeting)
                raised = "no error"
            except Exception as exc:
                raised = type(exc).__name__
            written = len(pipe.ledger.dump()["sources"]) - len(before["sources"])
            seen[f"start={bad}"] = (raised, written, len(extractor.calls), pipe.ledger.dump() == before)
        self.observe("; ".join(f"{name} -> {got[0]}, {got[1]} source row written, extractor called {got[2]}x" for name, got in seen.items()))
        self.assertEqual(seen, {name: ("ValueError", 0, 0, True) for name in seen})

    def test_malformed_meeting_metadata_is_refused_before_anything_is_stored(self):
        """TC-ERR-36 | FR1, NFR-Robustness | Input: a meeting whose occurred_at is a float, a boolean or 2**70, or whose meeting id is blank | Expected: an exception before any write: no source row, extractor never called, ledger unchanged"""
        turns = (Turn(0, "chair", 0.0, "We go with Vendor A."),)
        later = at("2026-01-10", 12)
        bad = {"float time": Meeting("x", 1.7e15, later, turns), "boolean time": Meeting("x", True, later, turns),
               "2**70 time": Meeting("x", 2 ** 70, later, turns), "blank id": Meeting("  ", at("2026-01-10"), later, turns)}
        seen = []
        for name, meeting in bad.items():
            with self.subTest(name):
                extractor = ScriptedExtractor({"x": [cand(*VENDOR_A, 0)], "  ": []})
                pipe = new_pipeline(extractor)
                before = pipe.ledger.dump()
                with self.assertRaises((LedgerError, OverflowError, ValueError, TypeError)) as caught:
                    pipe.ingest(meeting)
                seen.append(type(caught.exception).__name__)
                self.assertEqual(pipe.ledger.dump(), before)
                self.assertEqual(extractor.calls, [])
        self.observe(f"4 malformed meetings refused ({', '.join(seen)}), nothing stored")

    def test_reingesting_a_meeting_does_not_change_beliefs(self):
        """TC-ERR-37 | FR1, FR5 | Input: two meetings ingested twice (a re-upload), then the first again with one typo fixed (same id and date, new text) | Expected: no error, current values, timeline and change count identical, one source per distinct text, new evidence cites the text it came from, invariants hold"""
        script = {"m1": [cand(*VENDOR_A, 1), cand(*OWNER_ALI, 2)], "m2": [cand("No, switch to Vendor B", "vendor", "outcome", "Vendor B", 1)]}
        pipe = new_pipeline(ScriptedExtractor(script))

        def beliefs():
            line = [(b.value, b.valid_from, b.valid_to) for b in pipe.ledger.timeline("vendor", "outcome")]
            return line, value_at(pipe.ledger, "rollout", "owner"), n_changes(pipe.ledger, "vendor", "outcome")

        for meeting in (JAN, MAR):
            pipe.ingest(meeting)
        before, rows_before = beliefs(), len(pipe.ledger.history("vendor", "outcome"))
        for meeting in (JAN, MAR):
            self.assertTrue(all(d.status == "applied" for d in pipe.ingest(meeting).dispositions))
        self.assertEqual(beliefs(), before)
        self.assertEqual(len(pipe.ledger.dump()["sources"]), 2)
        self.assertGreater(len(pipe.ledger.history("vendor", "outcome")), rows_before)
        fixed = Meeting("m1", JAN.occurred_at, JAN.ingested_at,
                        tuple(Turn(t.index, t.speaker, t.start, t.text.replace("Morning", "Good morning")) for t in JAN.turns))
        pipe.ingest(fixed)
        self.assertEqual(beliefs(), before)
        self.assertEqual(len(pipe.ledger.dump()["sources"]), 3)
        texts = {hashlib.sha256(m.text.encode()).hexdigest(): m.text for m in (JAN, fixed, MAR)}
        cited = set()
        for obj, attr in pipe.registry.slots():
            for row in pipe.ledger.history(obj, attr):
                for e in row["evidence"]:
                    self.assertEqual(texts[e["source_id"]][e["char_start"]:e["char_end"]], e["span_text"])
                    cited.add(e["source_id"])
        self.assertEqual(len(cited), 3)
        self.assertEqual(pipe.ledger.check_invariants(), [])
        self.observe("beliefs unchanged after 2 re-uploads and a corrected upload; 3 sources; every evidence span slices its own source text")

    def test_late_import_of_an_older_meeting_does_not_override_a_newer_decision(self):
        """TC-ERR-38 | FR5, FR6 | Input: budget 2.5M (Jan) and 3.0M (Mar) ingested, then a February meeting saying 2.8M is imported last | Expected: current stays 3.0M, as-of 10 Feb now says 2.8M, as known before the import it said 2.5M, the timeline is 2.5M, 2.8M, 3.0M with 2 changes, invariants hold"""
        feb = make_meeting("m1b", "2026-02-05", [("chair", "Hello again."), ("chair", "Budget is RM2800000 for now.")], ingested="2026-04-01")
        script = {"m1": [cand("Budget is two and a half million ringgit", "budget", "amount", 2500000, 4)],
                  "m2": [cand("Budget goes up to RM3000000", "budget", "amount", 3000000, 3)],
                  "m1b": [cand("Budget is RM2800000 for now", "budget", "amount", 2800000, 1)]}
        pipe = new_pipeline(ScriptedExtractor(script))
        for meeting in (JAN, MAR):
            pipe.ingest(meeting)
        known_before_import = at("2026-03-25", 0)
        self.assertEqual(value_at(pipe.ledger, "budget", "amount", "2026-02-10", tx=known_before_import), 2500000)
        late = pipe.ingest(feb)
        self.assertEqual(statuses(late), ["applied"])
        self.assertEqual(value_at(pipe.ledger, "budget", "amount"), 3000000)
        self.assertEqual(value_at(pipe.ledger, "budget", "amount", "2026-02-10"), 2800000)
        self.assertEqual(value_at(pipe.ledger, "budget", "amount", "2026-02-10", tx=known_before_import), 2500000)
        self.assertEqual([b.value for b in pipe.ledger.timeline("budget", "amount")], [2500000, 2800000, 3000000])
        self.assertEqual(n_changes(pipe.ledger, "budget", "amount"), 2)
        self.assertEqual(pipe.ledger.check_invariants(), [])
        self.observe("late February import slotted between January and March; current stayed 3000000; the past as known on 25 March is still answerable")

    def test_candidates_listed_out_of_order_are_applied_in_transcript_order(self):
        """TC-ERR-39 | FR5 | Input: one meeting where the model lists the later decision first and repeats the earlier one | Expected: applied in transcript order INITIAL, CONFIRM, REVERSE; one change; current Vendor B; invariants hold"""
        meeting = make_meeting("rev", "2026-01-10", [("chair", "We go with Vendor A."), ("chair", "No, switch to Vendor B.")])
        listed = [cand("No, switch to Vendor B", "vendor", "outcome", "Vendor B", 1), cand("We go with Vendor A", "vendor", "outcome", "Vendor A", 0),
                  cand("We go with Vendor A", "vendor", "outcome", "Vendor A", 0)]
        pipe = new_pipeline(ScriptedExtractor({"rev": listed}))
        self.assertEqual(statuses(pipe.ingest(meeting)), ["applied"] * 3)
        history = pipe.ledger.history("vendor", "outcome")
        self.assertEqual([(h["value"], h["change_type"]) for h in history], [("Vendor A", "INITIAL"), ("Vendor A", "CONFIRM"), ("Vendor B", "REVERSE")])
        self.assertEqual((value_at(pipe.ledger, "vendor", "outcome"), n_changes(pipe.ledger, "vendor", "outcome")), ("Vendor B", 1))
        self.assertEqual(pipe.ledger.check_invariants(), [])
        self.observe("listed B, A, A -> committed A, A, B; one change")

    def test_known_limitation_same_text_under_another_meeting_id_is_refused(self):
        """TC-ERR-40 | FR1, NFR-Robustness | KNOWN LIMITATION (DEF-L3): input the same transcript text submitted again under a different meeting id and date | Expected: InvalidAssertion (a loud refusal, sources are keyed by content hash) before any change; the ledger is unchanged and other texts are still accepted"""
        pipe = new_pipeline(ScriptedExtractor({"m1": [cand(*VENDOR_A, 1)], "m1-copy": [cand(*VENDOR_A, 1)], "m2": []}))
        pipe.ingest(JAN)
        before = pipe.ledger.dump()
        twin = Meeting("m1-copy", JAN.occurred_at + 86_400_000_000, JAN.ingested_at + 86_400_000_000, JAN.turns)
        with self.assertRaises(InvalidAssertion):
            pipe.ingest(twin)
        self.assertEqual(pipe.ledger.dump(), before)
        self.assertEqual(statuses(pipe.ingest(MAR)), [])
        self.observe("identical text, different id -> InvalidAssertion('source already recorded with different metadata'); ledger unchanged")

    def test_threshold_policy_sends_missing_or_low_confidence_to_review(self):
        """TC-ERR-41 | FR4, FR5 | Input: policy threshold:0.8 and five events with confidence 0.95, null, 0.5, 0.8 and 0.79 | Expected: applied, proposed, proposed, applied (the boundary passes), proposed; the three proposals stay pending and change nothing until accepted"""
        events = [event(*VENDOR_A, turn=1, confidence=0.95), event(*OWNER_ALI, turn=2, confidence=None),
                  event(*LIVE_MARCH, turn=2, confidence=0.5),
                  event("Budget is two and a half million ringgit", "budget", "amount", 2500000, turn=4, confidence=0.8),
                  event("The pilot rollout is done", "rollout", "status", "done", turn=6, confidence=0.79)]
        pipe = new_pipeline(ScriptedLLM({"m1": reply(*events)}), policy="threshold:0.8")
        result = pipe.ingest(JAN)
        self.assertEqual(statuses(result), ["applied", "proposed", "proposed", "applied", "proposed"])
        self.assertEqual(len(pipe.ledger.pending_proposals()), 3)
        self.assertEqual(facts_in(pipe.ledger), 2)
        self.assertIsNone(value_at(pipe.ledger, "rollout", "owner"))
        pipe.ledger.accept(result.dispositions[1].proposal_id, "reviewer-1")
        self.assertEqual((value_at(pipe.ledger, "rollout", "owner"), len(pipe.ledger.pending_proposals())), ("ali", 2))
        self.assertEqual(pipe.ledger.check_invariants(), [])
        self.observe("statuses applied, proposed, proposed, applied, proposed; 3 pending; accepting one made it current")

    def test_review_policy_names_are_validated(self):
        """TC-ERR-42 | NFR-Robustness | Input: policy specs "", "Immediate", "threshold", "threshold:", "threshold:abc", "never" (bad) and "immediate", "confirm_all", "threshold:0.8" (good) | Expected: ValueError for the bad ones, a Policy of the right kind for the good ones"""
        for spec in ("", "Immediate", "threshold", "threshold:", "threshold:abc", "never", " immediate"):
            with self.subTest(spec=spec):
                with self.assertRaises(ValueError):
                    make_policy(spec)
        self.assertEqual([make_policy(s).kind for s in ("immediate", "confirm_conflicts", "confirm_all", "threshold:0.8")],
                         ["immediate", "confirm_conflicts", "confirm_all", "threshold"])
        self.observe("7 bad specs rejected, 4 good ones accepted")

    def test_a_nan_threshold_is_refused_instead_of_switching_review_off(self):
        """TC-ERR-43 | NFR-Robustness | Input: the policy spec "threshold:nan" (a typo that compares false with every confidence) | Expected: ValueError, because accepting it would silently apply every candidate without review"""
        try:
            policy = make_policy("threshold:nan")
            outcome = f"accepted as a {policy.kind} policy with tau={policy.tau}"
        except ValueError:
            outcome = "refused with ValueError"
        self.observe(f"threshold:nan {outcome}")
        self.assertEqual(outcome, "refused with ValueError")

    def test_reviewer_exception_leaves_pending_proposals_reviewable(self):
        """TC-ERR-44 | FR5, NFR-Recoverability | Input: policy confirm_all, the reviewer accepts the first proposal and then crashes on the second | Expected: ingest re-raises, one fact is applied, one proposal is pending and can still be accepted afterwards, the third candidate was never proposed, invariants hold"""
        reviewer = ScriptedReviewer(["accept", RuntimeError("review screen crashed")])
        pipe = new_pipeline(ScriptedExtractor({"m1": [cand(*VENDOR_A, 1), cand(*OWNER_ALI, 2), cand(*LIVE_MARCH, 2)]}), "confirm_all", reviewer)
        with self.assertRaises(RuntimeError):
            pipe.ingest(JAN)
        self.assertEqual((facts_in(pipe.ledger), len(pipe.ledger.pending_proposals())), (1, 1))
        self.assertEqual(pipe.ledger.check_invariants(), [])
        pipe.ledger.accept(pipe.ledger.pending_proposals()[0]["proposal_id"], "reviewer-2")
        self.assertEqual((facts_in(pipe.ledger), len(pipe.ledger.pending_proposals())), (2, 0))
        self.observe("crash on proposal 2 -> 1 fact, 1 pending; accepted later; the third candidate was never proposed")

    def test_empty_and_one_turn_transcripts_go_through_the_whole_pipeline(self):
        """TC-ERR-45 | FR1, FR2, NFR-Robustness | Input: a transcript with zero turns, then one with a single turn holding one decision | Expected: zero turns -> no candidates, no facts, no error; one turn -> one fact whose evidence cites turn 0 and the right speaker"""
        empty = Meeting("empty", at("2026-01-10"), at("2026-01-10", 12), ())
        one = make_meeting("one", "2026-01-11", [("chair", "We go with Vendor A.")])
        llm = ScriptedLLM({"empty": reply(), "one": reply(event(*VENDOR_A, turn=0))})
        pipe = new_pipeline(llm)
        self.assertEqual(pipe.ingest(empty).dispositions, [])
        self.assertEqual(facts_in(pipe.ledger), 0)
        self.assertEqual(statuses(pipe.ingest(one)), ["applied"])
        self.assertEqual(traceable_evidence(self, pipe, [one, empty]), 1)
        self.assertEqual(pipe.ledger.history("vendor", "outcome")[0]["evidence"][0]["speaker_id"], "chair")
        self.assertEqual(pipe.ledger.check_invariants(), [])
        self.observe("empty transcript -> nothing; one-turn transcript -> 1 fact with evidence from turn 0")


# ---- E. ledger refusals: a rejected write leaves the database and the log exactly as they were ---------------------------

def state(env, log_path):
    """Everything a refused write must not touch: every table, and the bytes of the JSONL log."""
    return env.L.dump(), log_bytes(log_path)


class TestLedgerRejections(ErrCase):
    level = "unit"

    def open_env(self, **kw):
        path = self.scratch() / "events.jsonl"
        return Env(log_path=str(path), **kw), path

    def test_references_to_things_that_do_not_exist_are_refused(self):
        """TC-ERR-46 | FR3, FR5 | Input: writes naming an unknown object, attribute, source, issue, entity, fact or proposal | Expected: UnknownReference every time, database and log byte-identical afterwards"""
        env, log = self.open_env()
        L, good = env.L, env.ev(1000)
        L.propose("dec1", "outcome", "A", env.ev(2000))
        attempts = {
            "unknown object": lambda: L.assert_fact("ghost", "outcome", "A", good),
            "unknown attribute": lambda: L.assert_fact("dec1", "nonsense", "A", good),
            "unknown source": lambda: L.assert_fact("dec1", "outcome", "A", Evidence("0" * 64, "agreed")),
            "unknown issue": lambda: L.create_object("dec9", "decision", issue_id="no-such-issue"),
            "alias of an unknown entity": lambda: L.add_alias("zed", "nobody"),
            "retract an unknown fact": lambda: L.retract(999, "reviewer", "why"),
            "correct an unknown fact": lambda: L.correct(999, "reviewer", "why", value="B"),
            "accept an unknown proposal": lambda: L.accept(999, "reviewer"),
            "reject an unknown proposal": lambda: L.reject(999, "reviewer"),
            "propose on an unknown object": lambda: L.propose("ghost", "outcome", "A", good),
        }
        before = state(env, log)
        for name, attempt in attempts.items():
            with self.subTest(name):
                with self.assertRaises(UnknownReference):
                    attempt()
                self.assertEqual(state(env, log), before)
        self.observe(f"{len(attempts)} dangling references -> UnknownReference, state byte-identical")

    def test_malformed_assertions_are_refused_with_invalid_assertion(self):
        """TC-ERR-47 | FR4, FR5 | Input: 21 malformed writes (no evidence, blank span, discriminator misuse, valid_to not after valid_from, unsupported value types, bad kind hint, bad cardinality, redefinitions, blank ids, non-integer occurred_at, blank reviewer, unknown edit field) | Expected: InvalidAssertion every time, database and log byte-identical afterwards"""
        env, log = self.open_env()
        L = env.L
        L.define_attribute("tag", "many")
        good = env.ev(1000)
        fact = env.say("dec1", "outcome", "A", 500)
        pid = L.propose("dec1", "outcome", "B", env.ev(2000))
        attempts = {
            "no evidence": lambda: L.assert_fact("dec1", "outcome", "A", []),
            "blank span": lambda: L.assert_fact("dec1", "outcome", "A", Evidence(good.source_id, "   ")),
            "discriminator on a single-valued attribute": lambda: L.assert_fact("dec1", "outcome", "A", good, discriminator="x"),
            "many-valued attribute without discriminator": lambda: L.assert_fact("dec1", "tag", "A", good),
            "valid_to equals valid_from": lambda: L.assert_fact("dec1", "outcome", "A", good, valid_from=2000, valid_to=2000),
            "valid_to before valid_from": lambda: L.assert_fact("dec1", "outcome", "A", good, valid_from=2000, valid_to=1000),
            "unknown kind hint": lambda: L.assert_fact("dec1", "outcome", "A", good, kind_hint="WRONG"),
            "bytes value": lambda: L.assert_fact("dec1", "outcome", b"x", good),
            "set value": lambda: L.assert_fact("dec1", "outcome", {1, 2}, good),
            "dict with integer keys": lambda: L.assert_fact("dec1", "outcome", {1: 2}, good),
            "bad cardinality": lambda: L.define_attribute("shape", "several"),
            "attribute redefined": lambda: L.define_attribute("tag", "one"),
            "unknown object kind": lambda: L.create_object("x1", "meeting"),
            "object redefined": lambda: L.create_object("dec1", "commitment"),
            "blank object id": lambda: L.create_object("  ", "decision"),
            "float occurred_at": lambda: L.add_source("another chunk", "m9", 1.5),
            "blank meeting id": lambda: L.add_source("another chunk", "", 5),
            "same text with other metadata": lambda: L.add_source("chunk@1000", "m1", 1001),
            "retraction without a reason": lambda: L.retract(fact.fact_id, "reviewer", ""),
            "blank reviewer": lambda: L.accept(pid, "  "),
            "unknown edit field": lambda: L.accept(pid, "reviewer", edits={"colour": "red"}),
        }
        before = state(env, log)
        for name, attempt in attempts.items():
            with self.subTest(name):
                with self.assertRaises(InvalidAssertion):
                    attempt()
                self.assertEqual(state(env, log), before)
        self.observe(f"{len(attempts)} malformed writes -> InvalidAssertion, state byte-identical")

    def test_nan_and_infinity_never_reach_the_database_or_the_log(self):
        """TC-ERR-48 | FR4, NFR-Robustness | Input: the values NaN, Infinity, -Infinity, [1, NaN], {"a": {"b": Infinity}} and (1, inf) in assert_fact and in propose | Expected: InvalidAssertion, database and log unchanged, and the log holds no NaN or Infinity token even after a later valid write"""
        env, log = self.open_env()
        good = env.ev(1000)
        before = state(env, log)
        bad = [float("nan"), float("inf"), float("-inf"), [1, float("nan")], {"a": {"b": float("inf")}}, (1, float("inf"))]
        for i, value in enumerate(bad):
            for write in (env.L.assert_fact, env.L.propose):
                with self.subTest(i=i, write=write.__name__):
                    with self.assertRaises(InvalidAssertion):
                        write("dec1", "outcome", value, good)
                    self.assertEqual(state(env, log), before)
        env.say("dec1", "outcome", 2500000, 3000)
        self.assertNotIn(b"NaN", log_bytes(log))
        self.assertNotIn(b"Infinity", log_bytes(log))
        self.observe("12 non-finite writes refused; the log stayed strict JSON")

    def test_writes_that_break_a_database_constraint_are_rolled_back(self):
        """TC-ERR-49 | NFR-Robustness, NFR-Recoverability | Input: direct ledger calls with evidence confidence 1.5, -0.1 or inf, char_end before char_start, audio_end before audio_start, valid_from NaN or 2**70, and a log file that is read-only | Expected: an exception (never a silent success), database and log byte-identical, and the same ledger takes the next valid write and reopens equal"""
        env, log = self.open_env()
        L = env.L
        src = L.add_source("a longer chunk of text", "m5", 1000)
        refusals = (LedgerError, sqlite3.IntegrityError, ValueError, OverflowError, TypeError)
        attempts = {
            "confidence 1.5": lambda: L.assert_fact("dec1", "outcome", "A", Evidence(src, "x", confidence=1.5)),
            "confidence -0.1": lambda: L.assert_fact("dec1", "outcome", "A", Evidence(src, "x", confidence=-0.1)),
            "confidence inf": lambda: L.assert_fact("dec1", "outcome", "A", Evidence(src, "x", confidence=float("inf"))),
            "char_end before char_start": lambda: L.assert_fact("dec1", "outcome", "A", Evidence(src, "x", char_start=10, char_end=3)),
            "audio_end before audio_start": lambda: L.assert_fact("dec1", "outcome", "A", Evidence(src, "x", audio_start=5.0, audio_end=1.0)),
            "valid_from NaN": lambda: L.assert_fact("dec1", "outcome", "A", Evidence(src, "x"), valid_from=float("nan")),
            "valid_from 2**70": lambda: L.assert_fact("dec1", "outcome", "A", Evidence(src, "x"), valid_from=2 ** 70),
        }
        before = state(env, log)
        seen = []
        for name, attempt in attempts.items():
            with self.subTest(name):
                with self.assertRaises(refusals) as caught:
                    attempt()
                seen.append(type(caught.exception).__name__)
                self.assertEqual(state(env, log), before)
        if os.geteuid() != 0:
            with self.subTest("read-only log file"):
                os.chmod(log, 0o444)
                try:
                    with self.assertRaises(OSError):
                        L.assert_fact("dec1", "outcome", "A", Evidence(src, "x"))
                    self.assertEqual(state(env, log), before)
                finally:
                    os.chmod(log, 0o644)
        env.say("dec1", "outcome", "A", 3000)
        live = L.dump()
        reopened = Ledger(":memory:", log_path=str(log))
        self.assertEqual(reopened.dump(), live)
        reopened.close()
        self.observe(f"{len(seen)} constraint violations raised {sorted(set(seen))}; nothing stored; next write fine; log replays to the same state")

    def test_alias_conflicts_are_refused_even_when_spelled_differently(self):
        """TC-ERR-50 | FR4 | Input: the alias "Ali" belongs to entity ali; it is claimed for entity siti as "ali", " ALI " and full-width "ＡＬＩ"; also an empty alias, a blank alias and an alias for an unknown entity | Expected: AliasConflict, InvalidAssertion, UnknownReference respectively; repeating the alias for its own entity is a no-op; state unchanged"""
        env, log = self.open_env()
        L = env.L
        L.add_entity("ali", "person", "Ali Hassan")
        L.add_entity("siti", "person", "Siti Nurhaliza")
        L.add_alias("Ali", "ali")
        before = state(env, log)
        for alias in ("ali", " ALI ", "\uff21\uff2c\uff29"):
            with self.subTest(alias=alias):
                with self.assertRaises(AliasConflict):
                    L.add_alias(alias, "siti")
        for alias in ("", "   "):
            with self.subTest(alias=alias):
                with self.assertRaises(InvalidAssertion):
                    L.add_alias(alias, "siti")
        with self.assertRaises(UnknownReference):
            L.add_alias("zed", "nobody")
        L.add_alias("ALI", "ali")
        self.assertEqual(state(env, log), before)
        self.assertEqual(L.resolve_alias(" ali "), "ali")
        self.observe("3 conflicting spellings, 2 blank aliases and 1 unknown entity refused; re-adding the owner's alias changed nothing")

    def test_a_stale_proposal_cannot_be_accepted(self):
        """TC-ERR-51 | FR5 | Input: proposal P suggests B; before anyone reviews it a direct decision changes the belief P was made against; P is then accepted, rejected, accepted again | Expected: StaleProposal and nothing changed on the first accept, the reject succeeds, the final accept raises AlreadyDone"""
        env, log = self.open_env()
        L = env.L
        env.say("dec1", "outcome", "A", 1000)
        pid = L.propose("dec1", "outcome", "B", env.ev(2000))
        env.say("dec1", "outcome", "C", 1500)
        before = state(env, log)
        with self.assertRaises(StaleProposal):
            L.accept(pid, "reviewer")
        self.assertEqual(state(env, log), before)
        self.assertEqual([p["proposal_id"] for p in L.pending_proposals()], [pid])
        L.reject(pid, "reviewer", note="superseded by the 1500 decision")
        self.assertEqual(L.pending_proposals(), [])
        with self.assertRaises(AlreadyDone):
            L.accept(pid, "reviewer")
        self.assertEqual((env.values("dec1", "outcome", [2500]), L.check_invariants()), (["C"], []))
        self.observe("stale accept refused with the proposal still pending; reject worked once; later accept -> AlreadyDone; belief stayed C")

    def test_a_proposal_is_reviewed_exactly_once_even_across_a_restart(self):
        """TC-ERR-52 | FR5, NFR-Recoverability | Input: a proposal is accepted, then accepted again, rejected and reviewed with a blank reviewer; the database is closed and reopened and the same calls repeat | Expected: AlreadyDone for repeats and InvalidAssertion for the blank name, before and after the restart; one review row and one fact"""
        directory = self.scratch()
        env = Env(db_path=str(directory / "l.db"), log_path=str(directory / "events.jsonl"))
        pid = env.L.propose("dec1", "outcome", "A", env.ev(1000))
        env.L.accept(pid, "reviewer-1")

        def repeats(ledger):
            for name, call, error in (("accept again", lambda: ledger.accept(pid, "reviewer-2"), AlreadyDone),
                                      ("reject after accept", lambda: ledger.reject(pid, "reviewer-2"), AlreadyDone),
                                      ("blank reviewer", lambda: ledger.accept(pid, " "), InvalidAssertion)):
                with self.subTest(name):
                    with self.assertRaises(error):
                        call()

        repeats(env.L)
        env.L.close()
        reopened = Ledger(str(directory / "l.db"), log_path=str(directory / "events.jsonl"), clock=env.clock)
        self.addCleanup(reopened.close)
        repeats(reopened)
        tables = reopened.dump()
        self.assertEqual((len(tables["reviews"]), len(tables["facts"])), (1, 1))
        self.observe("repeat reviews refused before and after reopening; 1 review row, 1 fact")

    def test_retracting_and_correcting_keep_the_audit_trail(self):
        """TC-ERR-53 | FR5, NFR-Traceability | Input: retract the current fact, retract it again, correct a retracted fact, then correct an older fact | Expected: AlreadyDone for the two bad calls with nothing changed; the retraction restores the earlier belief; no row is ever deleted and retracted facts stay in history"""
        env, log = self.open_env()
        L = env.L
        first = env.say("dec1", "outcome", "A", 1000)
        second = env.say("dec1", "outcome", "B", 2000, kind_hint="REVERSE")
        facts_before = len(L.dump()["facts"])
        L.retract(second.fact_id, "reviewer", "mis-heard")
        self.assertEqual((env.values("dec1", "outcome", [3000]), len(L.dump()["facts"])), (["A"], facts_before))
        before = state(env, log)
        for name, call in (("retract twice", lambda: L.retract(second.fact_id, "reviewer", "again")),
                           ("correct a retracted fact", lambda: L.correct(second.fact_id, "reviewer", "fix", value="C"))):
            with self.subTest(name):
                with self.assertRaises(AlreadyDone):
                    call()
                self.assertEqual(state(env, log), before)
        fixed = L.correct(first.fact_id, "reviewer", "typo in the minutes", value="A2")
        history = L.history("dec1", "outcome")
        self.assertEqual(sorted((h["fact_id"], h["value"], h["retracted"] is not None, h["change_type"]) for h in history),
                         [(first.fact_id, "A", True, "INITIAL"), (second.fact_id, "B", True, "REVERSE"), (fixed.fact_id, "A2", False, "CORRECT")])
        reasons = {h["fact_id"]: h["retracted"]["reason"] for h in history if h["retracted"]}
        self.assertEqual(reasons, {second.fact_id: "mis-heard", first.fact_id: "corrected: typo in the minutes"})
        self.assertEqual((fixed.status, env.values("dec1", "outcome", [3000]), L.check_invariants()), ("in_force", ["A2"], []))
        self.observe("retraction restored A; correction added A2; all three facts remain in history with their retraction flags")

    def test_a_correction_needs_a_reason(self):
        """TC-ERR-54 | FR5, NFR-Traceability | Input: correct() called with an empty, a blank and a None reason | Expected: InvalidAssertion and nothing changed (the audit trail must say why a fact was corrected)"""
        got = {}
        for reason in ("", "   ", None):
            env, log = self.open_env()
            first = env.say("dec1", "outcome", "A", 1000)
            before = state(env, log)
            try:
                env.L.correct(first.fact_id, "reviewer", reason, value="A2")
                got[reason] = ("accepted", state(env, log) == before)
            except InvalidAssertion:
                got[reason] = ("refused", state(env, log) == before)
        self.observe("; ".join(f"reason {reason!r} -> {verdict}" for reason, (verdict, _) in got.items()))
        self.assertEqual(got, {reason: ("refused", True) for reason in got})

    def test_validity_bounds_must_be_integers(self):
        """TC-ERR-55 | FR5, NFR-Robustness | Input: assert_fact, propose and correct with valid_from or valid_to given as "2026-01-01", 1500.5 or True | Expected: InvalidAssertion, nothing stored, and the slot stays writable (a text bound would otherwise make every later write to the slot fail)"""
        outcomes = {}
        for bad in ("2026-01-01", 1500.5, True):
            for name in ("assert valid_from", "assert valid_to", "propose valid_from", "correct valid_from"):
                env, log = self.open_env()
                L = env.L
                first = env.say("dec1", "outcome", "A", 1000)
                good = env.ev(2000)
                before = state(env, log)
                calls = {"assert valid_from": lambda: L.assert_fact("dec1", "outcome", "B", good, valid_from=bad),
                         "assert valid_to": lambda: L.assert_fact("dec1", "outcome", "B", good, valid_from=1200, valid_to=bad),
                         "propose valid_from": lambda: L.propose("dec1", "outcome", "B", good, valid_from=bad),
                         "correct valid_from": lambda: L.correct(first.fact_id, "reviewer", "fix", valid_from=bad)}
                try:
                    calls[name]()
                    outcome = "accepted"
                except InvalidAssertion:
                    outcome = "refused"
                except Exception as exc:
                    outcome = type(exc).__name__
                unchanged = state(env, log) == before
                try:
                    env.say("dec1", "outcome", "B", 9000)
                    writable = env.values("dec1", "outcome", [9500]) == ["B"]
                except Exception:
                    writable = False
                outcomes[f"{name} with {bad!r}"] = (outcome, unchanged, writable)
        counts = {o: sum(1 for got in outcomes.values() if got[0] == o) for o in sorted({got[0] for got in outcomes.values()})}
        self.observe(f"{len(outcomes)} calls with a text, float or boolean bound -> {counts}; slot still writable afterwards in "
                     f"{sum(1 for got in outcomes.values() if got[2])} of them")
        self.assertEqual(outcomes, {name: ("refused", True, True) for name in outcomes})


# ---- F. the append-only log: crashes, torn writes, damaged files, failing disks ---------------------------------------

REAL_OPEN = open

CRASH_CHILD = r'''
import json, os, sys
sys.path.insert(0, "tests"); sys.path.insert(0, ".")
from helpers import Env
from memoria_engine import ledger as lm

mode, db, log = sys.argv[1:4]
env = Env(db_path=db, log_path=log)
env.say("dec1", "outcome", "A", 1000)
evidence = env.ev(2000)
print("ACKNOWLEDGED", flush=True)
real_append, real_write = lm.Ledger._append_log, lm.Ledger._write
if mode == "torn_record":
    def torn(self, seq, tx, op, args):
        line = json.dumps({"seq": seq, "tx": tx, "op": op, "args": args}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        with open(self._log_path, "a", encoding="utf-8") as f:
            f.write(line[: len(line) // 2]); f.flush(); os.fsync(f.fileno())
        os._exit(9)
    lm.Ledger._append_log = torn
elif mode == "logged_before_commit":
    def dies(self, seq, tx, op, args):
        real_append(self, seq, tx, op, args)
        os._exit(9)
    lm.Ledger._append_log = dies
elif mode == "after_commit":
    def dies(self, op, args):
        real_write(self, op, args)
        os._exit(9)
    lm.Ledger._write = dies
env.L.assert_fact("dec1", "outcome", "B", evidence, valid_from=2000)
print("NOT REACHED", flush=True)
'''


class FullDisk:
    """A log file that accepts half of the record and then reports that the disk is full."""

    def __init__(self, path, mode="r", **kwargs):
        self.real = REAL_OPEN(path, mode, **kwargs)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.real.close()
        return False

    def write(self, text):
        self.real.write(text[: len(text) // 2])
        self.real.flush()
        raise OSError(errno.ENOSPC, "No space left on device")

    def flush(self):
        self.real.flush()

    def fileno(self):
        return self.real.fileno()


class FlakyCommit:
    """Wraps the sqlite connection and fails the next COMMIT, as a dying disk can."""

    def __init__(self, real):
        self._real, self.armed = real, True

    def execute(self, sql, *args):
        if sql == "COMMIT" and self.armed:
            self.armed = False
            raise sqlite3.OperationalError("disk I/O error")
        return self._real.execute(sql, *args)

    def __getattr__(self, name):
        return getattr(self._real, name)


def drop_wal(db):
    for suffix in ("-wal", "-shm"):
        Path(str(db) + suffix).unlink(missing_ok=True)


class TestLogDurability(ErrCase):
    level = "integration"

    def paths(self):
        directory = self.scratch()
        return directory / "ledger.db", directory / "events.jsonl"

    def workload(self, **kw):
        """A small ledger with every kind of write in it: sources, objects, facts, an entity and an alias."""
        env = Env(**kw)
        env.say("dec1", "outcome", "A", 1000)
        env.say("dec1", "outcome", "B", 2000, kind_hint="REVERSE")
        env.L.add_entity("ali", "person", "Ali Hassan")
        env.L.add_alias("Ali", "ali")
        return env

    def test_a_torn_trailing_record_is_dropped_at_every_cut_point(self):
        """TC-ERR-56 | NFR-Recoverability | Input: the database holds the state before a write and the log ends with the first 1, 2, 10, half, n-2 or n-1 bytes of that write's record | Expected: reopening drops the torn bytes, the state equals the state before the write, the next write is logged as a clean numbered line and a rebuild from the log equals the live state"""
        db, log = self.paths()
        env = self.workload(db_path=str(db), log_path=str(log))
        evidence = env.ev(3000)
        before, prefix = env.L.dump(), log_bytes(log)
        env.L.close()
        db_before = db.read_bytes()
        last = Ledger(str(db), log_path=str(log), clock=env.clock)
        last.assert_fact("dec1", "outcome", "C", evidence, valid_from=3000)
        last.close()
        record = log_bytes(log)[len(prefix):]
        self.assertEqual((record.count(b"\n"), record.endswith(b"\n")), (1, True))
        cuts = (1, 2, 10, len(record) // 2, len(record) - 2, len(record) - 1)
        for cut in cuts:
            with self.subTest(cut=cut):
                drop_wal(db)
                db.write_bytes(db_before)
                log.write_bytes(prefix + record[:cut])
                reopened = Ledger(str(db), log_path=str(log), clock=env.clock)
                self.assertEqual(reopened.dump(), before)
                self.assertEqual(log_bytes(log), prefix)
                reopened.assert_fact("dec1", "outcome", "C", evidence, valid_from=3000)
                live = reopened.dump()
                reopened.close()
                seqs = log_seqs(log)
                self.assertEqual(seqs, list(range(1, len(seqs) + 1)))
                rebuilt = Ledger(":memory:", log_path=str(log))
                self.assertEqual(rebuilt.dump(), live)
                rebuilt.close()
        self.observe(f"{len(cuts)} cut points of a {len(record)}-byte record: torn bytes dropped, pre-write state restored, next write clean, rebuild equal")

    @at_level("system")
    def test_a_process_killed_during_a_write_never_loses_acknowledged_data(self):
        """TC-ERR-57 | NFR-Recoverability | Input: a child process acknowledges one decision and is then killed (os._exit) during the next write: while its log record is half written, after the record is logged but before COMMIT, and just after COMMIT | Expected: the restart opens, the acknowledged decision is there, the half record is gone, the fully logged writes are present, the database equals a replay of the log, invariants hold and a new write works"""
        expected = {"torn_record": "A", "logged_before_commit": "B", "after_commit": "B"}
        for mode, value in expected.items():
            with self.subTest(mode=mode):
                db, log = self.paths()
                child = subprocess.run([sys.executable, "-c", CRASH_CHILD, mode, str(db), str(log)],
                                       cwd=str(ENGINE_DIR), capture_output=True, text=True, timeout=120)
                self.assertEqual((child.returncode, child.stdout.split()), (9, ["ACKNOWLEDGED"]), child.stderr)
                restarted = Ledger(str(db), log_path=str(log))
                self.addCleanup(restarted.close)
                replayed = Ledger(":memory:", log_path=str(log))
                self.addCleanup(replayed.close)
                self.assertEqual(restarted.dump(), replayed.dump())
                self.assertEqual((restarted.current("dec1", "outcome").value, restarted.check_invariants()), (value, []))
                restarted.assert_fact("dec1", "outcome", "Z", Evidence(restarted.add_source("chunk@9000", "m1", 9000), "agreed"), valid_from=9000)
                self.assertEqual(restarted.dump(), Ledger(":memory:", log_path=str(log)).dump())
        self.observe("3 kill points survived: torn record -> A; record logged before COMMIT -> B (replayed); after COMMIT -> B")

    def test_structural_damage_to_the_log_is_reported_as_logcorrupt(self):
        """TC-ERR-58 | NFR-Recoverability | Input: a valid log with a line duplicated, two lines swapped, a blank line, a missing or textual seq, every seq reset to 1, a garbage line appended, two records on one line; and, with the database on disk, a log that was deleted or emptied | Expected: LogCorrupt every time, log bytes untouched"""
        db, log = self.paths()
        env = self.workload(db_path=str(db), log_path=str(log))
        env.L.close()
        lines = log_bytes(log).split(b"\n")[:-1]
        swapped = list(lines)
        swapped[5], swapped[6] = lines[6], lines[5]
        variants = {
            "duplicated line": lines[:5] + [lines[5]] + lines[5:],
            "adjacent lines swapped": swapped,
            "blank line in the middle": lines[:5] + [b""] + lines[5:],
            "seq field missing": lines[:5] + [lines[5].replace(b'"seq":6,', b"")] + lines[6:],
            "seq written as text": lines[:5] + [lines[5].replace(b'"seq":6,', b'"seq":"6",')] + lines[6:],
            "every seq reset to 1": [line.replace(b'"seq":%d,' % (n + 1), b'"seq":1,') for n, line in enumerate(lines)],
            "garbage line appended": lines + [b"not json at all"],
            "two records on one line": lines[:5] + [lines[5] + lines[6]] + lines[7:],
        }
        for name, damaged in variants.items():
            with self.subTest(name):
                log.write_bytes(b"\n".join(damaged) + b"\n")
                before = log_bytes(log)
                with self.assertRaises(LogCorrupt):
                    Ledger(":memory:", log_path=str(log))
                self.assertEqual(log_bytes(log), before)
        log.write_bytes(b"\n".join(lines) + b"\n")
        for name, damage in (("log deleted", lambda: log.unlink()), ("log emptied", lambda: log.write_bytes(b""))):
            with self.subTest(name):
                damage()
                with self.assertRaises(LogCorrupt):
                    Ledger(str(db), log_path=str(log))
                log.write_bytes(b"\n".join(lines) + b"\n")
        self.assertEqual(Ledger(str(db), log_path=str(log)).check_invariants(), [])
        self.observe(f"{len(variants) + 2} damaged logs -> LogCorrupt, bytes untouched; the restored log opens again")

    def test_every_other_kind_of_log_damage_is_also_logcorrupt(self):
        """TC-ERR-59 | NFR-Recoverability, NFR-Robustness | Input: a log line that is the JSON number 123, [1], null or "s"; a byte that is not UTF-8; a record without args or without tx; args that is a list; a record naming an unknown object; a define_attribute with cardinality "several" | Expected: LogCorrupt in every case (not AttributeError, KeyError, TypeError, UnicodeDecodeError, UnknownReference or InvalidAssertion) and the log bytes untouched"""
        _, log = self.paths()
        self.workload(log_path=str(log)).L.close()
        lines = log_bytes(log).split(b"\n")[:-1]
        ops = [json.loads(line)["op"] for line in lines]
        fact, define = ops.index("assert_fact"), ops.index("define_attribute")

        def edited(index, change):
            return lines[:index] + [change(lines[index])] + lines[index + 1:]

        def without(key):
            return lambda line: json.dumps({k: v for k, v in json.loads(line).items() if k != key}).encode()

        variants = {
            "line is the number 123": edited(5, lambda line: b"123"),
            "line is an array": edited(5, lambda line: b"[1]"),
            "line is null": edited(5, lambda line: b"null"),
            "line is a string": edited(5, lambda line: b'"s"'),
            "byte that is not UTF-8": edited(5, lambda line: line.replace(b'"seq"', b'"s\xffq"')),
            "record without args": edited(fact, without("args")),
            "record without tx": edited(fact, without("tx")),
            "args is a list": edited(fact, lambda line: json.dumps({**json.loads(line), "args": [1]}).encode()),
            "unknown object": edited(fact, lambda line: line.replace(b'"object_id":"dec1"', b'"object_id":"ghost"')),
            "cardinality several": edited(define, lambda line: line.replace(b'"one"', b'"several"').replace(b'"many"', b'"several"')),
        }
        raised = {}
        for name, damaged in variants.items():
            log.write_bytes(b"\n".join(damaged) + b"\n")
            before = log_bytes(log)
            try:
                Ledger(":memory:", log_path=str(log))
                kind = "opened without complaint"
            except Exception as exc:
                kind = type(exc).__name__
            raised[name] = (kind, log_bytes(log) == before)
        other = {name: kind for name, (kind, _) in raised.items() if kind != "LogCorrupt"}
        self.observe(f"{len(raised) - len(other)} of {len(raised)} damaged logs raised LogCorrupt" + (f"; other errors: {other}" if other else "") + "; log bytes untouched")
        self.assertEqual(raised, {name: ("LogCorrupt", True) for name in raised})

    def test_text_with_unicode_line_separators_does_not_make_the_ledger_unopenable(self):
        """TC-ERR-60 | NFR-Recoverability, NFR-Robustness | Input: evidence text containing U+2028, U+2029, U+0085, vertical tab, form feed, file separator or a carriage return, stored in an on-disk ledger that is closed and reopened and also rebuilt from the log alone | Expected: reopening and rebuilding succeed and equal the live state"""
        separators = {"U+2028": "\u2028", "U+2029": "\u2029", "U+0085": "\x85", "vertical tab": "\x0b",
                      "form feed": "\x0c", "file separator": "\x1c", "carriage return": "\r"}
        reopened_as = {}
        for name, char in separators.items():
            db, log = self.paths()
            env = Env(db_path=str(db), log_path=str(log))
            source = env.L.add_source(f"we agreed{char}on it", "m1", 1000)
            env.L.assert_fact("dec1", "outcome", "A", Evidence(source, f"agreed{char}on"), valid_from=1000)
            live = env.L.dump()
            env.L.close()
            try:
                reopened = Ledger(str(db), log_path=str(log))
                same = reopened.dump() == live
                reopened.close()
                rebuilt = Ledger(":memory:", log_path=str(log)).dump() == live
                reopened_as[name] = "reopened and rebuilt equal" if same and rebuilt else "state differs"
            except Exception as exc:
                reopened_as[name] = type(exc).__name__
        bad = {name: outcome for name, outcome in reopened_as.items() if outcome != "reopened and rebuilt equal"}
        self.observe(f"{len(reopened_as) - len(bad)} of {len(reopened_as)} separators survive close, reopen and rebuild" + (f"; the ledger could not be opened after {bad}" if bad else ""))
        self.assertEqual(bad, {})

    def test_a_failed_log_append_leaves_no_residue_for_the_next_start(self):
        """TC-ERR-61 | NFR-Recoverability | Input: in a live process the log write fails (fsync reports EIO; the disk fills up after half a record; COMMIT fails after the record was logged) | Expected: the write raises, database and log are unchanged, the next write works with the next sequence number, and a restart and a rebuild both equal the live state"""
        def fsync_fails(env, evidence):
            with mock.patch.object(ledger_module.os, "fsync", side_effect=OSError(errno.EIO, "I/O error")):
                env.L.assert_fact("dec1", "outcome", "B", evidence, valid_from=2000)

        def disk_fills_up(env, evidence):
            with mock.patch.object(ledger_module, "open", FullDisk, create=True):
                env.L.assert_fact("dec1", "outcome", "B", evidence, valid_from=2000)

        def commit_fails(env, evidence):
            env.L._db = FlakyCommit(env.L._db)
            env.L.assert_fact("dec1", "outcome", "B", evidence, valid_from=2000)

        verdicts = {}
        for name, inject in (("fsync fails", fsync_fails), ("disk full after half a record", disk_fills_up), ("COMMIT fails", commit_fails)):
            db, log = self.paths()
            env = Env(db_path=str(db), log_path=str(log))
            env.say("dec1", "outcome", "A", 1000)
            evidence = env.ev(2000)
            before, log_before = env.L.dump(), log_bytes(log)
            problems = []
            try:
                inject(env, evidence)
                problems.append("the failing write did not raise")
            except (OSError, sqlite3.OperationalError):
                pass
            try:
                if env.L.dump() != before:
                    problems.append("live database changed")
                if log_bytes(log) != log_before:
                    problems.append("log kept residue of the failed write")
                env.L.assert_fact("dec1", "outcome", "B", evidence, valid_from=2000)
                live = env.L.dump()
                env.L.close()
                seqs = log_seqs(log)
                if seqs != list(range(1, len(seqs) + 1)):
                    problems.append("log sequence numbers are not consecutive")
                if Ledger(str(db), log_path=str(log)).dump() != live:
                    problems.append("a restart differs from the live state")
                if Ledger(":memory:", log_path=str(log)).dump() != live:
                    problems.append("a rebuild from the log differs from the live state")
            except Exception as exc:
                problems.append(f"later steps raised {type(exc).__name__}: {str(exc)[:60]}")
            verdicts[name] = problems
        self.observe("; ".join(f"{name}: {'; '.join(problems) or 'clean'}" for name, problems in verdicts.items()))
        self.assertEqual(verdicts, {name: [] for name in verdicts})

    @at_level("system")
    def test_a_damaged_database_file_is_refused_and_rebuilt_from_the_log(self):
        """TC-ERR-62 | NFR-Recoverability | Input: the database file replaced by garbage bytes, cut in half, or zeroed after the first page; a zero-length file | Expected: sqlite3.DatabaseError and an untouched log for the damaged files (never silently wrong data); after moving the file aside the ledger rebuilds from the log equal to the original; an empty file is simply rebuilt"""
        db, log = self.paths()
        env = self.workload(db_path=str(db), log_path=str(log))
        live = env.L.dump()
        env.L.close()
        good, log_before = db.read_bytes(), log_bytes(log)
        damaged = {"garbage bytes": b"this is not a sqlite database " * 50, "cut in half": good[: len(good) // 2],
                   "zeroed after the first page": good[:4096] + b"\x00" * (len(good) - 4096)}
        for name, data in damaged.items():
            with self.subTest(name):
                drop_wal(db)
                db.write_bytes(data)
                with self.assertRaises(sqlite3.DatabaseError):
                    Ledger(str(db), log_path=str(log))
                self.assertEqual(log_bytes(log), log_before)
                db.replace(db.with_name("ledger.db.damaged"))
                drop_wal(db)
                rebuilt = Ledger(str(db), log_path=str(log))
                self.assertEqual((rebuilt.dump(), rebuilt.check_invariants()), (live, []))
                rebuilt.close()
        with self.subTest("zero-length file"):
            drop_wal(db)
            db.write_bytes(b"")
            rebuilt = Ledger(str(db), log_path=str(log))
            self.assertEqual(rebuilt.dump(), live)
            rebuilt.close()
        self.observe("3 damaged database files raised DatabaseError and were rebuilt from the log after being moved aside; an empty file was rebuilt directly")

    def test_the_log_only_ever_grows_by_whole_numbered_lines(self):
        """TC-ERR-63 | FR5, NFR-Traceability, NFR-Recoverability | Input: 15 operations (7 writes, 3 repeated ensure-calls, 5 refused writes; they include a proposal, its review, a correction and a retraction) with the log read after each one | Expected: every earlier log is a byte prefix of the later one, a refused or repeated call adds nothing, every other call adds exactly one strict-JSON line, seq runs 1..n and tx strictly increases"""
        db, log = self.paths()
        env = Env(db_path=str(db), log_path=str(log))
        L = env.L
        first = env.say("dec1", "outcome", "A", 1000)
        evidence, later = env.ev(2000), env.ev(3000)
        calls = [
            ("write", lambda: L.assert_fact("dec1", "outcome", "B", evidence, valid_from=2000, kind_hint="REVERSE")),
            ("repeat", lambda: L.define_attribute("outcome", "one")),
            ("repeat", lambda: L.create_object("dec1", "decision", issue_id="issue1")),
            ("refused", lambda: L.assert_fact("ghost", "outcome", "B", evidence)),
            ("refused", lambda: L.assert_fact("dec1", "outcome", float("nan"), evidence)),
            ("write", lambda: L.add_entity("ali", "person", "Ali Hassan")),
            ("repeat", lambda: L.add_entity("ali", "person", "Ali Hassan")),
            ("write", lambda: L.add_alias("Ali", "ali")),
            ("refused", lambda: L.add_alias("ali", "ali2")),
            ("write", lambda: L.propose("dec1", "outcome", "C", later, confidence=0.6)),
            ("write", lambda: L.accept(1, "reviewer")),
            ("refused", lambda: L.accept(1, "reviewer")),
            ("write", lambda: L.correct(first.fact_id, "reviewer", "typo", value="A2")),
            ("refused", lambda: L.retract(first.fact_id, "reviewer", "again")),
            ("write", lambda: L.retract(2, "reviewer", "wrong meeting")),
        ]
        history = [log_bytes(log)]
        for kind, call in calls:
            try:
                call()
            except LedgerError:
                self.assertEqual(kind, "refused")
            history.append(log_bytes(log))
            self.assertTrue(history[-1].startswith(history[-2]), kind)
            added = history[-1][len(history[-2]):]
            self.assertEqual((added.count(b"\n"), len(added) > 0), (1, True) if kind == "write" else (0, False), kind)
        seqs, txs = log_seqs(log), []
        for line in log_bytes(log).split(b"\n")[:-1]:
            def refuse(token):
                raise ValueError(f"non-standard JSON token {token}")
            txs.append(json.loads(line, parse_constant=refuse)["tx"])
        self.assertEqual(seqs, list(range(1, len(seqs) + 1)))
        self.assertTrue(all(a < b for a, b in zip(txs, txs[1:])))
        self.assertEqual(seqs[-1], L._meta("last_seq"))
        kinds = [kind for kind, _ in calls]
        self.observe(f"{len(calls)} calls: {kinds.count('write')} writes added one line each, {kinds.count('refused')} refused and {kinds.count('repeat')} repeated calls added nothing; log has {len(seqs)} lines, seq 1..{seqs[-1]}, tx strictly increasing")

    def test_an_edit_to_the_log_that_keeps_it_well_formed_is_not_detected(self):
        """TC-ERR-64 | NFR-Recoverability | KNOWN LIMITATION (DEF-L4): input a log whose stored value was changed from "A" to "Z" by hand with the seq numbers intact | Expected: no error is raised (there is no checksum), a rebuild shows Z, an existing database still shows A; only accidental damage is detected"""
        db, log = self.paths()
        env = self.workload(db_path=str(db), log_path=str(log))
        env.L.close()
        log.write_bytes(log_bytes(log).replace(b'"value":"A"', b'"value":"Z"'))
        rebuilt = Ledger(":memory:", log_path=str(log))
        stale = Ledger(str(db), log_path=str(log))
        self.assertEqual(([h["value"] for h in rebuilt.history("dec1", "outcome")], [h["value"] for h in stale.history("dec1", "outcome")]),
                         (["Z", "B"], ["A", "B"]))
        self.observe("tampered log accepted: rebuild shows Z while the existing database shows A (no checksum; accidental damage only)")


# ---- G. integration and system tests: transcripts in, answers out, whatever the model says ---------------------------

def story_meetings():
    """Four meetings of one project. m4 happened in February but is only imported in May (a late import)."""
    quiet = make_meeting("quiet", "2026-02-20", [("chair", "Let us look at the schedule."), ("ali", "Nothing has changed since January.")])
    late = make_meeting("late", "2026-02-15", [("chair", "A short catch-up."), ("ali", "Correction, the rollout deadline is 15 March.")],
                        ingested="2026-05-01")
    return JAN, quiet, MAR, late


_MARCH_FULL = reply(event("switch to Vendor B", "vendor", "outcome", "Vendor B", turn=1),
                    event("now due 30 April", "rollout", "deadline", "2026-04-30", turn=2),
                    event("Budget goes up to RM3000000", "budget", "amount", 3000000, turn=3))
STORY_REPLIES = {
    "m1": reply(event(*VENDOR_A, turn=1), event(*OWNER_ALI, turn=2), event(*LIVE_MARCH, turn=2), fence=True),
    "quiet": "I read the transcript carefully and I could not find any decision or commitment in it, sorry.",
    "m2": _MARCH_FULL[: _MARCH_FULL.index('"amount"') + 5],  # the model ran out of tokens inside its third event
    "late": reply(event("the rollout deadline is 15 March", "rollout", "deadline", "2026-03-15", turn=1)),
}
BEFORE_LATE_IMPORT, AFTER_LATE_IMPORT = at("2026-04-01", 0), at("2026-06-01", 0)
STORY_ANSWERS = {
    "vendor now": "Vendor B",
    "rollout owner now": "ali",
    "rollout deadline now": "2026-04-30",
    "budget now (its event was cut off)": None,
    "vendor on 2026-02-01": "Vendor A",
    "deadline on 2026-03-10 as known on 2026-04-01": "2026-03-01",
    "deadline on 2026-03-10 as known on 2026-06-01": "2026-03-15",
    "number of vendor changes": 1,
    "number of deadline changes": 2,
}


def run_story(pipe):
    return [pipe.ingest(meeting) for meeting in story_meetings()]


def story_answers(ledger):
    return {
        "vendor now": value_at(ledger, "vendor", "outcome"),
        "rollout owner now": value_at(ledger, "rollout", "owner"),
        "rollout deadline now": value_at(ledger, "rollout", "deadline"),
        "budget now (its event was cut off)": value_at(ledger, "budget", "amount"),
        "vendor on 2026-02-01": value_at(ledger, "vendor", "outcome", "2026-02-01"),
        "deadline on 2026-03-10 as known on 2026-04-01": value_at(ledger, "rollout", "deadline", "2026-03-10", tx=BEFORE_LATE_IMPORT),
        "deadline on 2026-03-10 as known on 2026-06-01": value_at(ledger, "rollout", "deadline", "2026-03-10", tx=AFTER_LATE_IMPORT),
        "number of vendor changes": n_changes(ledger, "vendor", "outcome"),
        "number of deadline changes": n_changes(ledger, "rollout", "deadline"),
    }


def imported_modules(path):
    """(imported at module level, imported anywhere) top-level module names of one source file; relative imports are skipped."""
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))

    def names(node):
        if isinstance(node, ast.Import):
            return {alias.name.split(".")[0] for alias in node.names}
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            return {node.module.split(".")[0]}
        return set()

    return set().union(*(names(n) for n in tree.body)), set().union(*(names(n) for n in ast.walk(tree)))


class TestEndToEnd(ErrCase):
    level = "integration"

    def test_garbled_and_truncated_replies_still_give_a_consistent_queryable_history(self):
        """TC-ERR-65 | FR1, FR3, FR4, FR5, FR6, NFR-Robustness | Input: four meetings through the real prompt and parser with scripted model text: a fenced valid reply, prose without JSON, a reply cut off inside its third event, and a late import in May of a February meeting | Expected: 3, 0, 2 and 1 events applied; the cut-off event is dropped; the nine current, as-of-valid-time, as-of-transaction-time and number-of-changes answers equal the expected table; every fact cites its exact transcript span; invariants hold"""
        llm = ScriptedLLM(STORY_REPLIES)
        pipe = new_pipeline(llm)
        results = run_story(pipe)
        self.assertEqual([statuses(r) for r in results], [["applied"] * 3, [], ["applied"] * 2, ["applied"]])
        self.assertEqual([r.stats["parsed_cleanly"] for r in results], [True, False, False, True])
        self.assertEqual(story_answers(pipe.ledger), STORY_ANSWERS)
        self.assertEqual(pipe.ledger.pending_proposals(), [])
        self.assertEqual(traceable_evidence(self, pipe, story_meetings()), 6)
        self.assertEqual(pipe.ledger.check_invariants(), [])
        self.observe("applied 3/0/2/1 events; answers " + "; ".join(f"{k} = {v}" for k, v in STORY_ANSWERS.items()) + "; 6 facts, all traceable")

    @at_level("system")
    def test_the_same_story_survives_a_restart_and_a_rebuild_from_the_log(self):
        """TC-ERR-66 | FR5, FR6, NFR-Recoverability | Input: the TC-ERR-65 story ingested into an on-disk ledger, then the process restarts, then the database is deleted so it must be rebuilt, then the log alone is replayed into memory | Expected: the full database dump and all nine answers are identical in every state and the log is numbered 1..n without gaps"""
        directory = self.scratch()
        pipe = durable_pipeline(ScriptedLLM(STORY_REPLIES), directory)
        run_story(pipe)
        live = pipe.ledger.dump()
        self.assertEqual(story_answers(pipe.ledger), STORY_ANSWERS)
        pipe.ledger.close()
        db, log = directory / "ledger.db", directory / "events.jsonl"
        states = {"restart": lambda: Ledger(str(db), log_path=str(log)),
                  "rebuild after deleting the database": lambda: (drop_wal(db), db.unlink(), Ledger(str(db), log_path=str(log)))[-1],
                  "replay of the log in memory": lambda: Ledger(":memory:", log_path=str(log))}
        for name, open_ledger in states.items():
            with self.subTest(name):
                ledger = open_ledger()
                self.addCleanup(ledger.close)
                self.assertEqual(ledger.dump(), live)
                self.assertEqual(story_answers(ledger), STORY_ANSWERS)
                self.assertEqual(ledger.check_invariants(), [])
        seqs = log_seqs(log)
        self.assertEqual(seqs, list(range(1, len(seqs) + 1)))
        self.observe(f"restart, rebuild-after-delete and in-memory replay all equal the live ledger ({len(seqs)} log lines); 9 answers identical")

    @at_level("system")
    def test_every_shipped_chain_is_answered_correctly_after_a_restart_and_a_rebuild(self):
        """TC-ERR-67 | FR1, FR2, FR3, FR4, FR5, FR6, NFR-Recoverability | Input: the five shipped meeting chains (crm, datacentre, tender, hiring, portfolio) ingested into an on-disk ledger by the oracle extractor, then reopened, then rebuilt from the log with the database deleted | Expected: every gold question (current, as-of, as-of transaction time, number of changes) is answered as the annotators wrote it in all three states, the dumps are identical and invariants hold"""
        chains = load_chains(str(DATA_DIR))
        self.assertEqual({c.chain_id for c in chains}, {"crm", "datacentre", "tender", "hiring", "portfolio"})
        asked = 0
        for chain in chains:
            with self.subTest(chain.chain_id):
                directory = self.scratch()
                db, log = directory / "ledger.db", directory / "events.jsonl"
                pipe = Pipeline(chain.registry, OracleExtractor(chain), make_policy("immediate"))
                pipe.ledger.close()
                pipe.ledger = Ledger(str(db), log_path=str(log), clock=pipe.clock)
                pipe.registry.install(pipe.ledger)
                for gm in chain.meetings:
                    self.assertEqual({d.status for d in pipe.ingest(gm.meeting).dispositions}, {"applied"})
                live = pipe.ledger.dump()
                pipe.ledger.close()
                states = {"reopened": lambda: Ledger(str(db), log_path=str(log)),
                          "rebuilt from the log": lambda: (drop_wal(db), db.unlink(), Ledger(str(db), log_path=str(log)))[-1]}
                for state_name, open_ledger in states.items():
                    ledger = open_ledger()
                    self.addCleanup(ledger.close)
                    self.assertEqual(ledger.dump(), live, state_name)
                    self.assertEqual(ledger.check_invariants(), [], state_name)
                    for q in chain.questions:
                        self.assertTrue(values_equal(ledger_answer(ledger, q, chain.now), q.gold), f"{state_name}: {q.qid}, gold {q.gold}")
                asked += len(chain.questions)
        self.observe(f"{asked} gold questions over 5 chains answered correctly in 2 states each (reopened, rebuilt) after live ingestion")

    def test_every_recorded_real_model_reply_parses(self):
        """TC-ERR-68 | NFR-Robustness, FR4 | Input: every raw extraction reply of the local Qwen model recorded for the dev and test splits in results/cache (real output, never regenerated by the test) | Expected: parse_events never raises, at least 99 percent of the replies parse cleanly and every candidate carries an object, an attribute and a quote"""
        files = [RESULTS_DIR / "cache" / name for name in ("dev_memoria.jsonl", "test_memoria.jsonl")]
        if not all(f.exists() for f in files):
            self.skipTest("recorded model replies are not present")
        rows = [json.loads(line) for f in files for line in f.read_text(encoding="utf-8").splitlines() if line.strip()]
        # the caches also hold the replies of the question router, which are JSON without an "events" list
        replies = [r["text"] for r in rows if r["prompt_head"].startswith("You maintain a decision and commitment ledger")]
        self.assertGreaterEqual(len(replies), 100)
        clean = candidates = 0
        for text in replies:
            found, ok = parse_events(text)
            clean += bool(ok)
            candidates += len(found)
            for c in found:
                self.assertTrue(c.object_id and c.attribute and c.quote, c)
        self.assertGreaterEqual(clean / len(replies), 0.99)
        self.observe(f"{len(replies)} recorded extraction replies (of {len(rows)} cached calls), {clean} parsed cleanly, {candidates} candidates, none raised")

    @at_level("system")
    def test_a_full_run_needs_no_network_and_loads_no_model_runtime(self):
        """TC-ERR-69 | NFR-Privacy-local | Input: the TC-ERR-65 story run end to end into an on-disk ledger while every socket connect and name lookup is a tripwire, plus a static scan of the imports of every module in memoria_engine | Expected: the tripwire never fires, mlx and mlx_lm are not loaded by the run, no module imports a network-capable library, and the only non-standard import is a lazy mlx_lm import inside a function"""
        tripped = []

        def tripwire(*args, **kwargs):
            tripped.append(args)
            raise AssertionError("network access attempted")

        runtime = lambda: {m for m in sys.modules if m.split(".")[0] in ("mlx", "mlx_lm")}
        loaded_before = runtime()
        with mock.patch.object(socket, "create_connection", tripwire), mock.patch.object(socket, "getaddrinfo", tripwire), \
                mock.patch.object(socket.socket, "connect", tripwire), mock.patch.object(socket.socket, "connect_ex", tripwire):
            pipe = durable_pipeline(ScriptedLLM(STORY_REPLIES), self.scratch())
            run_story(pipe)
            answers = story_answers(pipe.ledger)
            pipe.ledger.close()
        self.assertEqual((tripped, answers, runtime() - loaded_before), ([], STORY_ANSWERS, set()))
        network = {"socket", "ssl", "http", "urllib", "urllib3", "requests", "httpx", "aiohttp", "ftplib", "smtplib", "poplib",
                   "imaplib", "telnetlib", "xmlrpc", "websocket", "websockets", "socketserver", "huggingface_hub"}
        files = sorted((ENGINE_DIR / "memoria_engine").rglob("*.py"))
        top_level, anywhere = set(), set()
        for path in files:
            module_level, all_imports = imported_modules(path)
            top_level |= module_level
            anywhere |= all_imports
        third_party = anywhere - set(sys.stdlib_module_names) - {"memoria_engine"}
        self.assertEqual(anywhere & network, set())
        self.assertEqual(third_party, {"mlx_lm"})
        self.assertEqual(top_level & third_party, set())
        self.observe(f"no socket call during the run; {len(files)} modules import nothing network-capable; the only third-party import is a lazy mlx_lm")

    def test_seeded_mutations_of_model_replies_never_abort_a_meeting_or_break_the_ledger(self):
        """TC-ERR-70 | NFR-Robustness, FR3 | Input: 200 seeded mutations (junk values of random JSON types in random places, deleted, inserted or truncated characters) of a valid three-event reply, each ingested into a fresh pipeline | Expected: ingest never raises, only the five documented statuses appear, invariants hold and every stored fact cites the exact transcript span"""
        rng = random.Random(20260301)
        document = {"events": GOOD}
        allowed = {"ungrounded", "invalid", "unresolved", "applied", "proposed"}
        raised, examples = {}, {}
        for i in range(200):
            text = json.dumps(mutate_structure(rng, document)) if i % 2 == 0 else mutate_text(rng, reply(*GOOD, fence=i % 4 == 1))
            pipe = new_pipeline(ScriptedLLM({"m1": text}))
            try:
                result = pipe.ingest(JAN)
            except Exception as exc:
                raised[type(exc).__name__] = raised.get(type(exc).__name__, 0) + 1
                examples.setdefault(type(exc).__name__, text)
                continue
            self.assertLessEqual(set(statuses(result)), allowed)
            self.assertEqual(pipe.ledger.check_invariants(), [], text)
            traceable_evidence(self, pipe, [JAN])
        self.observe("200 mutated replies ingested, ingest raised in " + (f"{sum(raised.values())} of them {raised}" if raised else "none of them"))
        self.assertEqual(examples, {})
