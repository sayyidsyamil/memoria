"""A rule-based second chance for questions the language-model router could not map to a lookup.

The model reads the question like a person and is right far more often, but it sometimes returns nothing usable. Instead of telling the
user "not found", the service then tries plain rules: which tracked item has its label words in the question, which attribute it asks
about (who, when, how much ...), and which kind of lookup (now, on a date, as recorded by a date, how many changes).
It returns a Route in the same shape as the model router, so the lookup and the evidence are exactly the same.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Dict, List, Optional, Tuple

from .evaluation.router import Route
from .pipeline import ObjectSpec, Registry

MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}
MONTHS.update({m[:3]: i for m, i in list(MONTHS.items())})
MONTHS["sept"] = 9
_MONTH = "|".join(sorted(MONTHS, key=len, reverse=True))
_DAY_FIRST = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({_MONTH})\b\.?,?(?:\s+(\d{{4}}))?", re.I)
_MONTH_FIRST = re.compile(rf"\b({_MONTH})\b\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b,?(?:\s+(\d{{4}}))?", re.I)
_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
STOP = {"the", "of", "for", "and", "date", "rm", "status", "new", "current", "item", "our", "a", "an", "to", "in", "on", "is", "was"}
N_CHANGES = re.compile(r"\bhow (?:many|often)\b|\bnumber of (?:times|changes)\b|\bchanged how\b", re.I)
AS_RECORDED = re.compile(r"\b(?:recorded|known|knew|on record|on file|according to the records|per the records|planned)\b", re.I)


def _words(text: str) -> List[str]:
    return [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in re.findall(r"[a-z][a-z-]+", text.casefold())]


def parse_dates(question: str, today: date) -> List[date]:
    """Dates written in the question, in order of appearance. A missing year means the latest such day that is not after today."""
    found: List[Tuple[int, date]] = []

    def year_for(month: int, day: int, year: Optional[str]) -> Optional[date]:
        try:
            if year:
                return date(int(year), month, day)
            d = date(today.year, month, day)
            return d if d <= today else date(today.year - 1, month, day) if False else d
        except ValueError:
            return None

    for m in _ISO.finditer(question):
        try:
            found.append((m.start(), date(int(m[1]), int(m[2]), int(m[3]))))
        except ValueError:
            pass
    for m in _DAY_FIRST.finditer(question):
        d = year_for(MONTHS[m[2].casefold()], int(m[1]), m[3])
        if d:
            found.append((m.start(), d))
    for m in _MONTH_FIRST.finditer(question):
        d = year_for(MONTHS[m[1].casefold()], int(m[2]), m[3])
        if d:
            found.append((m.start(), d))
    seen, out = set(), []
    for _, d in sorted(found):
        if d not in seen:
            seen.add(d)
            out.append(d)
    return out


def _item_scores(registry: Registry, words: List[str]) -> List[Tuple[int, int, ObjectSpec]]:
    scores = []
    bag = set(words)
    for obj in registry.objects.values():
        tokens = {w for w in _words(obj.label) + _words(obj.object_id.replace("_", " ")) if w not in STOP and len(w) >= 3}
        hit = [t for t in tokens if t in bag]
        if hit:
            scores.append((len(hit), max(len(t) for t in hit), obj))
    return sorted(scores, key=lambda s: (-s[0], -s[1]))


def _attribute(obj: ObjectSpec, question: str) -> Optional[str]:
    names = [a.name for a in obj.attributes]
    if len(names) == 1:
        return names[0]
    q = question.casefold()
    by_type: Dict[str, List[str]] = {}
    for a in obj.attributes:
        by_type.setdefault(a.type, []).append(a.name)
    for a in obj.attributes:
        if re.search(rf"\b{re.escape(a.name.casefold())}\b", q):
            return a.name
    rules = (("status", r"\b(status|done|complete|completed|finished|cancel+ed|progress)\b"), ("owner", r"\b(who|owner|owns|own|responsible|in charge|lead|leads|running|take|takes)\b"),
             ("deadline", r"\b(when|due|deadline|by when)\b"), ("amount", r"\b(how much|amount|budget|cost|price|ringgit)\b"), ("outcome", r"\b(which|chosen|selected|decided)\b"))
    for name, pattern in rules:
        if name in names and re.search(pattern, q):
            return name
    if re.search(r"\bwho\b", q) and by_type.get("person"):
        return by_type["person"][0]
    if re.search(r"\bwhen\b", q) and by_type.get("date"):
        return by_type["date"][0]
    if re.search(r"\bhow much\b", q) and by_type.get("number"):
        return by_type["number"][0]
    for a in obj.attributes:
        if a.name != "status":
            return a.name
    return names[0] if names else None


def fallback_route(registry: Registry, today_iso: str, question: str) -> Route:
    today = date.fromisoformat(today_iso)
    scores = _item_scores(registry, _words(question))
    if not scores:
        return Route(reason="fallback: no tracked item is named in the question")
    if len(scores) > 1 and scores[0][:2] == scores[1][:2]:
        return Route(reason="fallback: more than one tracked item fits the question")
    obj = scores[0][2]
    attribute = _attribute(obj, question)
    if attribute is None:
        return Route(reason="fallback: no attribute")
    dates = parse_dates(question, today)
    if N_CHANGES.search(question):
        return Route("n_changes", obj.object_id, attribute, None, None, ok=True, reason="fallback")
    if dates and AS_RECORDED.search(question) and len(dates) >= 2:
        return Route("as_of_tx", obj.object_id, attribute, dates[-1].isoformat(), dates[0].isoformat(), ok=True, reason="fallback")
    if dates:
        return Route("as_of_valid", obj.object_id, attribute, dates[0].isoformat(), None, ok=True, reason="fallback")
    return Route("current", obj.object_id, attribute, None, None, ok=True, reason="fallback")
