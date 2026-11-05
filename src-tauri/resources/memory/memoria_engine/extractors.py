"""Extractors turn a meeting into candidate decisions. The pipeline decides what to trust."""
from __future__ import annotations

import calendar
import hashlib
import json
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from .pipeline import Candidate, MeetingContext, Registry

_MONTHS = {m.casefold(): i for i, m in enumerate(calendar.month_name) if m}
_MONTHS.update({m.casefold(): i for i, m in enumerate(calendar.month_abbr) if m})
_MONTHS.update({"mac": 3, "mei": 5, "ogos": 8, "okt": 10, "dis": 12, "sept": 9})
_MONTH_RE = "|".join(sorted(_MONTHS, key=len, reverse=True))
_STOP = {"which", "what", "that", "this", "with", "have", "from", "will"}


class OracleExtractor:
    """Upper bound: returns the gold events, so any remaining error belongs to the pipeline itself."""

    name = "oracle"

    def __init__(self, chain: Any) -> None:
        self.events = {m.meeting.meeting_id: m.events for m in chain.meetings}

    def extract(self, ctx: MeetingContext) -> List[Candidate]:
        return [Candidate(e.object_id, e.attribute, e.value, e.quote, e.turn, e.valid_from, 1.0)
                for e in self.events[ctx.meeting.meeting_id]]


class KeywordExtractor:
    """A deliberately simple baseline: cue words, value mentions, date and amount patterns."""

    name = "keyword-rules"
    NOT_FIRM = re.compile(r"\?|\b(what if|how about|should we|maybe|perhaps|might|could|kalau|mungkin|cadang|saya rasa|i think)\b", re.I)
    CUE = re.compile(
        r"\b(go with|let's|we'll|we will|decided|switch|push|bump|cap|allocate|approve[d]?|i'll|stays|still|no change|"
        r"kita go|kita pilih|kita tukar|tetapkan|tangguh|batal|setuju|ambil alih|complete[d]?|done|siap|live|signed|"
        r"hired|cancel(?:l?ed)?|dropped|take[s]? over|hold|released|effective|naik|turun|reduce[d]?|increase[d]?)\b", re.I)
    DONE = re.compile(r"\b(complete[d]?|done|siap|signed|hired|went live)\b", re.I)
    CANCELLED = re.compile(r"\b(cancel(?:l?ed)?|batal|dropped)\b", re.I)

    def extract(self, ctx: MeetingContext) -> List[Candidate]:
        reg, turns = ctx.registry, ctx.meeting.turns
        year = int(ctx.meeting.date_iso[:4])
        out: List[Candidate] = []
        for t in turns:
            if self.NOT_FIRM.search(t.text) or not self.CUE.search(t.text):
                continue
            recent = self._recent(reg, [x.text for x in turns[max(0, t.index - 3): t.index + 1]])
            make = lambda o, a, v: out.append(Candidate(o, a, v, t.text, t.index, None, 0.5))
            for obj in reg.objects.values():
                for attr in obj.attributes:
                    if attr.type == "enum" and attr.name != "status":
                        for v in self._mentioned(attr.values, t.text):
                            make(obj.object_id, attr.name, v)
                    elif attr.name == "status" and obj.object_id in recent[:1]:
                        if self.CANCELLED.search(t.text):
                            make(obj.object_id, "status", "cancelled")
                        elif self.DONE.search(t.text):
                            make(obj.object_id, "status", "done")
            self._typed(reg, recent, t, year, ctx.beliefs, make)
        return out

    @staticmethod
    def _mentioned(values: Tuple[str, ...], text: str) -> List[str]:
        low = text.casefold()
        found = [v for v in values if v.casefold() in low]
        if not found:
            last = [v.split()[-1].casefold() for v in values]
            found = [v for v, w in zip(values, last) if len(w) > 3 and last.count(w) == 1 and re.search(rf"\b{re.escape(w)}\b", low)]
        return found[-1:]

    @staticmethod
    def _recent(reg: Registry, texts: List[str]) -> List[str]:
        scored = []
        for obj in reg.objects.values():
            words = {w for w in re.findall(r"[a-z]{4,}", (obj.object_id.replace("_", " ") + " " + obj.label).casefold())} - _STOP
            hits = [i for i, text in enumerate(texts) if any(w in text.casefold() for w in words)]
            if hits:
                scored.append((max(hits), obj.object_id))
        return [o for _, o in sorted(scored, reverse=True)]

    def _typed(self, reg, recent, t, year, beliefs, make) -> None:
        def owner(kind: str) -> Optional[str]:
            order = recent + [o.object_id for o in reg.objects.values()]
            return next((o for o in order if any(a.type == kind for a in reg.objects[o].attributes)), None)

        def attr(obj: Optional[str], kind: str) -> Optional[str]:
            return next((a.name for a in reg.objects[obj].attributes if a.type == kind), None) if obj else None

        for m in re.finditer(rf"(\d{{1,2}})\s*({_MONTH_RE})\b|\b(?:end of|hujung)\s+({_MONTH_RE})\b|\b(\d{{4}}-\d{{2}}-\d{{2}})\b", t.text, re.I):
            if m.group(4):
                value = m.group(4)
            elif m.group(3):
                month = _MONTHS[m.group(3).casefold()]
                value = f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"
            else:
                value = f"{year}-{_MONTHS[m.group(2).casefold()]:02d}-{int(m.group(1)):02d}"
            obj = owner("date")
            if obj and attr(obj, "date"):
                make(obj, attr(obj, "date"), value)
        for m in re.finditer(r"(?:RM\s?)?(\d+(?:\.\d+)?)\s*(million|juta|m|k)\b", t.text, re.I):
            factor = {"million": 1e6, "juta": 1e6, "m": 1e6, "k": 1e3}[m.group(2).casefold()]
            amount = float(m.group(1)) * factor
            obj = owner("number")
            if obj and attr(obj, "number"):
                if re.search(r"\b(bump|increase|naik|add)\b", t.text, re.I) and (obj, attr(obj, "number")) in beliefs:
                    amount += beliefs[(obj, attr(obj, "number"))]
                make(obj, attr(obj, "number"), amount)
        who = None
        if re.search(r"\b(I'll|I will|saya akan)\b", t.text, re.I):
            who = t.speaker
        else:
            for pid, name in reg.people.items():
                if re.search(rf"\b{re.escape(name.split()[0])}\b.*\b(takes? over|ambil alih|will own|akan uruskan)\b|\b(takes? over|ambil alih)\b.*\b{re.escape(name.split()[0])}\b", t.text, re.I):
                    who = pid
        obj = owner("person")
        if who and obj and attr(obj, "person"):
            make(obj, attr(obj, "person"), who)


# ---- local LLM -------------------------------------------------------------------------------

PROMPT_VERSION = "v2"

RULES = """Rules:
1. Only firm decisions or commitments count. Ignore questions, hypotheticals ("what if", "maybe", "should we"), tentative leanings, suggestions nobody accepts, reports of what others might do, background information, and acknowledgements.
2. Do not output an event just because a turn mentions a tracked item or value. The turn must itself decide it, change it, or explicitly reaffirm it as still in force ("stays", "no change", "still").
3. A report that a commitment is finished or abandoned ("done", "complete", "went live", "signed", "dropped", "cancelled") is a status event.
4. Resolve pronouns and references ("that", "it", "we'll do it by Friday") using earlier turns. If you cannot tell which tracked item a statement is about, set "object_id" to null and "unresolved" to true.
5. "value" must be one of the allowed values, an ISO date (YYYY-MM-DD), a number in MYR without commas or units (2500000), or a person id. Convert relative dates using the meeting date, and relative changes ("increase by 500k") using the current belief.
6. "quote" must be copied exactly from the transcript turn it comes from; "turn" is that turn's number.
7. If a decision takes effect on a stated future date, put that date in "valid_from"; otherwise null.
8. The transcript may mix English and Bahasa Malaysia.
9. A turn may contain several decisions; output one event per decision.
10. "confidence" is your probability (0 to 1) that the event is a firm decision read correctly; use below 0.5 when unsure."""

SCHEMA = '{"events":[{"turn":<int>,"quote":"<exact text>","object_id":"<id or null>","attribute":"<attribute>","value":<value>,"valid_from":"<ISO date or null>","confidence":<0..1>,"unresolved":false}]}'

FEWSHOT = """Example (a different meeting series, shown for format only)
Tracked items: fitout_vendor (decision): outcome[Firm P|Firm Q]; fitout_job (commitment): deadline[ISO date], status[done|cancelled]
Meeting date: 2026-02-03
[0] lee: Should we ask Firm Q for a revised quote?
[1] sam: We could, but the demo from Firm P was stronger.
[2] lee: Fine, we go with Firm P.
[3] lee: Handover by 20 February.
[4] sam: The electrical survey is finished.
Reply: {"events":[{"turn":2,"quote":"we go with Firm P","object_id":"fitout_vendor","attribute":"outcome","value":"Firm P","valid_from":null,"confidence":0.9,"unresolved":false},{"turn":3,"quote":"Handover by 20 February","object_id":"fitout_job","attribute":"deadline","value":"2026-02-20","valid_from":null,"confidence":0.9,"unresolved":false}]}
(Turn 1 is an opinion, turn 0 a question, turn 4 is about an untracked item: no events.)"""

PROMPT_HASH = hashlib.sha256((PROMPT_VERSION + RULES + SCHEMA + FEWSHOT).encode()).hexdigest()[:12]


def _describe(attr: Any) -> str:
    if attr.type == "enum":
        return f"{attr.name}[{'|'.join(attr.values)}]"
    return f"{attr.name}[{ {'date': 'ISO date', 'number': 'number, MYR', 'person': 'person id'}.get(attr.type, attr.type) }]"


def build_prompt(ctx: MeetingContext) -> str:
    reg, meeting = ctx.registry, ctx.meeting
    items = "\n".join(f"- {o.object_id}: {o.label} ({o.kind}): " + ", ".join(_describe(a) for a in o.attributes)
                      for o in reg.objects.values())
    people = "; ".join(f"{pid} = {name}" for pid, name in reg.people.items())
    beliefs = "\n".join(f"- {o}.{a} = {v}" for (o, a), v in ctx.beliefs.items()) or "(none yet)"
    weekday = calendar.day_name[time.gmtime(meeting.occurred_at / 1e6).tm_wday]
    return (
        "You maintain a decision and commitment ledger for a meeting series. Read the transcript and list every "
        "FIRM decision or commitment that sets, changes or confirms a tracked item.\n\n"
        f"Tracked items (object_id: label (kind): attribute[type or allowed values]):\n{items}\n"
        f"People: {people}\n"
        f"Current beliefs when this meeting took place:\n{beliefs}\n"
        f"Meeting date: {meeting.date_iso} ({weekday})\n\n{RULES}\n\n{FEWSHOT}\n\n"
        f"Now the real task. Reply with JSON only, in this shape:\n{SCHEMA}\n\nTranscript:\n{meeting.text}\n"
    )


def _flag(x: Any) -> bool:
    """A model may write a flag as true, 1 or "false": the word "false" must not read as true."""
    if isinstance(x, str):
        return x.strip().casefold() not in ("", "false", "no", "0")
    return bool(x)


def parse_events(text: str) -> Tuple[List[Candidate], bool]:
    """(candidates, parsed_cleanly). Clean only when the reply holds an "events" list; otherwise individual event
    objects are salvaged. Never raises, whatever the model wrote."""
    def to_candidate(e: Dict[str, Any]) -> Candidate:
        turn = e.get("turn")
        return Candidate(e.get("object_id"), e.get("attribute"), e.get("value"), str(e.get("quote") or ""),
                         turn if isinstance(turn, int) else None, e.get("valid_from") or None,
                         e.get("confidence") if isinstance(e.get("confidence"), (int, float)) else None,
                         _flag(e.get("unresolved")))

    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            doc = json.loads(text[start:end + 1])
            events = doc.get("events") if isinstance(doc, dict) else None
            if isinstance(events, list):
                return [to_candidate(e) for e in events if isinstance(e, dict)], True
        except (ValueError, TypeError, RecursionError):
            pass
    salvaged = []
    for m in re.finditer(r"\{[^{}]*\"quote\"[^{}]*\}", text):
        try:
            salvaged.append(to_candidate(json.loads(m.group(0))))
        except (ValueError, TypeError):
            continue
    return salvaged, False


class MLXExtractor:
    """Qwen3.5-4B (Apache-2.0, 4-bit) running in-process on Apple silicon through mlx-lm. Greedy decoding."""

    def __init__(self, model_id: str = "mlx-community/Qwen3.5-4B-MLX-4bit", max_tokens: int = 900) -> None:
        self.model_id, self.max_tokens, self.name = model_id, max_tokens, model_id.split("/")[-1]
        self.last_stats: Dict[str, Any] = {}
        self._model = self._tok = None

    def load(self) -> None:
        if self._model is None:
            from mlx_lm import load  # imported lazily: only needed for this extractor

            self._model, self._tok = load(self.model_id)

    def complete(self, prompt: str, max_tokens: Optional[int] = None) -> Dict[str, Any]:
        from mlx_lm import generate

        self.load()
        messages = [{"role": "user", "content": prompt}]
        try:
            text = self._tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False, enable_thinking=False)
        except TypeError:
            text = self._tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
        started = time.perf_counter()
        out = generate(self._model, self._tok, prompt=text, max_tokens=max_tokens or self.max_tokens, verbose=False)
        return {"text": out, "seconds": time.perf_counter() - started,
                "prompt_tokens": len(self._tok.encode(text)), "output_tokens": len(self._tok.encode(out))}

    def extract(self, ctx: MeetingContext) -> List[Candidate]:
        result = self.complete(build_prompt(ctx))
        candidates, clean = parse_events(result["text"])
        self.last_stats = {"prompt_tokens": result["prompt_tokens"], "output_tokens": result["output_tokens"],
                           "llm_seconds": round(result["seconds"], 2), "parsed_cleanly": clean, "raw": result["text"]}
        return candidates
