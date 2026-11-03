"""Consolidation: when one meeting writes different values for the same tracked slot, ask the model which value the
meeting settled on, from the excerpts where the slot comes up, and keep only that value's writes.

Asked only for slots with conflicting values in a meeting (a single value is left alone). An answer of "none", an
unreadable reply or a thinking reply that does not finish within its budget changes nothing (all writes kept), so
consolidation never removes every value of a slot. Wording and context fixed before reading app-path dev output beyond
ES2003 (whose conflicts motivated it: battery conventional -> lithium; case curve single -> double -> single).
"""
import json
import re

from memoria_engine.evaluation.oracle import values_equal

CLIP = 250
TEMPLATE = (
    "Tracked item: {label} ({attribute}). Allowed values: {allowed}.\n"
    "Value in force before this meeting: {before}.\n"
    "The item comes up at these points of the meeting, in order (the marked line >> is where a value was noted):\n\n"
    "{excerpts}\n\n"
    "Which value did the team settle on for {label} by the end of this meeting? Suggestions, questions and remarks the "
    "team moved past do not count; the value they agreed on or ended with does. If the meeting settled none of these "
    "values, answer none.\nReply with JSON only: {{\"value\": \"<{choices}>\"}}"
)


def _clip(text):
    return text if len(text) <= CLIP else text[:CLIP].rsplit(" ", 1)[0] + " ..."


def question(meeting, registry, slot, points, before):
    spec = registry.objects[slot[0]]
    attribute = spec.attribute(slot[1])
    values = list(attribute.values) if attribute.type == "enum" else sorted({str(v) for _, v in points})
    blocks = []
    for turn, _ in sorted(set((t, str(v)) for t, v in points)):
        lines = []
        for t in meeting.turns[max(0, turn - 1): turn + 2]:
            marked = t.index == meeting.turns[turn].index
            lines.append(f"{'>> ' if marked else '   '}[{t.index}] {registry.people.get(t.speaker, t.speaker)}: {t.text if marked else _clip(t.text)}")
        blocks.append("\n".join(lines))
    return TEMPLATE.format(label=spec.label, attribute=slot[1], allowed=", ".join(values), before=before if before is not None else "none",
                           excerpts="\n...\n".join(blocks), choices=" | ".join(values + ["none"]))


def answer(text):
    text = text.rsplit("</think>", 1)[-1]
    start, end = text.find("{"), text.rfind("}")
    try:
        value = json.loads(text[start:end + 1]).get("value")
        return None if value is None or str(value).strip().casefold() == "none" else value
    except (ValueError, AttributeError):
        return None


def consolidate_meeting(chain, meeting, valid, beliefs, lm, think=False):
    """(ids of the candidates kept, log) for one meeting; valid = [(candidate, disposition from support.valid)]."""
    from lm import APP_SYSTEM
    slots, log = {}, []
    for c, v in valid:
        if v.status == "valid":
            slots.setdefault((v.object_id, v.attribute), []).append((c, v))
    chosen = {}
    for slot, rows in slots.items():
        if len({str(v.value).casefold() for _, v in rows}) < 2:
            continue
        prompt = question(meeting, chain.registry, slot, [(v.turn, v.value) for _, v in rows], beliefs.get(slot))
        record = lm.app_generate(prompt, 1024 if think else 60, APP_SYSTEM, tag=f"consolidate:{meeting.meeting_id}", think=think)
        value = answer(record["text"]) if not (think and "</think>" not in record["text"]) else None
        if value is not None and any(values_equal(v.value, value) for _, v in rows):
            chosen[slot] = value
        log.append({"meeting": meeting.meeting_id, "slot": slot, "values": sorted({str(v.value) for _, v in rows}), "answer": value,
                    "seconds": record["seconds"], "tokens": record["output_tokens"]})
    kept = set()
    for c, v in valid:
        slot = (v.object_id, v.attribute) if v.status == "valid" else None
        if slot not in chosen or values_equal(v.value, chosen[slot]):
            kept.add(id(c))
    return kept, log
