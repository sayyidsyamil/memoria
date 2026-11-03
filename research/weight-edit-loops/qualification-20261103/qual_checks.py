"""Evaluation only: source-supported controls and explicit transfer decisions."""
import json
import re
from functools import lru_cache

import qual_common  # establishes archived import paths
from context import load_chain
from quality import compare_quality, event_quality
from memoria_engine.extractors import parse_events
from memoria_engine.pipeline import ground
from memoria_engine.evaluation.oracle import values_equal
from temporal_service import repaired
from support import valid

SOURCE_CONTROLS = [
    {"id": "buttons-t8", "turn": 8, "object_id": "buttons", "attribute": "outcome", "value": "separate buttons", "quote_word": "buttons"},
    {"id": "lcd-t8", "turn": 8, "object_id": "lcd", "attribute": "outcome", "value": "included", "quote_word": "lcd"},
    {"id": "speech-t8", "turn": 8, "object_id": "speech", "attribute": "outcome", "value": "included", "quote_word": "speech"},
    {"id": "chip-t8", "turn": 8, "object_id": "chip", "attribute": "outcome", "value": "advanced chip", "quote_word": "chip"},
    {"id": "energy-t8", "turn": 8, "object_id": "energy", "attribute": "outcome", "value": "kinetic", "quote_word": "kinetic"},
    {"id": "single-curve-t23", "turn": 23, "object_id": "case_curve", "attribute": "outcome", "value": "single curved", "quote_word": "single curve"},
]


@lru_cache(maxsize=5)
def data(series):
    chain = load_chain(series)
    import harness
    return chain, harness.gold_pipeline(chain)


def analyse(row, text):
    chain, gold = data(row["series"])
    gm = next(m for m in chain.meetings if m.meeting.meeting_id == row["meeting"])
    candidates, _ = parse_events(text)
    source_events, hits = set(), set()
    for c in candidates:
        located = ground(gm.meeting, c.quote, c.turn)
        if located is None:
            continue
        try:
            value = chain.registry.normalise(c.object_id, c.attribute, c.value)
        except (KeyError, ValueError, TypeError):
            continue
        source_events.add(json.dumps([located[0], c.object_id, c.attribute, value, c.valid_from], ensure_ascii=False))
        quote = re.sub(r"\s+", " ", c.quote.lower().replace("_", ""))
        for control in SOURCE_CONTROLS:
            if (located[0] == control["turn"] and c.object_id == control["object_id"]
                    and c.attribute == control["attribute"] and values_equal(value, control["value"])
                    and control["quote_word"] in quote):
                hits.add(control["id"])
    fixed = [f for c in candidates if (f := repaired(c, chain.registry)) is not None]
    wrong = []
    for c in fixed:
        disposition = valid(gm.meeting, chain.registry, c)
        if disposition.status != "valid":
            continue
        truth = gold.ledger.as_of(disposition.object_id, disposition.attribute,
                                 valid_at=gm.meeting.occurred_at + 86_400_000_000 - 1)
        if truth is None or not values_equal(truth.value, disposition.value):
            wrong.append([disposition.turn, disposition.object_id, disposition.attribute, disposition.value])
    try:
        document = json.loads(text)
        raw_schema = (isinstance(document, dict) and isinstance(document.get("events"), list)
                      and all(isinstance(e, dict) for e in document["events"]))
    except (ValueError, TypeError):
        raw_schema = False
    quality = event_quality(row, text)
    unique_parsed = {json.dumps([c.turn, c.quote, c.object_id, c.attribute, c.value, c.valid_from],
                                ensure_ascii=False) for c in candidates}
    return {"quality": quality, "strict_raw_schema": raw_schema,
            "nonempty_events": bool(candidates), "unique_parsed": sorted(unique_parsed),
            "source_grounded_cores": sorted(source_events), "source_control_hits": sorted(hits),
            "premerge_wrong_value_candidates": wrong}


def compare(reference, current):
    return {**compare_quality(reference["quality"], current["quality"]),
            "lost_unique_parsed": sorted(set(reference["unique_parsed"]) - set(current["unique_parsed"])),
            "lost_source_grounded_cores": sorted(set(reference["source_grounded_cores"]) - set(current["source_grounded_cores"])),
            "lost_source_controls": sorted(set(reference["source_control_hits"]) - set(current["source_control_hits"]))}


def preservation_ok(row):
    losses, audit = row["versus_before"], row["audit"]
    return (not losses["lost_gold"] and not losses["lost_unique_valid"] and not losses["lost_source_controls"]
            and len(audit["premerge_wrong_value_candidates"]) <= row["baseline_wrong_count"])


def decide(records):
    by = {r["condition"]: r for r in records}
    required = {"base-before", "edit", "random", "base-after"}
    if set(by) != required:
        return {"outcome": "incomplete", "passed": False, "failures": ["missing planned first-lease conditions"]}
    before, edit, random, after = (by[n] for n in ("base-before", "edit", "random", "base-after"))
    failures = []
    if not (before["matches_historical_bytes"] and after["matches_historical_bytes"]
            and before["hit_budget"] and after["hit_budget"]):
        failures.append("baseline/restore identity failure")
    completion = (edit["natural_eos"] and not edit["hit_budget"] and not edit["early_stopped"]
                  and edit["raw_text"] == edit["text"] and edit["audit"]["strict_raw_schema"]
                  and edit["audit"]["nonempty_events"])
    if not completion:
        failures.append("independent loop did not become a nonempty raw-JSON natural-EOS completion")
    if not preservation_ok(edit):
        failures.append("event/source/wrong-value preservation gate failed")
    if not (edit["output_tokens"] < min(before["output_tokens"], after["output_tokens"])
            and edit["seconds"] < min(before["seconds"], after["seconds"])):
        failures.append("no token/time improvement over both bracketing bases")
    random_success = (random["natural_eos"] and not random["hit_budget"] and random["audit"]["strict_raw_schema"]
                      and random["audit"]["nonempty_events"] and preservation_ok(random)
                      and random["seconds"] < min(before["seconds"], after["seconds"]))
    if random_success and not (edit["output_tokens"] < random["output_tokens"] and edit["seconds"] < random["seconds"]):
        failures.append("not distinguished from the matched random control")
    return {"outcome": "transfer-pass" if not failures else "failed-transfer-or-collateral", "passed": not failures,
            "failures": failures, "matched_random_success": random_success,
            "development_candidate": False, "shipping_or_newval_authorised": False}
