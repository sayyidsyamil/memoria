"""From a meeting transcript to ledger writes: extract, ground, validate, then apply or propose.

Rules the pipeline enforces whatever the extractor says:
* No evidence, no memory: a candidate whose quote cannot be located in the transcript is dropped.
* Closed-set linking: a candidate must name a known object and attribute, with a value that fits.
* Applied in transcript order, stamped with the meeting's ingestion time, evidence = the located span.
* A review policy decides which belief-changing candidates are applied at once and which wait for a
  human (the reviewer hook).
"""
from __future__ import annotations

import difflib
import math
import re
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .ledger import Evidence, Ledger, LedgerError, ts

STATE_CHANGING = ("INITIAL", "REVISE", "REVERSE", "CANCEL", "COMPLETE")
STATUS_KINDS = {"done": "COMPLETE", "cancelled": "CANCEL"}


# ---- what can be tracked ---------------------------------------------------------------------

@dataclass(frozen=True)
class AttributeSpec:
    name: str
    type: str  # enum | date | number | person | text
    values: Tuple[str, ...] = ()
    change_kind: str = "REVISE"  # 'REVERSE' for outcome-like attributes


@dataclass(frozen=True)
class ObjectSpec:
    object_id: str
    kind: str  # decision | commitment
    label: str
    attributes: Tuple[AttributeSpec, ...]

    def attribute(self, name: str) -> Optional[AttributeSpec]:
        return next((a for a in self.attributes if a.name == name), None)


@dataclass
class Registry:
    objects: Dict[str, ObjectSpec]
    people: Dict[str, str]  # person id -> display name

    def slots(self) -> List[Tuple[str, str]]:
        return [(o.object_id, a.name) for o in self.objects.values() for a in o.attributes]

    def spec(self, object_id: str, attribute: str) -> AttributeSpec:
        obj = self.objects.get(object_id)
        found = obj.attribute(attribute) if obj else None
        if found is None:
            raise KeyError(f"unknown slot {object_id}.{attribute}")
        return found

    def normalise(self, object_id: str, attribute: str, raw: Any) -> Any:
        spec = self.spec(object_id, attribute)
        if spec.type == "enum":
            wanted = str(raw).strip().casefold()
            for v in spec.values:
                if v.casefold() == wanted:
                    return v
            raise ValueError(f"{raw!r} is not one of {spec.values}")
        if spec.type == "date":
            return date.fromisoformat(str(raw).strip()).isoformat()
        if spec.type == "number":
            if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
                raise ValueError("a number is expected")
            try:
                n = raw if isinstance(raw, (int, float)) else float(re.sub(r"[^\d.\-]", "", raw) or "nan")
                finite = math.isfinite(n)
            except OverflowError:
                finite = False
            if not finite:
                raise ValueError(f"{raw!r} is not a finite number")
            return int(n) if float(n).is_integer() else n
        if spec.type == "person":
            wanted = str(raw).strip().casefold()
            for pid, name in self.people.items():
                if wanted in (pid.casefold(), name.casefold()):
                    return pid
            raise ValueError(f"{raw!r} is not a known person")
        return str(raw).strip()

    def install(self, ledger: Ledger) -> None:
        for name in sorted({a.name for o in self.objects.values() for a in o.attributes}):
            ledger.define_attribute(name, "one")
        for o in self.objects.values():
            ledger.create_object(o.object_id, o.kind, label=o.label)
        for pid, name in self.people.items():
            ledger.add_entity(pid, "person", name)
            ledger.add_alias(pid, pid)
            ledger.add_alias(name, pid)


# ---- transcripts -----------------------------------------------------------------------------

@dataclass(frozen=True)
class Turn:
    index: int
    speaker: str
    start: float  # seconds from the start of the meeting
    text: str


@dataclass(frozen=True)
class Meeting:
    meeting_id: str
    occurred_at: int  # microseconds since epoch
    ingested_at: int
    turns: Tuple[Turn, ...]

    @property
    def text(self) -> str:
        return "\n".join(f"[{t.index}] {t.speaker}: {t.text}" for t in self.turns)

    def spans(self) -> List[Tuple[int, int]]:
        out, pos = [], 0
        for t in self.turns:
            head = len(f"[{t.index}] {t.speaker}: ")
            out.append((pos + head, pos + head + len(t.text)))
            pos += head + len(t.text) + 1
        return out

    @property
    def date_iso(self) -> str:
        return time.strftime("%Y-%m-%d", time.gmtime(self.occurred_at / 1e6))


@dataclass
class MeetingContext:
    meeting: Meeting
    registry: Registry
    beliefs: Dict[Tuple[str, str], Any]  # what the ledger believed was in force at the meeting's time


@dataclass
class Candidate:
    object_id: Optional[str]
    attribute: Optional[str]
    value: Any
    quote: str
    turn: Optional[int] = None  # the extractor's own claim; grounding decides the real turn
    valid_from: Optional[str] = None
    confidence: Optional[float] = None
    unresolved: bool = False


def _confidence(x: Any) -> Optional[float]:
    """The extractor's confidence when it is a real number in [0, 1]; otherwise None, which reads as "not sure"."""
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    return x if 0 <= x <= 1 else None


# ---- grounding -------------------------------------------------------------------------------

def _tokens(text: str) -> List[str]:
    return re.findall(r"\w+", text.casefold())


def ground(meeting: Meeting, quote: str, hint_turn: Optional[int] = None) -> Optional[Tuple[int, int, int, bool]]:
    """(turn, char_start, char_end, exact) of the quote in the meeting text, or None."""
    words = [re.escape(w) for w in quote.strip().strip("\"'\u201c\u201d\u2018\u2019").split() if w]
    if not words:
        return None
    pattern = re.compile(r"\s+".join(words), re.IGNORECASE)
    text, spans = meeting.text, meeting.spans()
    order = list(range(len(spans)))
    if hint_turn in order:
        order.remove(hint_turn)
        order.insert(0, hint_turn)
    for i in order:
        m = pattern.search(text, *spans[i])
        if m:
            return i, m.start(), m.end(), True
    qt = _tokens(quote)
    if len(qt) < 3:
        return None
    best: Optional[Tuple[float, int]] = None
    for i, t in enumerate(meeting.turns):
        matched = sum(b.size for b in difflib.SequenceMatcher(None, qt, _tokens(t.text), autojunk=False).get_matching_blocks())
        coverage = matched / len(qt)
        if coverage >= 0.8 and (best is None or coverage > best[0]):
            best = (coverage, i)
    if best:
        return best[1], spans[best[1]][0], spans[best[1]][1], False
    return None


# ---- numbers in a quote ----------------------------------------------------------------------

_NUMBER = re.compile(r"(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|m|bn|million|thousand|billion)?(?![\w])", re.I)
_MAGNITUDE = {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6, "bn": 1e9, "billion": 1e9}


def numbers_in(text: str) -> List[float]:
    """Every number written with digits in the text: 250,000 / 2.5 million / RM2m / 250k, both with and without the magnitude word."""
    found: List[float] = []
    for whole, fraction, word in _NUMBER.findall(text):
        base = float(whole.replace(",", "") + ("." + fraction if fraction else ""))
        found.append(base)
        if word:
            found.append(base * _MAGNITUDE[word.lower()])
    return found


def number_not_in_quote(value: Any, text: str) -> bool:
    """True when the text contains numbers (digits) and the number-valued candidate matches none of them: a likely misreading."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    numbers = numbers_in(text)
    if not numbers:
        return False
    return not any(abs(n - value) <= 1e-9 * max(1.0, abs(value)) for n in numbers)


# ---- review policies -------------------------------------------------------------------------

@dataclass(frozen=True)
class Policy:
    """Which candidates wait for a human. Candidates that change no belief are never gated."""
    name: str
    kind: str  # immediate | confirm_conflicts | confirm_all | threshold
    tau: float = 0.0

    def needs_review(self, *, conflict: bool, changes_belief: bool, confidence: Optional[float], suspicious: bool = False) -> bool:
        if not changes_belief or self.kind == "immediate":
            return False
        if suspicious:
            return True
        if self.kind == "confirm_conflicts":
            return conflict
        if self.kind == "confirm_all":
            return True
        return confidence is None or confidence < self.tau  # threshold


def make_policy(spec: str) -> Policy:
    if spec.startswith("threshold:"):
        tau = float(spec.split(":", 1)[1])
        if tau != tau:
            raise ValueError(f"unknown policy {spec!r}: the threshold is not a number")
        return Policy(spec, "threshold", tau)
    if spec in ("immediate", "confirm_conflicts", "confirm_all"):
        return Policy(spec, spec)
    raise ValueError(f"unknown policy {spec!r}")


# ---- the pipeline ----------------------------------------------------------------------------

@dataclass
class Disposition:
    candidate: Candidate
    status: str  # ungrounded | invalid | unresolved | applied | proposed
    reason: str = ""
    turn: Optional[int] = None
    object_id: Optional[str] = None
    attribute: Optional[str] = None
    value: Any = None
    valid_from: Optional[str] = None
    span: Optional[Tuple[int, int]] = None
    conflict: bool = False
    changes_belief: bool = False
    fact_id: Optional[int] = None
    outcome: Optional[str] = None  # in_force | reconfirmed | not_in_force
    review: Optional[str] = None  # accepted | accepted_edited | rejected | pending
    proposal_id: Optional[int] = None


@dataclass
class MeetingResult:
    meeting_id: str
    dispositions: List[Disposition]
    seconds: float
    stats: Dict[str, Any] = field(default_factory=dict)


class _Clock:
    t = 0

    def __call__(self) -> int:
        return self.t


class Pipeline:
    def __init__(self, registry: Registry, extractor: Any, policy: Policy, reviewer: Any = None, *,
                 db_path: str = ":memory:", log_path: Optional[str] = None) -> None:
        self.registry, self.extractor, self.policy, self.reviewer = registry, extractor, policy, reviewer
        self.clock = _Clock()
        self.ledger = Ledger(db_path, log_path=log_path, clock=self.clock)
        registry.install(self.ledger)
        self.meeting_of_source: Dict[str, str] = {}

    def beliefs_at(self, valid_at: int) -> Dict[Tuple[str, str], Any]:
        out = {}
        for obj, attr in self.registry.slots():
            belief = self.ledger.as_of(obj, attr, valid_at=valid_at)
            if belief is not None:
                out[(obj, attr)] = belief.value
        return out

    def ingest(self, meeting: Meeting) -> MeetingResult:
        for t in meeting.turns:
            try:
                finite = math.isfinite(t.start)
            except (TypeError, OverflowError):
                finite = False
            if not finite:
                raise ValueError(f"turn {t.index} of meeting {meeting.meeting_id!r} has no usable start time: {t.start!r}")
        self.clock.t = meeting.ingested_at
        source_id = self.ledger.add_source(meeting.text, meeting.meeting_id, meeting.occurred_at)
        self.meeting_of_source[source_id] = meeting.meeting_id
        context = MeetingContext(meeting, self.registry, self.beliefs_at(meeting.occurred_at))
        started = time.perf_counter()
        candidates = self.extractor.extract(context)
        seconds = time.perf_counter() - started
        dispositions = [self._classify(meeting, c) for c in candidates]
        committable = [d for d in dispositions if d.status == "valid"]
        committable.sort(key=lambda d: (d.turn, dispositions.index(d)))
        for d in committable:
            self._commit(meeting, source_id, d)
        stats = dict(getattr(self.extractor, "last_stats", {}) or {})
        return MeetingResult(meeting.meeting_id, dispositions, seconds, stats)

    def _classify(self, meeting: Meeting, c: Candidate) -> Disposition:
        located = ground(meeting, c.quote, c.turn)
        d = Disposition(c, "valid", turn=located[0] if located else None, span=located[1:3] if located else None)
        if c.unresolved or c.object_id is None:
            d.status, d.reason = "unresolved", "extractor could not tell which item this is about"
            return d
        if located is None:
            d.status, d.reason = "ungrounded", "quote not found in the transcript"
            return d
        try:
            d.object_id, d.attribute = c.object_id, c.attribute
            d.value = self.registry.normalise(c.object_id, c.attribute, c.value)
            if c.valid_from:
                d.valid_from = date.fromisoformat(str(c.valid_from)).isoformat()
        except (KeyError, ValueError, TypeError) as exc:
            d.status, d.reason = "invalid", str(exc)
        return d

    def _commit(self, meeting: Meeting, source_id: str, d: Disposition) -> None:
        turn = meeting.turns[d.turn]
        valid_from = ts(f"{d.valid_from}T00:00:00Z") if d.valid_from else None
        claim_from = valid_from if valid_from is not None else meeting.occurred_at + round(turn.start * 1_000_000)
        winner = self.ledger.as_of(d.object_id, d.attribute, valid_at=claim_from)
        d.changes_belief = winner is None or winner.value != d.value
        d.conflict = winner is not None and winner.value != d.value
        spec = self.registry.spec(d.object_id, d.attribute)
        hint = STATUS_KINDS.get(d.value) if spec.name == "status" else (spec.change_kind if spec.change_kind != "REVISE" else None)
        start, end = d.span
        confidence = _confidence(d.candidate.confidence)
        evidence = Evidence(
            source_id, meeting.text[start:end], speaker_id=turn.speaker, char_start=start, char_end=end,
            audio_start=turn.start, extractor_model=getattr(self.extractor, "name", None),
            confidence=confidence)
        suspicious = spec.type == "number" and number_not_in_quote(d.value, turn.text)
        reason = "the number is not in the quote" if suspicious else self.policy.name
        if not self.policy.needs_review(conflict=d.conflict, changes_belief=d.changes_belief,
                                        confidence=confidence, suspicious=suspicious):
            try:
                out = self.ledger.assert_fact(d.object_id, d.attribute, d.value, evidence, valid_from=valid_from, kind_hint=hint)
            except (LedgerError, sqlite3.IntegrityError) as exc:
                d.status, d.reason = "invalid", f"ledger rejected the write: {exc}"
                return
            d.status, d.fact_id, d.outcome = "applied", out.fact_id, out.status
            return
        try:
            d.proposal_id = self.ledger.propose(
                d.object_id, d.attribute, d.value, evidence, valid_from=valid_from, kind_hint=hint,
                confidence=confidence, reason=reason)
        except (LedgerError, sqlite3.IntegrityError) as exc:
            d.status, d.reason = "invalid", f"ledger rejected the write: {exc}"
            return
        d.status = "proposed"
        if self.reviewer is None:
            d.review = "pending"
        else:
            self.reviewer.review(self, meeting, d)
