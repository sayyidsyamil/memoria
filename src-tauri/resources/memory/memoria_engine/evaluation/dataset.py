"""Meeting-chain files: transcripts and gold annotations together, parsed and validated.

    chain: crm
    language: en | en-ms
    note: where this came from, and what it can and cannot show
    now: 2026-05-01T00:00:00Z
    people: chair=Dato' Rahman, ali=Ali
    object: crm_vendor | decision | Which CRM vendor | outcome:enum[Vendor A,Vendor B]!reverse
    meeting: m1 | 2026-01-10T09:00:00Z | ingested=2026-01-10T12:00:00Z
    chair: We go with Vendor A.   ## event crm_vendor.outcome = Vendor A | INITIAL | tags=x,y
    siti: What about C?           ## distractor question
    question: q1 | current | crm_vendor.outcome | gold=Vendor A
    question: q2 | as_of_tx | crm_vendor.outcome | valid=2026-03-25 | tx=2026-03-01T00:00:00Z | gold=Vendor A

Several annotations on one turn are separated by " ;; ". `quote="..."` defaults to the whole turn.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..ledger import ts
from ..pipeline import AttributeSpec, Meeting, ObjectSpec, Registry, Turn, ground

KINDS = ("INITIAL", "CONFIRM", "REVISE", "REVERSE", "CANCEL", "COMPLETE")
DISTRACTORS = ("hypothetical", "question", "hearsay", "untracked", "tentative", "ignorable")
QUESTION_TYPES = ("current", "as_of_valid", "as_of_tx", "n_changes")
_ATTR = re.compile(r"(\w+):(enum\[[^\]]*\]|date|number|person|text)(!reverse)?")
_HEADERS = ("chain", "language", "note", "now", "people", "object", "meeting", "question")


@dataclass(frozen=True)
class GoldEvent:
    event_id: str
    meeting_id: str
    turn: int
    object_id: str
    attribute: str
    value: Any
    valid_from: Optional[str]
    kind: str
    quote: str
    tags: Tuple[str, ...]


@dataclass(frozen=True)
class GoldMeeting:
    meeting: Meeting
    events: Tuple[GoldEvent, ...]
    distractors: Dict[int, str]


@dataclass(frozen=True)
class Question:
    qid: str
    type: str
    object_id: str
    attribute: str
    valid_at: Optional[str]  # ISO date
    tx_at: Optional[str]  # ISO datetime
    gold: Any
    ask: Optional[str] = None  # natural-language wording, from the chain's .ask file


@dataclass(frozen=True)
class Chain:
    chain_id: str
    language: str
    note: str
    now: int
    registry: Registry
    meetings: Tuple[GoldMeeting, ...]  # in ingestion order
    questions: Tuple[Question, ...]

    @property
    def events(self) -> List[GoldEvent]:
        return [e for m in self.meetings for e in m.events]


class DatasetError(ValueError):
    pass


def _parse_object(rest: str) -> ObjectSpec:
    parts = [p.strip() for p in rest.split("|")]
    if len(parts) != 4 or parts[1] not in ("decision", "commitment"):
        raise DatasetError(f"object line needs 'id | decision|commitment | label | attributes': {rest!r}")
    attributes = []
    for name, kind, reverse in _ATTR.findall(parts[3]):
        values = tuple(v.strip() for v in kind[5:-1].split(",")) if kind.startswith("enum[") else ()
        attributes.append(AttributeSpec(name, "enum" if values else kind, values, "REVERSE" if reverse else "REVISE"))
    if not attributes:
        raise DatasetError(f"object {parts[0]} has no attributes")
    return ObjectSpec(parts[0], parts[1], parts[2], tuple(attributes))


def _options(parts: List[str]) -> Dict[str, str]:
    out = {}
    for p in parts:
        key, sep, value = p.partition("=")
        if not sep:
            raise DatasetError(f"expected key=value, got {p!r}")
        out[key.strip()] = value.strip()
    return out


def parse_chain(text: str, source: str = "<chain>") -> Chain:
    header: Dict[str, str] = {}
    objects: Dict[str, ObjectSpec] = {}
    people: Dict[str, str] = {}
    raw_meetings: List[Dict[str, Any]] = []
    raw_questions: List[Tuple[int, str]] = []
    for number, line in enumerate(text.splitlines(), start=1):
        where = f"{source}:{number}"
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, _, rest = line.partition(":")
        key, rest = key.strip(), rest.strip()
        if key in _HEADERS:
            if key == "object":
                spec = _parse_object(rest)
                objects[spec.object_id] = spec
            elif key == "people":
                for item in rest.split(","):
                    pid, _, name = item.partition("=")
                    people[pid.strip()] = name.strip()
            elif key == "meeting":
                parts = [p.strip() for p in rest.split("|")]
                opts = _options(parts[2:])
                if len(parts) < 3 or "ingested" not in opts:
                    raise DatasetError(f"{where}: meeting needs 'id | occurred | ingested=...'")
                raw_meetings.append({"id": parts[0], "occurred": ts(parts[1]), "ingested": ts(opts["ingested"]), "turns": []})
            elif key == "question":
                raw_questions.append((number, rest))
            else:
                header[key] = rest
            continue
        if not raw_meetings:
            raise DatasetError(f"{where}: transcript line before any 'meeting:'")
        if key not in people:
            raise DatasetError(f"{where}: unknown speaker {key!r}")
        body, _, annotation = rest.partition(" ## ")
        raw_meetings[-1]["turns"].append((number, key, body.strip(), annotation.strip()))
    for required in ("chain", "now"):
        if required not in header:
            raise DatasetError(f"{source}: missing '{required}:'")
    registry = Registry(objects, people)
    meetings = [_build_meeting(m, registry, source) for m in raw_meetings]
    meetings.sort(key=lambda gm: gm.meeting.ingested_at)
    ids = [gm.meeting.meeting_id for gm in meetings]
    if len(set(ids)) != len(ids):
        raise DatasetError(f"{source}: duplicate meeting ids")
    questions = tuple(_build_question(n, r, registry, source) for n, r in raw_questions)
    return Chain(header["chain"], header.get("language", "en"), header.get("note", ""), ts(header["now"]),
                 registry, tuple(meetings), questions)


def _build_meeting(raw: Dict[str, Any], registry: Registry, source: str) -> GoldMeeting:
    turns = tuple(Turn(i, speaker, 20.0 * i, body) for i, (_, speaker, body, _) in enumerate(raw["turns"]))
    meeting = Meeting(raw["id"], raw["occurred"], raw["ingested"], turns)
    events: List[GoldEvent] = []
    distractors: Dict[int, str] = {}
    for i, (number, _, body, annotation) in enumerate(raw["turns"]):
        where = f"{source}:{number}"
        for segment in [s.strip() for s in annotation.split(" ;; ") if s.strip()]:
            if segment.startswith("distractor "):
                kind = segment.split(None, 1)[1].strip()
                if kind not in DISTRACTORS:
                    raise DatasetError(f"{where}: distractor must be one of {DISTRACTORS}")
                distractors[i] = kind
            elif segment.startswith("event "):
                events.append(_build_event(segment[6:], meeting, i, len(events), registry, where))
            else:
                raise DatasetError(f"{where}: annotation must start with 'event' or 'distractor': {segment!r}")
    return GoldMeeting(meeting, tuple(events), distractors)


def _build_event(body: str, meeting: Meeting, turn: int, k: int, registry: Registry, where: str) -> GoldEvent:
    parts = [p.strip() for p in body.split(" | ")]
    slot, _, raw_value = parts[0].partition(" = ")
    object_id, _, attribute = slot.strip().partition(".")
    if len(parts) < 2 or parts[1] not in KINDS:
        raise DatasetError(f"{where}: event needs a kind from {KINDS}")
    opts = _options(parts[2:])
    try:
        value = registry.normalise(object_id, attribute, raw_value.strip())
    except (KeyError, ValueError) as exc:
        raise DatasetError(f"{where}: {exc}") from exc
    quote = opts.get("quote", "").strip('"') or meeting.turns[turn].text
    located = ground(meeting, quote, turn)
    if located is None or located[0] != turn or not located[3]:
        raise DatasetError(f"{where}: quote not found verbatim in its turn: {quote!r}")
    valid_from = opts.get("valid_from")
    tags = tuple(t for t in opts.get("tags", "").split(",") if t)
    return GoldEvent(f"{meeting.meeting_id}.t{turn}.{k}", meeting.meeting_id, turn, object_id, attribute,
                     value, valid_from, parts[1], quote, tags)


def _build_question(number: int, rest: str, registry: Registry, source: str) -> Question:
    where = f"{source}:{number}"
    parts = [p.strip() for p in rest.split("|")]
    if len(parts) < 4 or parts[1] not in QUESTION_TYPES:
        raise DatasetError(f"{where}: question needs 'id | {'|'.join(QUESTION_TYPES)} | object.attribute | gold=...'")
    object_id, _, attribute = parts[2].partition(".")
    opts = _options(parts[3:])
    if "gold" not in opts:
        raise DatasetError(f"{where}: question has no gold")
    try:
        registry.spec(object_id, attribute)
        raw = opts["gold"]
        if raw == "none":
            gold: Any = None
        elif parts[1] == "n_changes":
            gold = int(raw)
        else:
            gold = registry.normalise(object_id, attribute, raw)
    except (KeyError, ValueError) as exc:
        raise DatasetError(f"{where}: {exc}") from exc
    needs_valid = parts[1] in ("as_of_valid", "as_of_tx")
    if needs_valid and "valid" not in opts or parts[1] == "as_of_tx" and "tx" not in opts:
        raise DatasetError(f"{where}: {parts[1]} needs valid= (and tx= for as_of_tx)")
    return Question(parts[0], parts[1], object_id, attribute, opts.get("valid"), opts.get("tx"), gold)


def parse_ask(text: str, chain: Chain, source: str = "<ask>") -> Chain:
    """Attach natural-language question wording ('qid | text' lines) to a chain; every question needs one."""
    wording: Dict[str, str] = {}
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        qid, sep, body = line.partition("|")
        if not sep or not body.strip():
            raise DatasetError(f"{source}:{number}: expected 'qid | question text'")
        wording[qid.strip()] = body.strip()
    known = {q.qid for q in chain.questions}
    if set(wording) != known:
        raise DatasetError(f"{source}: questions without wording {sorted(known - set(wording))}, wording without question {sorted(set(wording) - known)}")
    return replace(chain, questions=tuple(replace(q, ask=wording[q.qid]) for q in chain.questions))


def load_chains(directory: str, wording: str = "ask") -> List[Chain]:
    """Chains with their natural-language question wording: the primary set (*.ask) or a second phrasing (*.alt)."""
    chains = []
    for p in sorted(Path(directory).glob("*.chain")):
        chain = parse_chain(p.read_text(encoding="utf-8"), p.name)
        ask = p.with_suffix("." + wording)
        if ask.exists():
            chain = parse_ask(ask.read_text(encoding="utf-8"), chain, ask.name)
        chains.append(chain)
    return chains
