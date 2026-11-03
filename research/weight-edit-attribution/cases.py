"""Freeze source-level labels before inference; no labels are inferred from model preferences."""
import json
import re

from common import HERE, OLD, load_dev, write_json

# meeting, turn, slot, value, support, reason. 8 positives / 8 negatives per split.
SPECS = [
    ("ES2003c", 17, "battery", "conventional", False, "tentative: recommendation 'probably'; final battery is settled at turn 102"),
    ("ES2003d", 172, "case_curve", "double curved", False, "rating: one versus two is a fanciness score, not a new curve decision"),
    ("ES2003d", 194, "colour", "yellow", False, "prototype-only: explicitly says yellow was used because it was available; discusses alternatives"),
    ("TS3004b", 181, "lcd", "included", False, "wrong object: deciding indicator-light colour does not add an LCD"),
    ("TS3004c", 117, "case_material", "rubber", False, "wrong object: rubber modifies buttons, not case"),
    ("TS3004d", 249, "teletext", "excluded", False, "wrong object: 'do it' accepts slide-open lighting, not removal of teletext"),
    ("TS3004d", 175, "case_material", "plastic", False, "wrong object despite gold agreement: question and answer concern button material"),
    ("ES2003c", 51, "case_curve", "single curved", False, "tentative: conditional cost proposal, later double curve is adopted"),
    ("ES2003c", 102, "case_material", "rubber", True, "chair sums up agreed flexible rubber design; following turn elaborates its structure"),
    ("ES2003c", 102, "battery", "lithium", True, "chair's adopted design uses a lithium-ion battery, even though phrased 'something like'"),
    ("ES2003d", 99, "lcd", "included", True, "chair summarizes general opinion to keep the LCD despite cost"),
    ("ES2003d", 54, "case_curve", "single curved", True, "cost-driven single-curve redesign is adopted; linked gold decision"),
    ("TS3004a", 124, "remote_type", "universal", True, "explicit agreement on universal remote with subsequent acknowledgements"),
    ("TS3004b", 349, "speech", "excluded", True, "explicit no-speech decision accepted by following speakers"),
    ("TS3004c", 185, "case_material", "plastic", True, "case surface chosen as hard plastic, then speaker changes topic to buttons"),
    ("TS3004d", 32, "case_material", "plastic", True, "present final design explicitly specifies hard-plastic material"),
    ("ES2011b", 61, "speech", "excluded", False, "wrong attribute: target demographic is not a decision to exclude speech"),
    ("ES2011b", 73, "locator_signal", "LED light", False, "wrong value: buzzer/beep is discussed and accepted, no LED at this anchor"),
    ("ES2011c", 27, "locator_signal", "LED light", False, "wrong object: DVD support does not determine locator-signal type"),
    ("IS1008d", 19, "button_material", "hard plastic", False, "unsupported: recap specifies wood case and functionality, no hard-plastic buttons"),
    ("IS1008c", 136, "lcd", "included", False, "tentative: asks whether with or without display; following discussion considers dropping it"),
    ("TS3006c", 525, "chip", "simple chip", False, "wrong object: screen protection / no flipping does not choose chip"),
    ("TS3006d", 423, "case_material", "rubber", False, "rating comparison: preceding turns explicitly retain plastic; one/two scores durability"),
    ("IS1008b", 43, "case_material", "plastic", False, "unsupported: company profit objective contains no case-material decision"),
    ("ES2011b", 73, "locator_signal", "sound", True, "buzzer proposal is resolved as remote beeping in following turn and accepted"),
    ("ES2011d", 2, "case_material", "spongy material", True, "present design explicitly describes spongy base; supported recap, not a new change"),
    ("ES2011d", 2, "changeable_case", "included", True, "present design explicitly has interchangeable base; supported recap"),
    ("IS1008d", 19, "case_material", "wood", True, "explicit recap of chosen wood case; support does not imply a new change"),
    ("IS1008d", 60, "chip", "advanced chip", True, "costing of agreed chip-on-print design reaffirms selected component"),
    ("TS3006c", 113, "energy", "kinetic", True, "chair explicitly states kinetic was already decided"),
    ("TS3006d", 150, "energy", "hand dynamo", True, "only viable option to retain display is hand dynamo, accepted in following turns"),
    ("TS3006d", 530, "case_material", "plastic", True, "explicit final design recap: plastic and single curved"),
]

RULE = (
    "Check a proposed meeting-ledger entry against its source. Does this source, read in context, support "
    "the ENTRY as an adopted or still-current design/decision? Answer YES only when the item, field and "
    "value refer to that entry. A commitment phrased informally can count. A correctly described current "
    "design can count. Answer NO for another object's property, an unresolved alternative, a rating of "
    "the design, or a historical prototype colour offered as the current decision. Do not decide merely "
    "because a value word occurs. Reply with exactly YES or NO."
)


def probe(case, context=True, full=False):
    lines = case["source"] if context else [t for t in case["source"] if t["index"] == case["turn"]]
    excerpt = "\n".join(f"{'>> ' if t['index'] == case['turn'] else ''}[{t['index']}] {t['speaker']}: {t['text']}" for t in lines)
    if full:
        excerpt = case["full_prompt"] + "\n\nFor this diagnostic, check only the following quoted entry.\n" + excerpt
    return [{"role": "user", "content": f"{RULE}\n\nENTRY: {case['label']} ({case['object_id']}.{case['attribute']}) = {case['value']}\nSOURCE:\n{excerpt}\n\nAnswer:"}]


def main():
    rows = json.loads((HERE / "data/evidence.json").read_text())
    prompts = json.loads((HERE / "data/prompts.json").read_text())["app"]
    chains = {c.chain_id: c for c in load_dev()}
    out = []
    for i, (meeting, turn, obj, value, expected, reason) in enumerate(SPECS):
        row = next(r for r in rows if (r["meeting"], r["turn"], r["object_id"], r["value"]) == (meeting, turn, obj, value))
        options = [p for p in prompts if p["meeting"] == meeting and f"[{turn}] " in p["prompt"]]
        # Prefer the exact cached reply that wrote this value at this turn.
        def emitted(p):
            from memoria_engine.extractors import parse_events
            cs, _ = parse_events(p["baseline"]["text"])
            return any(c.turn == turn and c.object_id == obj and str(c.value) == str(value) for c in cs)
        prompt = next((p for p in options if emitted(p)), options[0])
        case = {**row, "id": f"a{i:02d}", "split": "derive" if row["series"] in OLD else "check",
                "expected_support": expected, "reason": reason,
                "label": chains[row["series"]].registry.objects[obj].label,
                "prompt_key": prompt["key"], "full_prompt": prompt["prompt"], "system": prompt["system"]}
        out.append(case)
    write_json(HERE / "data/cases.json", out)
    print(json.dumps({"cases": len(out), "old": 16, "new": 16, "positive_per_split": 8,
                      "full_prompt_keys": len({c['prompt_key'] for c in out})}))


if __name__ == "__main__":
    main()
