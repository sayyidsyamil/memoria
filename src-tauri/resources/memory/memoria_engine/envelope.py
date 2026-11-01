"""Which claim is in force at each valid time?

A claim says "from `start` (until `end`, or forever) the slot has this value". Among the claims
covering a valid time, the one decided last wins; ties go to the one ingested last. The result does
not depend on the order in which claims were ingested.
"""
from __future__ import annotations

from typing import Iterator, List, NamedTuple, Optional, Sequence, Tuple


class Claim(NamedTuple):
    fact_id: int
    rank: Tuple[int, int]  # (decided_at, rank_seq): higher wins
    value_key: str  # canonical JSON of the value
    start: int
    end: Optional[int]  # None = open-ended


class Piece(NamedTuple):
    fact_id: int
    start: int
    end: Optional[int]


def covers(c: Claim, start: int, end: Optional[int]) -> bool:
    return c.start <= start and (c.end is None or (end is not None and c.end >= end))


def envelope(claims: Sequence[Claim]) -> List[Piece]:
    """Partition the valid-time axis into pieces, each attributed to one fact.

    Adjacent stretches with the same value are merged into one piece when a single winning claim
    covers the whole stretch (a re-confirmation therefore adds no piece); otherwise they stay split
    per fact, so a piece is always covered by the claim window of the fact it points to.
    """
    if not claims:
        return []
    points = sorted({c.start for c in claims} | {c.end for c in claims if c.end is not None})
    segments = []
    for i, start in enumerate(points):
        end = points[i + 1] if i + 1 < len(points) else None
        covering = [c for c in claims if covers(c, start, end)]
        if covering:
            segments.append((start, end, max(covering, key=lambda c: c.rank)))
    pieces: List[Piece] = []
    for run in _runs(segments):
        run_start, run_end = run[0][0], run[-1][1]
        winners = {w.fact_id: w for _, _, w in run}.values()
        whole = [w for w in winners if covers(w, run_start, run_end)]
        if whole:  # at most one: two claims covering the same stretch cannot both win a segment of it
            pieces.append(Piece(whole[0].fact_id, run_start, run_end))
        else:
            pieces.extend(_split_by_fact(run))
    return pieces


def piece_at(pieces: Sequence[Piece], t: int) -> Optional[Piece]:
    for p in pieces:
        if p.start <= t and (p.end is None or t < p.end):
            return p
    return None


def _runs(segments: Sequence[tuple]) -> Iterator[list]:
    run: list = []
    for seg in segments:
        if run and run[-1][1] == seg[0] and run[-1][2].value_key == seg[2].value_key:
            run.append(seg)
        else:
            if run:
                yield run
            run = [seg]
    if run:
        yield run


def _split_by_fact(run: Sequence[tuple]) -> List[Piece]:
    out: List[Piece] = []
    for start, end, winner in run:
        if out and out[-1].fact_id == winner.fact_id and out[-1].end == start:
            out[-1] = Piece(winner.fact_id, out[-1].start, end)
        else:
            out.append(Piece(winner.fact_id, start, end))
    return out
