"""Gold-derived helpers: the oracle reviewer and ledger-backed question answering."""
from __future__ import annotations

from typing import Any, Optional

from ..ledger import Ledger, ts
from ..pipeline import Meeting, Pipeline
from .dataset import Chain, Question


def values_equal(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        return abs(a - b) < 1e-9
    return str(a).strip().casefold() == str(b).strip().casefold()


class OracleReviewer:
    """An ideal human: accepts a proposal that matches a gold event, fixes one that is nearly right, rejects the rest."""

    name = "oracle-reviewer"

    def __init__(self, chain: Chain) -> None:
        self.events = {m.meeting.meeting_id: m.events for m in chain.meetings}

    def review(self, pipeline: Pipeline, meeting: Meeting, d: Any) -> None:
        near = [g for g in self.events[meeting.meeting_id]
                if g.object_id == d.object_id and g.attribute == d.attribute and abs(g.turn - d.turn) <= 2]
        exact = next((g for g in near if values_equal(g.value, d.value) and (g.valid_from is None or g.valid_from == d.valid_from)), None)
        target = exact or (near[0] if near else None)
        if target is None:
            pipeline.ledger.reject(d.proposal_id, self.name, note="no supporting decision in the transcript")
            d.review = "rejected"
            return
        edits = {}
        if exact is None:
            edits["value"] = target.value
            if target.valid_from:
                edits["valid_from"] = ts(f"{target.valid_from}T00:00:00Z")
        out = pipeline.ledger.accept(d.proposal_id, self.name, edits=edits)
        d.review = "accepted_edited" if exact is None else "accepted"
        d.fact_id, d.outcome = out.fact_id, out.status


def ledger_answer(ledger: Ledger, q: Question, now: int) -> Any:
    midnight = lambda iso: ts(f"{iso}T00:00:00Z")
    if q.type == "n_changes":
        pieces = ledger.timeline(q.object_id, q.attribute)
        return sum(1 for a, b in zip(pieces, pieces[1:]) if not values_equal(a.value, b.value))
    valid_at = now if q.type == "current" else midnight(q.valid_at)
    tx_at: Optional[int] = ts(q.tx_at) if q.type == "as_of_tx" else None
    belief = ledger.as_of(q.object_id, q.attribute, valid_at=valid_at, tx_at=tx_at)
    return belief.value if belief else None
