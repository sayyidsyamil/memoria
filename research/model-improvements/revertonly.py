"""Rule R ("revert only"), a new candidate idea written after candidate A failed its product-contract fixtures; not
frozen, not preregistered, not a replacement for A. harness.py (part of A's frozen identity) is not changed: R lives
here, with its own gate.

Within one meeting, a write that changes a slot's value is dropped only when the same meeting later returns to the
value that was in force just before it (an excursion the meeting abandoned). Every other write is kept, so two real
changes in a meeting stay two changes, and restatements stay restatements. No model.
"""
import support
from memoria_engine.evaluation.oracle import values_equal


def keep(chain, meeting, candidates, beliefs):
    """ids of the candidates R keeps (candidates the pipeline would not write are kept; it rejects them itself)."""
    valid = [(c, support.valid(meeting, chain.registry, c)) for c in candidates]
    rows = {}
    for c, v in valid:
        if v.status == "valid":
            rows.setdefault((v.object_id, v.attribute), []).append((v.turn, c, v.value))
    dropped = set()
    for slot, writes in rows.items():
        writes.sort(key=lambda w: w[0])
        current = beliefs.get(slot)
        for i, (_, c, value) in enumerate(writes):
            if current is not None and not values_equal(current, value) and any(values_equal(w[2], current) for w in writes[i + 1:]):
                dropped.add(id(c))
                continue
            current = value
    return {id(c) for c, _ in valid if id(c) not in dropped}


class Gate:
    """Closed loop, as harness._Gated: R applied to each meeting's candidates before they are written."""

    def __init__(self, inner, chain):
        self.inner, self.chain = inner, chain
        self.name, self.last_stats = getattr(inner, "name", "gated"), {}

    def extract(self, ctx):
        candidates = self.inner.extract(ctx)
        kept = keep(self.chain, ctx.meeting, candidates, ctx.beliefs)
        return [c for c in candidates if id(c) in kept]


def open_loop(chain, run):
    """keep(meeting, candidate) for a finished run (each meeting with the beliefs its prompt showed)."""
    kept = set()
    for gm, res in zip(chain.meetings, run["results"]):
        kept |= keep(chain, gm.meeting, [d.candidate for d in res.dispositions], run["pipeline"].beliefs_at(gm.meeting.occurred_at))
    return lambda meeting, candidate: id(candidate) in kept
