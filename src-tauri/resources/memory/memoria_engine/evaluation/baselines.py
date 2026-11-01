"""Question-answering baselines that use the same local LLM as the extractor.

Prompt v2 (first evaluation run) is kept so those numbers can be reproduced; it had weaknesses that handicapped the baselines:
the question carried the slot id, no 'today' was given, meetings were ordered by ingestion, and the stated rule ("a decision takes
effect from the meeting date") contradicted "effective 1 July" decisions. Prompt v3 is the fair version: natural-language question,
the same registry information the router gets, rules equal to the ledger's semantics, today's date, meetings in the order held,
and an optional short chain of thought.
"""
from __future__ import annotations

import math
import re
import time
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from ..ledger import ts
from .dataset import Chain, Question
from .oracle import values_equal

_UNIT = {"enum": "one of the allowed values", "date": "an ISO date (YYYY-MM-DD)", "number": "a number in MYR with no units or commas",
         "person": "a person id"}


def tokens(text: str) -> List[str]:
    return re.findall(r"\w+", text.casefold())


def question_text(chain: Chain, q: Question) -> str:
    obj = chain.registry.objects[q.object_id]
    spec = chain.registry.spec(q.object_id, q.attribute)
    thing = f"the {q.attribute.replace('_', ' ')} of '{obj.label}' ({q.object_id}.{q.attribute})"
    if q.type == "n_changes":
        return (f"How many times did {thing} change from one value to a different value over the whole meeting series? "
                "Count only changes, not the first time it was set. Answer with a single integer.")
    if q.type == "current":
        when = "currently (right now)"
    elif q.type == "as_of_valid":
        when = f"on {q.valid_at}"
    else:
        when = f"on {q.valid_at}, as the team knew it at the end of {q.tx_at[:10]}"
    kind = _UNIT.get(spec.type, "a short text")
    allowed = f" Allowed values: {', '.join(spec.values)}." if spec.values else ""
    people = f" Person ids: {', '.join(chain.registry.people)}." if spec.type == "person" else ""
    return (f"What was {thing} {when}? Reply with {kind}, or the single word none if no decision had been made yet "
            f"or it is not stated.{allowed}{people} Reply with the answer only.")


def transcripts_before(chain: Chain, q: Question, order: str = "ingested") -> List[Tuple[str, str, str]]:
    """Transcripts a system may read for this question. For as_of_tx only meetings recorded by the cutoff are returned,
    which spares the baselines the work of reasoning about recording dates (this favours them)."""
    cutoff = ts(q.tx_at) if q.type == "as_of_tx" else None
    key = (lambda m: (m.meeting.occurred_at, m.meeting.ingested_at)) if order == "held" else (lambda m: m.meeting.ingested_at)
    return [(gm.meeting.meeting_id, gm.meeting.date_iso, gm.meeting.text)
            for gm in sorted(chain.meetings, key=key) if cutoff is None or gm.meeting.ingested_at <= cutoff]


_MARK = re.compile(r"answer\s*[:\-]\s*(.+)", re.I)


def parse_answer(raw: str, q: Question, chain: Chain, cot: bool = False) -> Any:
    lines = [ln for ln in raw.strip().splitlines() if ln.strip()]
    marked = _MARK.findall(raw)
    pick = marked[-1] if marked else (lines[-1] if cot and lines else lines[0] if lines else "")
    text = pick.strip().strip("*.`\"' ")
    if q.type == "n_changes":
        m = re.search(r"\d+", text)
        return int(m.group()) if m else None
    if text.casefold() in ("none", "unknown", "n/a", "not stated"):
        return None
    try:
        return chain.registry.normalise(q.object_id, q.attribute, text)
    except (KeyError, ValueError):
        return text


# ---- prompt v3 ---------------------------------------------------------------------------------

RULES_V3 = """1. Meetings are listed in the order they were held.
2. A decision applies from the day of the meeting that made it, or from a later date if it says so (for example "effective 1 August").
3. The answer for a date is what the most recent decision already in effect on that date said. Decisions made after that date, or not yet in effect on it, do not count. If nothing had been decided yet, the answer is none.
4. Only firm decisions and commitments count. Questions, ideas, hypotheticals, hearsay, tentative leanings and acknowledgements do not.
5. A later decision that corrects, reverses or withdraws an earlier one replaces it."""
DIRECT_TAIL = "Reply with the answer only: the value written exactly as shown above, or the single word none. For a count, reply with a whole number."
COT_TAIL = ("First list, one short line each and in date order, the decisions that matter for this question and say which one applies. "
            "Then finish with a last line of the form 'ANSWER: <answer>', the value written exactly as shown above, the single word none, or a whole number for a count.")
COT_TOKENS = 4096  # the model lists every meeting before answering, so output grows with K; 320 cut off 22% of full-context+cot dev answers at K=24 and each cut-off answer was scored wrong
_FORMATS = {"date": "a date written YYYY-MM-DD", "number": "a number in full digits, no units or commas (RM2.5 million is 2500000, 25 percent is 25)",
            "person": "a person id"}


def answer_format(spec: Any) -> str:
    return " | ".join(spec.values) if spec.type == "enum" else _FORMATS.get(spec.type, "short text")


def reference_list(chain: Chain) -> str:
    """The registry as the baselines see it: the same information the router gets, minus the internal ids."""
    items = "\n".join(f"- {o.label}: " + "; ".join(f"{a.name} = {answer_format(a)}" for a in o.attributes)
                      for o in chain.registry.objects.values())
    people = "; ".join(f"{pid} = {name}" for pid, name in chain.registry.people.items())
    return f"Tracked items and the exact way to write each answer:\n{items}\nPeople (answer with the id): {people}"


def today_iso(chain: Chain) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(chain.now / 1e6))


def nl_question(q: Question) -> str:
    if not q.ask:
        raise ValueError(f"question {q.qid} has no natural-language wording (.ask file)")
    return q.ask


def prompt_v3(chain: Chain, q: Question, material: str, cot: bool, what: str) -> str:
    note = f" The notes only cover meetings recorded by {q.tx_at[:10]}." if q.type == "as_of_tx" else ""
    return (f"You answer questions about a series of meetings, using only the {what} below.\n\n{reference_list(chain)}\n\n"
            f"How to read the notes:\n{RULES_V3}\n\nToday's date is {today_iso(chain)}.{note}\n\n{material}\n\n"
            f"Question: {nl_question(q)}\n{COT_TAIL if cot else DIRECT_TAIL}")


class _System:
    def __init__(self, llm: Any, cot: bool = False, version: str = "v3") -> None:
        if version == "v2" and cot:
            raise ValueError("prompt v2 has no chain-of-thought variant")
        self.llm, self.cot, self.version = llm, cot, version

    def _ask(self, prompt: str) -> Dict[str, Any]:
        out = self.llm.complete(prompt, max_tokens=COT_TOKENS if self.cot else 24)
        return {"raw": out["text"], "seconds": out["seconds"], "prompt_tokens": out["prompt_tokens"], "output_tokens": out.get("output_tokens")}

    def answer(self, chain: Chain, q: Question) -> Dict[str, Any]:
        return self._ask(self.prompt(chain, q))


class FullContext(_System):
    @property
    def name(self) -> str:
        return "full-context" + ("+cot" if self.cot else "") + ("" if self.version == "v3" else "(v2)")

    def prompt(self, chain: Chain, q: Question) -> str:
        if self.version == "v2":
            docs = "\n\n".join(f"=== Meeting {mid}, held on {day} ===\n{text}" for mid, day, text in transcripts_before(chain, q))
            return (f"Below are the transcripts of a series of meetings, oldest first. Later meetings can change earlier decisions. "
                    f"A decision takes effect from the date of the meeting that made it.\n\n{docs}\n\nQuestion: {question_text(chain, q)}")
        docs = "\n\n".join(f"=== Meeting held on {day} ===\n{text}" for _, day, text in transcripts_before(chain, q, "held"))
        return prompt_v3(chain, q, docs, self.cot, "meeting notes")


class BM25RAG(_System):
    def __init__(self, llm: Any, k: int = 6, window: int = 3, cot: bool = False, version: str = "v3") -> None:
        super().__init__(llm, cot, version)
        self.k, self.window = k, window

    @property
    def name(self) -> str:
        return f"bm25-rag(k={self.k})" + ("+cot" if self.cot else "") if self.version == "v3" else "bm25-rag(v2)"

    def _chunks(self, chain: Chain, q: Question) -> List[Tuple[str, str]]:
        out = []
        for mid, day, text in transcripts_before(chain, q, "ingested" if self.version == "v2" else "held"):
            lines = text.split("\n")
            for i in range(0, len(lines), self.window):
                out.append((f"Meeting {mid}, held on {day}" if self.version == "v2" else f"Meeting held on {day}", "\n".join(lines[i:i + self.window])))
        return out

    def retrieve(self, chain: Chain, q: Question) -> List[Tuple[str, str]]:
        chunks = self._chunks(chain, q)
        query = tokens(question_text(chain, q) if self.version == "v2" else nl_question(q))
        docs = [tokens(c[1]) for c in chunks]
        avg = sum(len(d) for d in docs) / max(1, len(docs))
        df = Counter(w for d in docs for w in set(d))
        scores = []
        for i, d in enumerate(docs):
            tf = Counter(d)
            s = sum(math.log(1 + (len(docs) - df[w] + 0.5) / (df[w] + 0.5)) * tf[w] * 2.5 / (tf[w] + 1.5 * (0.25 + 0.75 * len(d) / avg))
                    for w in set(query) if w in tf)
            scores.append((s, i))
        top = sorted(scores, reverse=True)[: self.k]
        return [chunks[i] for _, i in sorted(top, key=lambda t: t[1])]

    def prompt(self, chain: Chain, q: Question) -> str:
        context = "\n\n".join(f"[{src}]\n{text}" for src, text in self.retrieve(chain, q))
        if self.version == "v2":
            return (f"Below are excerpts retrieved from meeting transcripts. A decision takes effect from the date of the meeting that made it.\n\n"
                    f"{context}\n\nQuestion: {question_text(chain, q)}")
        return prompt_v3(chain, q, context, self.cot, "meeting excerpts (retrieved passages, oldest first)")


def score_item(chain: Chain, q: Question, raw: str, cot: bool = False) -> Dict[str, Any]:
    parsed = parse_answer(raw, q, chain, cot)
    return {"qid": q.qid, "chain": chain.chain_id, "type": q.type, "gold": q.gold, "answer": parsed, "raw": raw,
            "correct": values_equal(parsed, q.gold)}
