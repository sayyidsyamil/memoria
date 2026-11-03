"""Per-window parse/grounding/gold checks; never treats grounding as correctness."""
import json
from collections import Counter
from dataclasses import asdict
from functools import lru_cache

from context import load_chain
from memoria_engine.evaluation import metrics
from memoria_engine.extractors import parse_events
from temporal_service import repaired
from support import valid


@lru_cache(maxsize=5)
def chain_for(name):
    return load_chain(name)


def event_quality(row, text):
    chain = chain_for(row["series"])
    gm = next(m for m in chain.meetings if m.meeting.meeting_id == row["meeting"])
    candidates, clean = parse_events(text)
    fixed = [f for c in candidates if (f := repaired(c, chain.registry)) is not None]
    dispositions = [valid(gm.meeting, chain.registry, c) for c in fixed]
    grounded = [d for d in dispositions if d.status == "valid"]
    gold = {g.event_id for g in gm.events if any(metrics._same_content(d, g) and metrics._near(d.turn, g) for d in grounded)}
    signatures = {json.dumps([d.turn, d.object_id, d.attribute, d.value, d.valid_from, d.candidate.quote],
                            ensure_ascii=False) for d in grounded}
    return {"parsed_cleanly": clean, "parsed_candidates": len(candidates), "after_repair": len(fixed),
            "statuses": dict(Counter(d.status for d in dispositions)), "gold_hits": sorted(gold),
            "unique_valid": sorted(signatures), "events": [asdict(c) for c in candidates]}


def compare_quality(reference, current):
    return {"lost_gold": sorted(set(reference["gold_hits"]) - set(current["gold_hits"])),
            "added_gold": sorted(set(current["gold_hits"]) - set(reference["gold_hits"])),
            "lost_unique_valid": sorted(set(reference["unique_valid"]) - set(current["unique_valid"])),
            "added_unique_valid": sorted(set(current["unique_valid"]) - set(reference["unique_valid"]))}
