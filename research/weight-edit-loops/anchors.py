"""Evaluation-only explicit later-event controls, separate from frozen coordinator gold."""
import json

from context import HERE

ANCHORS = json.loads((HERE / "data" / "preservation_anchors.json").read_text())["anchors"]


def hits(prompt_id, quality):
    candidates = [json.loads(s) for s in quality["unique_valid"]]
    return [a["id"] for a in ANCHORS if a["prompt_id"] == prompt_id and any(
        c[0] in a["turns"] and c[1:4] == [a["object_id"], a["attribute"], a["value"]]
        for c in candidates)]


def compare(prompt_id, reference, current):
    before, after = set(hits(prompt_id, reference)), set(hits(prompt_id, current))
    return {"reference_anchors": sorted(before), "anchor_hits": sorted(after), "lost_anchors": sorted(before - after)}
