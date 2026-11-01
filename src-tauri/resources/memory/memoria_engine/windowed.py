"""Long-meeting extraction: the inner extractor reads overlapping windows of one meeting and the candidates are merged.

A small local model reads a few thousand tokens reliably but a whole hour of speech (6-9k tokens plus the prompt) much
less so. The window keeps the original turn numbers, so quotes ground exactly as before. Candidates from different
windows are merged in turn order; a repeat of the same (item, attribute, value) within `dedupe_gap` turns is dropped.
"""
from __future__ import annotations

from typing import Any, Dict, List

from .pipeline import Candidate, Meeting, MeetingContext


class WindowedExtractor:
    def __init__(self, inner: Any, window_chars: int = 7000, overlap_turns: int = 6, dedupe_gap: int = 12) -> None:
        self.inner, self.window_chars, self.overlap_turns, self.dedupe_gap = inner, window_chars, overlap_turns, dedupe_gap
        self.name = f"{getattr(inner, 'name', 'extractor')}+windows"
        self.last_stats: Dict[str, Any] = {}

    def windows(self, meeting: Meeting) -> List[List[int]]:
        """Lists of turn positions; each window holds about window_chars characters of transcript."""
        out: List[List[int]] = []
        start, n = 0, len(meeting.turns)
        while start < n:
            end, size = start, 0
            while end < n and (size + len(meeting.turns[end].text) + 12 <= self.window_chars or end == start):
                size += len(meeting.turns[end].text) + 12
                end += 1
            out.append(list(range(start, end)))
            if end >= n:
                break
            start = max(end - self.overlap_turns, start + 1)
        return out

    def extract(self, ctx: MeetingContext) -> List[Candidate]:
        meeting = ctx.meeting
        merged: List[Candidate] = []
        totals = {"prompt_tokens": 0, "output_tokens": 0, "llm_seconds": 0.0, "windows": 0, "parsed_cleanly": True}
        for positions in self.windows(meeting):
            sub = Meeting(meeting.meeting_id, meeting.occurred_at, meeting.ingested_at, tuple(meeting.turns[i] for i in positions))
            candidates = self.inner.extract(MeetingContext(sub, ctx.registry, ctx.beliefs))
            stats = getattr(self.inner, "last_stats", {}) or {}
            totals["prompt_tokens"] += stats.get("prompt_tokens") or 0
            totals["output_tokens"] += stats.get("output_tokens") or 0
            totals["llm_seconds"] += stats.get("llm_seconds") or 0.0
            totals["parsed_cleanly"] = totals["parsed_cleanly"] and bool(stats.get("parsed_cleanly", True))
            totals["windows"] += 1
            merged.extend(candidates)
        merged.sort(key=lambda c: (c.turn if c.turn is not None else -1))
        kept: List[Candidate] = []
        for c in merged:
            twin = next((k for k in reversed(kept) if (k.object_id, k.attribute, str(k.value).casefold()) == (c.object_id, c.attribute, str(c.value).casefold())
                         and abs((k.turn or 0) - (c.turn or 0)) <= self.dedupe_gap), None)
            if twin is None:
                kept.append(c)
            elif (c.confidence or 0) > (twin.confidence or 0):
                kept[kept.index(twin)] = c
        self.last_stats = {**totals, "llm_seconds": round(totals["llm_seconds"], 2), "raw": f"{totals['windows']} windows"}
        return kept
