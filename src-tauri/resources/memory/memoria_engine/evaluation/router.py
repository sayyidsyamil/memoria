"""Natural-language question -> one ledger lookup, so Memoria is evaluated on the same questions the baselines read.

The router sees only the question text, today's date and the registry (never the structured question). Its output is
checked against the registry; anything that does not validate is a failed route, which is scored as a wrong answer
even when the gold answer is "none" (a parse failure must not earn credit).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..extractors import _describe
from ..ledger import Ledger
from ..pipeline import Registry
from .dataset import Question
from .oracle import ledger_answer

ROUTER_VERSION = "r1"
ROUTE_FAILED = "<route failed>"
TYPES = ("current", "as_of_valid", "as_of_tx", "n_changes")

INSTRUCTIONS = """You turn a question about a meeting series into one lookup in a decision ledger.

The four kinds of lookup ("type"):
- "current": what holds now. Use it when the question is about the present (now, currently, today, at the moment, as things stand) or gives no date.
- "as_of_valid": what held on one specific date, using everything known today. The question names the date the answer is about. "valid_at" is that date.
- "as_of_tx": what held on a specific date according to the records as they stood on an earlier date. Use it when the question says what had been recorded, known or planned as of / by an earlier date. It needs two dates: "valid_at" is the date the answer is about, "tx_at" is the date the records are as of.
- "n_changes": how many times the value changed ("valid_at" and "tx_at" are null).

Pick the tracked item and attribute the question is about. Write dates as YYYY-MM-DD. For "current" and "n_changes" both dates are null. If the question is not about any tracked item, use null for "object_id" and "attribute"."""

SCHEMA = '{"type":"current|as_of_valid|as_of_tx|n_changes","object_id":"<id or null>","attribute":"<attribute or null>","valid_at":"<YYYY-MM-DD or null>","tx_at":"<YYYY-MM-DD or null>"}'

FEWSHOT = """Example (a different meeting series, shown for format only)
Tracked items:
- fitout_vendor: Fit-out contractor (decision): outcome[Firm P|Firm Q]
- fitout_job: Office fit-out (commitment): owner[person id], due[ISO date], status[done|cancelled]
Today's date: 2026-03-01
Q: Who is running the fit-out at the moment?
A: {"type":"current","object_id":"fitout_job","attribute":"owner","valid_at":null,"tx_at":null}
Q: Which firm held the contractor role on 20 January 2026?
A: {"type":"as_of_valid","object_id":"fitout_vendor","attribute":"outcome","valid_at":"2026-01-20","tx_at":null}
Q: Per the records of 10 February 2026, what was the fit-out's due date for 28 February 2026?
A: {"type":"as_of_tx","object_id":"fitout_job","attribute":"due","valid_at":"2026-02-28","tx_at":"2026-02-10"}
Q: How often has the fit-out's due date been moved? (Only changes that took effect count.)
A: {"type":"n_changes","object_id":"fitout_job","attribute":"due","valid_at":null,"tx_at":null}"""


@dataclass(frozen=True)
class Route:
    type: Optional[str] = None
    object_id: Optional[str] = None
    attribute: Optional[str] = None
    valid_at: Optional[str] = None  # ISO date
    tx_at: Optional[str] = None  # ISO date
    ok: bool = False
    reason: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "object_id": self.object_id, "attribute": self.attribute, "valid_at": self.valid_at,
                "tx_at": self.tx_at, "ok": self.ok, "reason": self.reason}


def build_prompt(registry: Registry, today: str, text: str) -> str:
    items = "\n".join(f"- {o.object_id}: {o.label} ({o.kind}): " + ", ".join(_describe(a) for a in o.attributes)
                      for o in registry.objects.values())
    people = "; ".join(f"{pid} = {name}" for pid, name in registry.people.items())
    return (f"{INSTRUCTIONS}\n\nReply with JSON only, in this shape:\n{SCHEMA}\n\n{FEWSHOT}\n\nNow the real question.\n"
            f"Tracked items:\n{items}\nPeople: {people}\nToday's date: {today}\nQ: {text}\nA:")


def _iso(value: Any) -> Optional[str]:
    if value in (None, "", "null"):
        return None
    try:
        return date.fromisoformat(str(value).strip()[:10]).isoformat()
    except ValueError:
        raise ValueError(f"not an ISO date: {value!r}")


def parse_route(raw: str, registry: Registry) -> Route:
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        return Route(reason="no JSON in the reply")
    try:
        data = json.loads(raw[start:end + 1])
        kind, obj, attr = data.get("type"), data.get("object_id"), data.get("attribute")
        if kind not in TYPES:
            return Route(reason=f"unknown type {kind!r}")
        if obj is None or attr is None:
            return Route(kind, reason="no tracked item")
        registry.spec(obj, attr)  # KeyError if the slot does not exist
        valid_at, tx_at = _iso(data.get("valid_at")), _iso(data.get("tx_at"))
    except (json.JSONDecodeError, AttributeError, KeyError, ValueError) as exc:
        return Route(reason=f"invalid reply: {exc}")
    if kind in ("as_of_valid", "as_of_tx") and valid_at is None:
        return Route(kind, obj, attr, reason="missing valid_at")
    if kind == "as_of_tx" and tx_at is None:
        return Route(kind, obj, attr, valid_at, reason="missing tx_at")
    if kind in ("current", "n_changes"):
        valid_at = tx_at = None
    if kind == "as_of_valid":
        tx_at = None
    return Route(kind, obj, attr, valid_at, tx_at, ok=True)


class MLXRouter:
    name = "llm-router"

    def __init__(self, llm: Any) -> None:
        self.llm, self.last_stats = llm, {}

    def route(self, registry: Registry, today: str, text: str) -> Route:
        out = self.llm.complete(build_prompt(registry, today, text), max_tokens=90)
        self.last_stats = {"prompt_tokens": out["prompt_tokens"], "output_tokens": out.get("output_tokens"),
                           "seconds": round(out["seconds"], 2), "raw": out["text"]}
        return parse_route(out["text"], registry)


def oracle_route(q: Question) -> Route:
    """The structured question itself: what a perfect router would output."""
    return Route(q.type, q.object_id, q.attribute, q.valid_at, q.tx_at[:10] if q.tx_at else None, ok=True)


def route_matches(route: Route, q: Question) -> bool:
    gold = oracle_route(q)
    return route.ok and (route.type, route.object_id, route.attribute, route.valid_at, route.tx_at) == \
        (gold.type, gold.object_id, gold.attribute, gold.valid_at, gold.tx_at)


def routed_answer(ledger: Ledger, route: Route, now: int) -> Any:
    if not route.ok:
        return ROUTE_FAILED
    query = Question("routed", route.type, route.object_id, route.attribute, route.valid_at,
                     f"{route.tx_at}T00:00:00Z" if route.tx_at else None, None)
    return ledger_answer(ledger, query, now)
