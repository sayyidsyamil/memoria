"""Bitemporal ledger for meeting decisions and commitments (SQLite, stdlib only).

* A *fact* is an immutable claim about one slot (object, attribute, discriminator): "from
  claim_from [until claim_to] the value is v", said at decided_at, with evidence (source, span,
  speaker, audio time).
* The fact in force at a valid time is the latest *decided* covering claim (envelope.py), so a late
  import of an older meeting can never override a newer decision.
* `validity` stores that outcome as bitemporal pieces. Supersession expires the old piece and inserts
  the closed old piece plus the new one. Rows are never edited or deleted, so "what did we believe
  at transaction time T?" always has an answer.
* Every successful write is also appended to a JSONL log; SQLite can be rebuilt by replaying it.

Times are integer microseconds since the epoch (UTC). None means "forever" for valid_to / claim_to.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import time
import unicodedata
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple, Union

from .envelope import Claim, envelope, piece_at

SCHEMA_VERSION = 1
KIND_HINTS = ("REVISE", "REVERSE", "CANCEL", "COMPLETE")
MEETING_ATTRIBUTES = (
    ("outcome", "one"),
    ("owner", "one"),
    ("deliverable", "one"),
    ("deadline", "one"),
    ("status", "one"),
    ("amount", "one"),
    ("participants", "many"),
)
_APPEND_ONLY = (
    "sources", "entities", "entity_aliases", "attribute_defs", "objects",
    "facts", "evidence", "retractions", "proposals", "reviews",
)
_EVIDENCE_COLUMNS = (
    "source_id", "span_text", "speaker_id", "char_start", "char_end",
    "audio_start", "audio_end", "asr_model", "extractor_model", "confidence",
)
_UNSET = object()
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


class LedgerError(Exception):
    pass


class UnknownReference(LedgerError):
    pass


class InvalidAssertion(LedgerError):
    pass


class AliasConflict(LedgerError):
    pass


class StaleProposal(LedgerError):
    pass


class AlreadyDone(LedgerError):
    pass


class LogCorrupt(LedgerError):
    pass


def ts(iso: str) -> int:
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    delta = d - _EPOCH
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def canon(value: Any) -> str:
    """Canonical JSON, so equal values compare equal as strings."""
    def norm(v: Any) -> Any:
        if v is None or isinstance(v, (bool, int, str)):
            return v
        if isinstance(v, float):
            if not math.isfinite(v):
                raise InvalidAssertion("NaN and Infinity are not valid values")
            return int(v) if v.is_integer() else v
        if isinstance(v, (list, tuple)):
            return [norm(x) for x in v]
        if isinstance(v, dict):
            if not all(isinstance(k, str) for k in v):
                raise InvalidAssertion("object keys must be strings")
            return {k: norm(x) for k, x in v.items()}
        raise InvalidAssertion(f"unsupported value type {type(v).__name__}")

    return json.dumps(norm(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def norm_alias(text: str) -> str:
    s = unicodedata.normalize("NFKC", text).casefold()
    s = re.sub(r"\s+", " ", s).strip(" \t\n.,;:!?\"'()[]{}")
    if not s:
        raise InvalidAssertion("alias is empty after normalisation")
    return s


@dataclass(frozen=True)
class Evidence:
    source_id: str
    span_text: str
    speaker_id: Optional[str] = None
    char_start: Optional[int] = None
    char_end: Optional[int] = None
    audio_start: Optional[float] = None  # seconds from the start of the source chunk
    audio_end: Optional[float] = None
    asr_model: Optional[str] = None
    extractor_model: Optional[str] = None
    confidence: Optional[float] = None


@dataclass(frozen=True)
class Belief:
    fact_id: int
    value: Any
    valid_from: int
    valid_to: Optional[int]
    tx_start: int
    tx_end: Optional[int]
    decided_at: int
    change_type: str


@dataclass(frozen=True)
class AssertOutcome:
    fact_id: int
    status: str  # 'in_force' | 'reconfirmed' (same value already in force) | 'not_in_force'
    supersedes_fact_id: Optional[int]
    confirms_fact_id: Optional[int]
    tx: int


def _evidence_args(evidence: Union[Evidence, Sequence[Evidence]]) -> List[Dict[str, Any]]:
    items = [evidence] if isinstance(evidence, Evidence) else list(evidence)
    return [asdict(e) for e in items]


def _nonempty(value: Any, what: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InvalidAssertion(f"{what} must be a non-empty string")
    return value


class Ledger:
    def __init__(
        self,
        db_path: str = ":memory:",
        *,
        log_path: Optional[str] = None,
        clock: Optional[Callable[[], int]] = None,
    ) -> None:
        self._clock = clock or (lambda: time.time_ns() // 1000)
        self._log_path = Path(log_path) if log_path else None
        self._db = sqlite3.connect(db_path, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        if db_path != ":memory:":
            self._db.execute("PRAGMA journal_mode = WAL")
        self._handlers = {
            "add_source": self._op_add_source,
            "add_entity": self._op_add_entity,
            "add_alias": self._op_add_alias,
            "define_attribute": self._op_define_attribute,
            "create_object": self._op_create_object,
            "assert_fact": self._op_assert_fact,
            "retract": self._op_retract,
            "correct": self._op_correct,
            "propose": self._op_propose,
            "accept": self._op_accept,
            "reject": self._op_reject,
        }
        self._noop = False
        self._log_mark: Optional[int] = None  # log size before the record being written, to undo a failed write
        self._init_schema()
        self._catch_up_from_log()

    def close(self) -> None:
        self._db.close()

    def __enter__(self) -> "Ledger":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # ---- setup -------------------------------------------------------------------------------

    def _init_schema(self) -> None:
        exists = self._db.execute("SELECT 1 FROM sqlite_master WHERE name = 'meta'").fetchone()
        if exists:
            return
        triggers = "\n".join(
            f"CREATE TRIGGER {t}_no_update BEFORE UPDATE ON {t} BEGIN SELECT RAISE(ABORT, '{t} is append-only'); END;\n"
            f"CREATE TRIGGER {t}_no_delete BEFORE DELETE ON {t} BEGIN SELECT RAISE(ABORT, '{t} is append-only'); END;"
            for t in _APPEND_ONLY
        )
        ddl = (Path(__file__).with_name("schema.sql")).read_text(encoding="utf-8")
        seed = (
            f"INSERT INTO meta VALUES ('schema_version', {SCHEMA_VERSION});\n"
            "INSERT INTO meta VALUES ('last_tx', 0);\nINSERT INTO meta VALUES ('last_seq', 0);"
        )
        try:
            self._db.executescript(f"BEGIN;\n{ddl}\n{triggers}\n{seed}\nCOMMIT;")
        except BaseException:
            if self._db.in_transaction:
                self._db.execute("ROLLBACK")
            raise

    @contextmanager
    def _txn(self) -> Iterator[None]:
        self._db.execute("BEGIN IMMEDIATE")
        self._log_mark = None
        try:
            yield
            self._db.execute("COMMIT")
        except BaseException:
            self._unwind_log()  # a record whose write failed must not stay in the log
            if self._db.in_transaction:
                self._db.execute("ROLLBACK")
            raise
        self._log_mark = None

    def _unwind_log(self) -> None:
        mark, self._log_mark = self._log_mark, None
        if mark is not None and self._log_path is not None:
            try:
                os.truncate(self._log_path, mark)
            except OSError:
                pass

    def _meta(self, key: str) -> int:
        return self._db.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()[0]

    def _set_meta(self, key: str, value: int) -> None:
        self._db.execute("UPDATE meta SET value = ? WHERE key = ?", (value, key))

    # ---- write path and event log ------------------------------------------------------------

    def _write(self, op: str, args: Dict[str, Any]) -> Any:
        with self._txn():
            self._noop = False
            tx = max(self._clock(), self._meta("last_tx") + 1)
            result = self._handlers[op](tx, args)
            if self._noop:  # an idempotent "ensure it exists" that found it: nothing to record
                return result
            self._set_meta("last_tx", tx)
            seq = self._meta("last_seq") + 1
            self._append_log(seq, tx, op, args)
            self._set_meta("last_seq", seq)
        return result

    def _append_log(self, seq: int, tx: int, op: str, args: Dict[str, Any]) -> None:
        if self._log_path is None:
            return
        line = json.dumps(
            {"seq": seq, "tx": tx, "op": op, "args": args},
            sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        )
        with open(self._log_path, "a", encoding="utf-8") as f:
            self._log_mark = os.fstat(f.fileno()).st_size
            f.write(line + "\n")
            f.flush()
            os.fsync(f.fileno())

    def _read_log(self) -> List[Dict[str, Any]]:
        path = self._log_path
        if path is None or not path.exists():
            return []
        raw = path.read_bytes()
        end = raw.rfind(b"\n") + 1
        if end < len(raw):  # a write that never reached COMMIT: drop it
            with open(path, "r+b") as f:
                f.truncate(end)
            raw = raw[:end]
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise LogCorrupt("the log is not valid UTF-8") from exc
        events = []
        # records end at "\n" only: str.splitlines() would also cut at U+2028, U+2029 and U+0085 inside a record
        for n, line in enumerate(text.split("\n")[:-1], start=1):
            try:
                event = json.loads(line)
            except (ValueError, RecursionError) as exc:
                raise LogCorrupt(f"log line {n} is not valid JSON") from exc
            if not isinstance(event, dict) or event.get("seq") != n or event.get("op") not in self._handlers:
                raise LogCorrupt(f"log line {n}: unexpected sequence number or operation")
            events.append(event)
        return events

    def _catch_up_from_log(self) -> None:
        if self._log_path is None:
            return
        events = self._read_log()
        done = self._meta("last_seq")
        if done > len(events):
            raise LogCorrupt(f"database has {done} events but the log has only {len(events)}")
        for event in events[done:]:
            try:
                with self._txn():
                    self._handlers[event["op"]](event["tx"], event["args"])
                    self._set_meta("last_tx", max(self._meta("last_tx"), event["tx"]))
                    self._set_meta("last_seq", event["seq"])
            except LogCorrupt:
                raise
            except (LedgerError, KeyError, TypeError, AttributeError, ValueError, OverflowError,
                    sqlite3.IntegrityError, sqlite3.ProgrammingError, sqlite3.InterfaceError) as exc:
                raise LogCorrupt(f"log line {event['seq']} cannot be replayed: {exc!r}") from exc

    # ---- reference data ----------------------------------------------------------------------

    def add_source(
        self, content: Union[bytes, str], meeting_id: str, occurred_at: int,
        *, uri: Optional[str] = None, git_commit: Optional[str] = None,
    ) -> str:
        data = content.encode("utf-8") if isinstance(content, str) else content
        return self._write("add_source", {
            "source_id": hashlib.sha256(data).hexdigest(), "meeting_id": meeting_id,
            "occurred_at": occurred_at, "uri": uri, "git_commit": git_commit,
        })

    def add_entity(self, entity_id: str, kind: str, canonical_name: str) -> None:
        self._write("add_entity", {"entity_id": entity_id, "kind": kind, "canonical_name": canonical_name})

    def add_alias(self, alias: str, entity_id: str, *, lang: Optional[str] = None) -> str:
        return self._write("add_alias", {"alias": alias, "entity_id": entity_id, "lang": lang})

    def resolve_alias(self, text: str) -> Optional[str]:
        row = self._db.execute(
            "SELECT entity_id FROM entity_aliases WHERE alias_norm = ?", (norm_alias(text),)
        ).fetchone()
        return row[0] if row else None

    def define_attribute(self, attribute: str, cardinality: str = "one") -> None:
        self._write("define_attribute", {"attribute": attribute, "cardinality": cardinality})

    def define_meeting_attributes(self) -> None:
        for attribute, cardinality in MEETING_ATTRIBUTES:
            self.define_attribute(attribute, cardinality)

    def create_object(
        self, object_id: str, kind: str, *, label: Optional[str] = None, issue_id: Optional[str] = None
    ) -> None:
        self._write("create_object", {"object_id": object_id, "kind": kind, "label": label, "issue_id": issue_id})

    def _op_add_source(self, tx: int, a: Dict[str, Any]) -> str:
        _nonempty(a["meeting_id"], "meeting_id")
        if not isinstance(a["occurred_at"], int) or isinstance(a["occurred_at"], bool):
            raise InvalidAssertion("occurred_at must be an integer (microseconds since epoch)")
        row = self._db.execute(
            "SELECT meeting_id, occurred_at FROM sources WHERE source_id = ?", (a["source_id"],)
        ).fetchone()
        if row:
            if (row["meeting_id"], row["occurred_at"]) != (a["meeting_id"], a["occurred_at"]):
                raise InvalidAssertion("source already recorded with different metadata")
            self._noop = True
            return a["source_id"]
        self._db.execute(
            "INSERT INTO sources(source_id, meeting_id, occurred_at, uri, git_commit) VALUES (?,?,?,?,?)",
            (a["source_id"], a["meeting_id"], a["occurred_at"], a["uri"], a["git_commit"]),
        )
        return a["source_id"]

    def _op_add_entity(self, tx: int, a: Dict[str, Any]) -> None:
        for key in ("entity_id", "kind", "canonical_name"):
            _nonempty(a[key], key)
        row = self._db.execute("SELECT kind, canonical_name FROM entities WHERE entity_id = ?", (a["entity_id"],)).fetchone()
        if row:
            if (row["kind"], row["canonical_name"]) != (a["kind"], a["canonical_name"]):
                raise InvalidAssertion(f"entity {a['entity_id']!r} already exists with different details")
            self._noop = True
            return
        self._db.execute(
            "INSERT INTO entities(entity_id, kind, canonical_name) VALUES (?,?,?)",
            (a["entity_id"], a["kind"], a["canonical_name"]),
        )

    def _op_add_alias(self, tx: int, a: Dict[str, Any]) -> str:
        norm = norm_alias(a["alias"])
        self._require("entities", "entity_id", a["entity_id"])
        row = self._db.execute("SELECT entity_id FROM entity_aliases WHERE alias_norm = ?", (norm,)).fetchone()
        if row:
            if row["entity_id"] != a["entity_id"]:
                raise AliasConflict(f"{norm!r} already refers to {row['entity_id']!r}")
            self._noop = True
            return norm
        self._db.execute(
            "INSERT INTO entity_aliases(alias_norm, entity_id, lang) VALUES (?,?,?)",
            (norm, a["entity_id"], a["lang"]),
        )
        return norm

    def _op_define_attribute(self, tx: int, a: Dict[str, Any]) -> None:
        _nonempty(a["attribute"], "attribute")
        if a["cardinality"] not in ("one", "many"):
            raise InvalidAssertion("cardinality must be 'one' or 'many'")
        row = self._db.execute("SELECT cardinality FROM attribute_defs WHERE attribute = ?", (a["attribute"],)).fetchone()
        if row:
            if row[0] != a["cardinality"]:
                raise InvalidAssertion(f"attribute {a['attribute']!r} is already defined as {row[0]!r}")
            self._noop = True
            return
        self._db.execute("INSERT INTO attribute_defs VALUES (?,?)", (a["attribute"], a["cardinality"]))

    def _op_create_object(self, tx: int, a: Dict[str, Any]) -> None:
        _nonempty(a["object_id"], "object_id")
        if a["issue_id"] is not None:
            self._require("objects", "object_id", a["issue_id"])
        row = self._db.execute("SELECT kind, issue_id, label FROM objects WHERE object_id = ?", (a["object_id"],)).fetchone()
        if row:
            if tuple(row) != (a["kind"], a["issue_id"], a["label"]):
                raise InvalidAssertion(f"object {a['object_id']!r} already exists with different details")
            self._noop = True
            return
        if a["kind"] not in ("issue", "decision", "commitment"):
            raise InvalidAssertion("kind must be 'issue', 'decision' or 'commitment'")
        self._db.execute(
            "INSERT INTO objects(object_id, kind, issue_id, label) VALUES (?,?,?,?)",
            (a["object_id"], a["kind"], a["issue_id"], a["label"]),
        )

    # ---- facts: assert, retract, correct -----------------------------------------------------

    def assert_fact(
        self, object_id: str, attribute: str, value: Any,
        evidence: Union[Evidence, Sequence[Evidence]],
        *, discriminator: str = "", valid_from: Optional[int] = None,
        valid_to: Optional[int] = None, kind_hint: Optional[str] = None,
    ) -> AssertOutcome:
        return self._write("assert_fact", self._assert_args(
            object_id, attribute, value, evidence, discriminator, valid_from, valid_to, kind_hint))

    def retract(self, fact_id: int, reviewer: str, reason: str) -> None:
        self._write("retract", {"fact_id": fact_id, "reviewer": reviewer, "reason": reason})

    def correct(
        self, fact_id: int, reviewer: str, reason: str, *,
        value: Any = _UNSET, valid_from: Any = _UNSET, valid_to: Any = _UNSET,
        evidence: Optional[Union[Evidence, Sequence[Evidence]]] = None,
    ) -> AssertOutcome:
        changes = {k: v for k, v in (("value", value), ("valid_from", valid_from), ("valid_to", valid_to)) if v is not _UNSET}
        return self._write("correct", {
            "fact_id": fact_id, "reviewer": reviewer, "reason": reason, "changes": changes,
            "evidence": _evidence_args(evidence) if evidence is not None else None,
        })

    @staticmethod
    def _assert_args(object_id, attribute, value, evidence, discriminator, valid_from, valid_to, kind_hint):
        return {
            "object_id": object_id, "attribute": attribute, "discriminator": discriminator,
            "value": value, "evidence": _evidence_args(evidence),
            "valid_from": valid_from, "valid_to": valid_to, "kind_hint": kind_hint,
        }

    def _op_assert_fact(self, tx: int, a: Dict[str, Any]) -> AssertOutcome:
        return self._insert_fact(tx, self._prepare(a))

    def _op_retract(self, tx: int, a: Dict[str, Any]) -> None:
        fact = self._fact_row(a["fact_id"])
        self._not_retracted(a["fact_id"])
        self._insert_retraction(tx, a["fact_id"], a["reviewer"], a["reason"])
        slot = (fact["object_id"], fact["attribute"], fact["discriminator"])
        self._reconcile(tx, slot, envelope(self._claims(slot)))

    def _op_correct(self, tx: int, a: Dict[str, Any]) -> AssertOutcome:
        old = self._fact_row(a["fact_id"])
        self._not_retracted(a["fact_id"])
        _nonempty(a["reason"], "reason")
        changes = a["changes"]
        if set(changes) - {"value", "valid_from", "valid_to"}:
            raise InvalidAssertion("only value, valid_from and valid_to can be corrected")
        evidence = a["evidence"]
        if evidence is None:
            evidence = [dict(r) for r in self._db.execute(
                f"SELECT {', '.join(_EVIDENCE_COLUMNS)} FROM evidence WHERE fact_id = ? ORDER BY evidence_id",
                (old["fact_id"],))]
        prepared = self._prepare({
            "object_id": old["object_id"], "attribute": old["attribute"], "discriminator": old["discriminator"],
            "value": changes["value"] if "value" in changes else json.loads(old["value_json"]),
            "evidence": evidence,
            "valid_from": changes["valid_from"] if "valid_from" in changes else old["claim_from"],
            "valid_to": changes["valid_to"] if "valid_to" in changes else old["claim_to"],
            "kind_hint": None,
        })
        if "valid_from" not in changes:
            prepared["basis"] = old["claim_from_basis"]
        self._insert_retraction(tx, old["fact_id"], a["reviewer"], f"corrected: {a['reason']}")
        return self._insert_fact(
            tx, prepared, corrects=old["fact_id"], inherit=(old["decided_at"], old["rank_seq"]))

    def _insert_retraction(self, tx: int, fact_id: int, reviewer: str, reason: str) -> None:
        _nonempty(reviewer, "reviewer")
        _nonempty(reason, "reason")
        self._db.execute("INSERT INTO retractions(fact_id, tx, reviewer, reason) VALUES (?,?,?,?)",
                         (fact_id, tx, reviewer, reason))

    def _prepare(self, a: Dict[str, Any]) -> Dict[str, Any]:
        obj, attr, disc = a["object_id"], a["attribute"], a["discriminator"]
        self._require("objects", "object_id", obj)
        row = self._db.execute("SELECT cardinality FROM attribute_defs WHERE attribute = ?", (attr,)).fetchone()
        if row is None:
            raise UnknownReference(f"attribute {attr!r} is not defined")
        if not isinstance(disc, str):
            raise InvalidAssertion("discriminator must be a string")
        if row[0] == "one" and disc != "":
            raise InvalidAssertion(f"{attr!r} is single-valued: no discriminator allowed")
        if row[0] == "many" and disc == "":
            raise InvalidAssertion(f"{attr!r} is multi-valued: a discriminator is required")
        evidence = [Evidence(**e) for e in a["evidence"]]
        if not evidence:
            raise InvalidAssertion("a fact needs at least one piece of evidence")
        for e in evidence:
            _nonempty(e.span_text, "evidence span_text")
            self._require("sources", "source_id", e.source_id)
        occurred = self._db.execute(
            "SELECT occurred_at FROM sources WHERE source_id = ?", (evidence[0].source_id,)).fetchone()[0]
        decided_at = occurred + round((evidence[0].audio_start or 0.0) * 1_000_000)
        valid_from, valid_to = a["valid_from"], a["valid_to"]
        for what, bound in (("valid_from", valid_from), ("valid_to", valid_to)):
            if bound is not None and (isinstance(bound, bool) or not isinstance(bound, int) or not -2**63 <= bound < 2**63):
                raise InvalidAssertion(f"{what} must be an integer number of microseconds or None")
        basis = "meeting_time" if valid_from is None else "stated"
        if valid_from is None:
            valid_from = decided_at
        if valid_to is not None and valid_to <= valid_from:
            raise InvalidAssertion("valid_to must be after valid_from")
        if a.get("kind_hint") not in (None,) + KIND_HINTS:
            raise InvalidAssertion(f"kind_hint must be one of {KIND_HINTS}")
        return {
            "slot": (obj, attr, disc), "value_json": canon(a["value"]), "evidence": evidence,
            "decided_at": decided_at, "valid_from": valid_from, "valid_to": valid_to,
            "basis": basis, "hint": a.get("kind_hint"),
        }

    def _insert_fact(
        self, tx: int, p: Dict[str, Any], *, corrects: Optional[int] = None,
        inherit: Optional[Tuple[int, int]] = None,
    ) -> AssertOutcome:
        slot = p["slot"]
        claims = self._claims(slot)
        decided_at, rank_seq = inherit if inherit else (p["decided_at"], self._next_rank())
        rank = (decided_at, rank_seq)
        supersedes = confirms = None
        change_type = "INITIAL"
        winner = piece_at(envelope(claims), p["valid_from"])
        if winner is not None:
            w = self._fact_row(winner.fact_id)
            if w["value_json"] == p["value_json"]:
                confirms, change_type = winner.fact_id, "CONFIRM"
            elif (w["decided_at"], w["rank_seq"]) < rank:
                supersedes, change_type = winner.fact_id, p["hint"] or "REVISE"
        elif p["hint"] in ("CANCEL", "COMPLETE"):  # lifecycle transitions mean the same with no earlier status
            change_type = p["hint"]
        if corrects is not None:
            change_type = "CORRECT"
        fact_id = self._db.execute(
            "INSERT INTO facts(object_id, attribute, discriminator, value_json, claim_from, claim_to, "
            "decided_at, rank_seq, change_type, claim_from_basis, supersedes_fact_id, confirms_fact_id, "
            "corrects_fact_id, recorded_tx) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (*slot, p["value_json"], p["valid_from"], p["valid_to"], decided_at, rank_seq, change_type,
             p["basis"], supersedes, confirms, corrects, tx),
        ).lastrowid
        for e in p["evidence"]:
            self._db.execute(
                f"INSERT INTO evidence(fact_id, {', '.join(_EVIDENCE_COLUMNS)}, recorded_tx) "
                f"VALUES (?,{','.join('?' * len(_EVIDENCE_COLUMNS))},?)",
                (fact_id, *(getattr(e, c) for c in _EVIDENCE_COLUMNS), tx),
            )
        pieces = envelope(claims + [Claim(fact_id, rank, p["value_json"], p["valid_from"], p["valid_to"])])
        self._reconcile(tx, slot, pieces)
        if any(pc.fact_id == fact_id for pc in pieces):
            status = "in_force"
        else:
            status = "reconfirmed" if confirms is not None else "not_in_force"
        return AssertOutcome(fact_id, status, supersedes, confirms, tx)

    def _reconcile(self, tx: int, slot: Tuple[str, str, str], pieces: Sequence[Any]) -> None:
        current = {
            (r["fact_id"], r["valid_from"], r["valid_to"]): r["validity_id"]
            for r in self._db.execute(
                "SELECT validity_id, fact_id, valid_from, valid_to FROM validity "
                "WHERE object_id = ? AND attribute = ? AND discriminator = ? AND tx_end IS NULL", slot)
        }
        wanted = {(p.fact_id, p.start, p.end) for p in pieces}
        for key, validity_id in current.items():
            if key not in wanted:
                self._db.execute("UPDATE validity SET tx_end = ? WHERE validity_id = ?", (tx, validity_id))
        for fact_id, start, end in sorted(wanted - set(current), key=lambda k: (k[1], k[0])):
            self._db.execute(
                "INSERT INTO validity(fact_id, object_id, attribute, discriminator, valid_from, valid_to, tx_start) "
                "VALUES (?,?,?,?,?,?,?)", (fact_id, *slot, start, end, tx))

    def _claims(self, slot: Tuple[str, str, str]) -> List[Claim]:
        rows = self._db.execute(
            "SELECT fact_id, decided_at, rank_seq, value_json, claim_from, claim_to FROM facts "
            "WHERE object_id = ? AND attribute = ? AND discriminator = ? "
            "AND fact_id NOT IN (SELECT fact_id FROM retractions)", slot).fetchall()
        return [Claim(r[0], (r[1], r[2]), r[3], r[4], r[5]) for r in rows]

    def _next_rank(self) -> int:
        return self._db.execute("SELECT COALESCE(MAX(rank_seq), 0) + 1 FROM facts").fetchone()[0]

    def _require(self, table: str, column: str, value: Any) -> None:
        if self._db.execute(f"SELECT 1 FROM {table} WHERE {column} = ?", (value,)).fetchone() is None:
            raise UnknownReference(f"unknown {table[:-1] if table.endswith('s') else table}: {value!r}")

    def _fact_row(self, fact_id: int) -> sqlite3.Row:
        row = self._db.execute("SELECT * FROM facts WHERE fact_id = ?", (fact_id,)).fetchone()
        if row is None:
            raise UnknownReference(f"unknown fact: {fact_id!r}")
        return row

    def _not_retracted(self, fact_id: int) -> None:
        if self._db.execute("SELECT 1 FROM retractions WHERE fact_id = ?", (fact_id,)).fetchone():
            raise AlreadyDone(f"fact {fact_id} is already retracted")

    # ---- human confirmation ------------------------------------------------------------------

    def propose(
        self, object_id: str, attribute: str, value: Any,
        evidence: Union[Evidence, Sequence[Evidence]],
        *, discriminator: str = "", valid_from: Optional[int] = None, valid_to: Optional[int] = None,
        kind_hint: Optional[str] = None, confidence: Optional[float] = None, reason: Optional[str] = None,
    ) -> int:
        return self._write("propose", {
            "assert": self._assert_args(object_id, attribute, value, evidence, discriminator, valid_from, valid_to, kind_hint),
            "confidence": confidence, "reason": reason,
        })

    def accept(self, proposal_id: int, reviewer: str, *, edits: Optional[Dict[str, Any]] = None,
               note: Optional[str] = None) -> AssertOutcome:
        return self._write("accept", {"proposal_id": proposal_id, "reviewer": reviewer, "edits": edits or {}, "note": note})

    def reject(self, proposal_id: int, reviewer: str, note: Optional[str] = None) -> None:
        self._write("reject", {"proposal_id": proposal_id, "reviewer": reviewer, "note": note})

    def _op_propose(self, tx: int, a: Dict[str, Any]) -> int:
        p = self._prepare(a["assert"])
        winner = piece_at(envelope(self._claims(p["slot"])), p["valid_from"])
        return self._db.execute(
            "INSERT INTO proposals(created_tx, payload_json, base_fact_id, confidence, reason) VALUES (?,?,?,?,?)",
            (tx, json.dumps(a["assert"], sort_keys=True, ensure_ascii=False),
             winner.fact_id if winner else None, a["confidence"], a["reason"]),
        ).lastrowid

    def _open_proposal(self, proposal_id: int, reviewer: str) -> sqlite3.Row:
        _nonempty(reviewer, "reviewer")
        row = self._db.execute("SELECT * FROM proposals WHERE proposal_id = ?", (proposal_id,)).fetchone()
        if row is None:
            raise UnknownReference(f"unknown proposal: {proposal_id!r}")
        if self._db.execute("SELECT 1 FROM reviews WHERE proposal_id = ?", (proposal_id,)).fetchone():
            raise AlreadyDone(f"proposal {proposal_id} has already been reviewed")
        return row

    def _op_accept(self, tx: int, a: Dict[str, Any]) -> AssertOutcome:
        proposal = self._open_proposal(a["proposal_id"], a["reviewer"])
        args = json.loads(proposal["payload_json"])
        original = self._prepare(args)
        winner = piece_at(envelope(self._claims(original["slot"])), original["valid_from"])
        if (winner.fact_id if winner else None) != proposal["base_fact_id"]:
            raise StaleProposal(f"proposal {a['proposal_id']} was made against a belief that has since changed")
        edits = a["edits"]
        if set(edits) - {"value", "valid_from", "valid_to", "kind_hint"}:
            raise InvalidAssertion("only value, valid_from, valid_to and kind_hint can be edited")
        edited = self._prepare({**args, **edits})
        changed = any(original[k] != edited[k] for k in ("value_json", "valid_from", "valid_to", "hint"))
        outcome = self._insert_fact(tx, edited)
        self._db.execute(
            "INSERT INTO reviews(proposal_id, reviewer, outcome, note, resulting_fact_id, tx) VALUES (?,?,?,?,?,?)",
            (a["proposal_id"], a["reviewer"], "accepted_edited" if changed else "accepted",
             a["note"], outcome.fact_id, tx))
        return outcome

    def _op_reject(self, tx: int, a: Dict[str, Any]) -> None:
        self._open_proposal(a["proposal_id"], a["reviewer"])
        self._db.execute(
            "INSERT INTO reviews(proposal_id, reviewer, outcome, note, resulting_fact_id, tx) VALUES (?,?,?,?,NULL,?)",
            (a["proposal_id"], a["reviewer"], "rejected", a["note"], tx))

    def sources(self) -> List[Dict[str, Any]]:
        """Every meeting source ever added: source_id (content hash), meeting_id, occurred_at (microseconds)."""
        return [dict(r) for r in self._db.execute("SELECT source_id, meeting_id, occurred_at FROM sources ORDER BY occurred_at, source_id")]

    def pending_proposals(self) -> List[Dict[str, Any]]:
        rows = self._db.execute(
            "SELECT proposal_id, created_tx, payload_json, base_fact_id, confidence, reason FROM proposals "
            "WHERE proposal_id NOT IN (SELECT proposal_id FROM reviews) ORDER BY proposal_id")
        return [{**dict(r), "payload": json.loads(r["payload_json"])} for r in rows]

    def review_stats(self) -> Dict[str, Any]:
        counts = {r[0]: r[1] for r in self._db.execute("SELECT outcome, COUNT(*) FROM reviews GROUP BY outcome")}
        accepted, edited, rejected = (counts.get(k, 0) for k in ("accepted", "accepted_edited", "rejected"))
        reviewed = accepted + edited + rejected
        pending = self._db.execute(
            "SELECT COUNT(*) FROM proposals WHERE proposal_id NOT IN (SELECT proposal_id FROM reviews)").fetchone()[0]
        return {
            "pending": pending, "reviewed": reviewed, "accepted": accepted,
            "accepted_edited": edited, "rejected": rejected,
            "acceptance_rate": accepted / reviewed if reviewed else None,
            "acceptance_rate_incl_edits": (accepted + edited) / reviewed if reviewed else None,
        }

    # ---- reads -------------------------------------------------------------------------------

    _BELIEF_SELECT = (
        "SELECT v.fact_id, f.value_json, v.valid_from, v.valid_to, v.tx_start, v.tx_end, f.decided_at, f.change_type "
        "FROM validity v JOIN facts f ON f.fact_id = v.fact_id "
        "WHERE v.object_id = ? AND v.attribute = ? AND v.discriminator = ?"
    )

    @staticmethod
    def _belief(r: sqlite3.Row) -> Belief:
        return Belief(r["fact_id"], json.loads(r["value_json"]), r["valid_from"], r["valid_to"],
                      r["tx_start"], r["tx_end"], r["decided_at"], r["change_type"])

    @staticmethod
    def _tx_filter(tx_at: Optional[int]) -> Tuple[str, List[int]]:
        if tx_at is None:
            return " AND v.tx_end IS NULL", []
        return " AND v.tx_start <= ? AND (v.tx_end IS NULL OR v.tx_end > ?)", [tx_at, tx_at]

    def current(self, object_id: str, attribute: str, *, discriminator: str = "") -> Optional[Belief]:
        """The open-ended belief: what is expected to hold from the latest decision onward."""
        row = self._db.execute(
            self._BELIEF_SELECT + " AND v.tx_end IS NULL AND v.valid_to IS NULL",
            (object_id, attribute, discriminator)).fetchone()
        return self._belief(row) if row else None

    def as_of(self, object_id: str, attribute: str, *, valid_at: int, tx_at: Optional[int] = None,
              discriminator: str = "") -> Optional[Belief]:
        """What did we believe at tx_at (default: now) was true at valid_at?"""
        tx_sql, tx_params = self._tx_filter(tx_at)
        rows = self._db.execute(
            self._BELIEF_SELECT + " AND v.valid_from <= ? AND (v.valid_to IS NULL OR v.valid_to > ?)" + tx_sql,
            (object_id, attribute, discriminator, valid_at, valid_at, *tx_params)).fetchall()
        if len(rows) > 1:
            raise LedgerError("overlapping beliefs for one slot: invariant violated")
        return self._belief(rows[0]) if rows else None

    def timeline(self, object_id: str, attribute: str, *, tx_at: Optional[int] = None,
                 discriminator: str = "") -> List[Belief]:
        tx_sql, tx_params = self._tx_filter(tx_at)
        rows = self._db.execute(
            self._BELIEF_SELECT + tx_sql + " ORDER BY v.valid_from",
            (object_id, attribute, discriminator, *tx_params))
        return [self._belief(r) for r in rows]

    def history(self, object_id: str, attribute: str, *, discriminator: str = "") -> List[Dict[str, Any]]:
        """Every claim ever made about the slot, retracted or not, with its evidence."""
        out = []
        for f in self._db.execute(
            "SELECT f.*, r.tx AS retracted_tx, r.reviewer AS retracted_by, r.reason AS retracted_reason "
            "FROM facts f LEFT JOIN retractions r ON r.fact_id = f.fact_id "
            "WHERE f.object_id = ? AND f.attribute = ? AND f.discriminator = ? "
            "ORDER BY f.decided_at, f.rank_seq, f.fact_id", (object_id, attribute, discriminator)).fetchall():
            evidence = [dict(e) for e in self._db.execute(
                f"SELECT {', '.join(_EVIDENCE_COLUMNS)} FROM evidence WHERE fact_id = ? ORDER BY evidence_id",
                (f["fact_id"],))]
            out.append({
                "fact_id": f["fact_id"], "value": json.loads(f["value_json"]),
                "claim_from": f["claim_from"], "claim_to": f["claim_to"], "decided_at": f["decided_at"],
                "change_type": f["change_type"], "claim_from_basis": f["claim_from_basis"],
                "supersedes_fact_id": f["supersedes_fact_id"], "confirms_fact_id": f["confirms_fact_id"],
                "corrects_fact_id": f["corrects_fact_id"], "recorded_tx": f["recorded_tx"],
                "retracted": None if f["retracted_tx"] is None else {
                    "tx": f["retracted_tx"], "by": f["retracted_by"], "reason": f["retracted_reason"]},
                "evidence": evidence,
            })
        return out

    # ---- verification ------------------------------------------------------------------------

    def check_invariants(self) -> List[str]:
        problems: List[str] = []
        slots = [tuple(r) for r in self._db.execute("SELECT DISTINCT object_id, attribute, discriminator FROM facts")]
        for slot in slots:
            want = {(p.fact_id, p.start, p.end) for p in envelope(self._claims(slot))}
            have = {tuple(r) for r in self._db.execute(
                "SELECT fact_id, valid_from, valid_to FROM validity "
                "WHERE object_id = ? AND attribute = ? AND discriminator = ? AND tx_end IS NULL", slot)}
            if want != have:
                problems.append(f"{slot}: current beliefs {sorted(have, key=str)} != claims' envelope {sorted(want, key=str)}")
            for fact_id, start, end in have:
                f = self._fact_row(fact_id)
                if not (f["claim_from"] <= start and (f["claim_to"] is None or (end is not None and f["claim_to"] >= end))):
                    problems.append(f"{slot}: piece [{start}, {end}) is not covered by fact {fact_id}'s claim")
            rows = self._db.execute(
                "SELECT valid_from, valid_to, tx_start, tx_end FROM validity "
                "WHERE object_id = ? AND attribute = ? AND discriminator = ?", slot).fetchall()
            boundaries = sorted({r["tx_start"] for r in rows} | {r["tx_end"] for r in rows if r["tx_end"] is not None})
            for t in boundaries:
                live = sorted((r["valid_from"], r["valid_to"]) for r in rows
                              if r["tx_start"] <= t and (r["tx_end"] is None or r["tx_end"] > t))
                for (_, a_end), (b_start, _) in zip(live, live[1:]):
                    if a_end is None or a_end > b_start:
                        problems.append(f"{slot}: overlapping beliefs at tx {t}")
        for (fact_id,) in self._db.execute("SELECT fact_id FROM facts WHERE fact_id NOT IN (SELECT fact_id FROM evidence)"):
            problems.append(f"fact {fact_id} has no evidence")
        return problems

    def dump(self) -> Dict[str, List[Tuple[Any, ...]]]:
        names = [r[0] for r in self._db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        return {n: [tuple(r) for r in self._db.execute(f"SELECT * FROM {n} ORDER BY 1")] for n in names}
