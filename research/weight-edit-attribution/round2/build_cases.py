"""Freeze paired component-binding fixtures, retaining exact old cached-prompt provenance."""
import dataclasses
import json
import re

from r2_common import HERE, R1, load_dev, sha, verify_round1, write_json
from memoria_engine.extractors import SCHEMA, _describe

# Pairing changes only subject/antecedent. Original source is retained separately.
SEEDS = [
    ("ES2003b", 177, "case_curve", "case_button_curve", "double curved", "direct-curve", 175, 178),
    ("ES2003c", 102, "case_material", "case_button_material", "rubber", "direct-rubber", 101, 103),
    ("TS3004c", 117, "case_material", "case_button_material", "rubber", "direct-rubber-ts", 116, 119),
    ("TS3004d", 176, "case_material", "case_button_material", "plastic", "antecedent-plastic", 174, 178),
    ("IS1008d", 19, "case_material", "case_button_material", "wood", "direct-wood", 18, 19),
    ("TS3006d", 530, "case_material", "case_button_material", "plastic", "antecedent-final", 529, 530),
]


def pick_prompt(prompts, meeting, lo, hi):
    for p in prompts:
        text = p["prompt"].split("Transcript:\n", 1)[1]
        if p["meeting"] == meeting and f"[{lo}] " in text and f"[{hi}] " in text:
            return p
    raise AssertionError((meeting, lo, hi))


def registry_block(registry, target, other, dual):
    spec = registry.objects[target]
    lines = []
    for obj in registry.objects.values():
        # IS1008 already has a differently constrained button-material slot.
        # Remove it in BOTH controlled conditions, then add a same-enum alias.
        if obj.object_id == "button_material":
            continue
        lines.append(f"- {obj.object_id}: {obj.label} ({obj.kind}): " + ", ".join(_describe(a) for a in obj.attributes))
    if dual:
        label = "Curve of the remote control enter button" if "curve" in target else "Material of the remote control buttons"
        lines.append(f"- {other}: {label} (decision): " + ", ".join(_describe(a) for a in spec.attributes))
    return "\n".join(lines)


def put_transcript(prompt, turns):
    head = prompt.split("Transcript:\n", 1)[0]
    return head + "Transcript:\n" + "\n".join(f"[{t['index']}] {t['speaker']}: {t['text']}" for t in turns) + "\n"


def source_expected(anchor, obj, value, word):
    return {"turn": anchor, "object_id": obj, "attribute": "outcome", "value": value, "value_word": word}


def main():
    integrity = verify_round1()
    prompts = json.loads((R1 / "data/prompts.json").read_text())["app"]
    chains = {c.chain_id: c for c in load_dev()}
    cases = []
    for k, (meeting, anchor, target, other, value, kind, lo, hi) in enumerate(SEEDS):
        chain = chains[meeting[:-1]]
        gm = next(m for m in chain.meetings if m.meeting.meeting_id == meeting)
        p = pick_prompt(prompts, meeting, lo, hi)
        original = [dataclasses.asdict(t) for t in gm.meeting.turns[lo:hi+1]]
        for dual in (True, False):
            for subject in ("case", "buttons"):
                turns = [dict(t) for t in original]
                by_index = {t["index"]: t for t in turns}
                if kind == "direct-curve":
                    component = "case" if subject == "case" else "enter button"
                    quote = f"We will use a double-curved shape for the {component}."
                    by_index[anchor]["text"] = quote
                elif kind == "direct-rubber":
                    quote = f"we've decided on flexible rubber for the {subject}."
                    old = "looks like we're pretty much decided on some kind of flexible rubber."
                    assert old in by_index[anchor]["text"]
                    by_index[anchor]["text"] = by_index[anchor]["text"].replace(old, quote)
                elif kind == "direct-rubber-ts":
                    quote = f"We will use rubber for the {subject}."
                    old = "I think it's pretty standard, these rubber buttons on the top."
                    assert old in by_index[anchor]["text"]
                    by_index[anchor]["text"] = by_index[anchor]["text"].replace(old, quote)
                elif kind == "antecedent-plastic":
                    quote = "Just hard plastic."
                    assert "the buttons?" in by_index[175]["text"]
                    by_index[175]["text"] = by_index[175]["text"].replace("the buttons?", f"the {subject}?")
                elif kind == "direct-wood":
                    quote = f"the material that we chose for the {subject} was wood"
                    old = "the material that we chose was wood"
                    assert old in by_index[anchor]["text"]
                    by_index[anchor]["text"] = by_index[anchor]["text"].replace(old, quote)
                else:
                    by_index[529]["text"] = f"What material do we use for the {subject}?"
                    by_index[anchor]["text"] = quote = "It's plastic."
                assert quote in by_index[anchor]["text"]
                prompt = put_transcript(p["prompt"], turns)
                start = prompt.index("\n- ", prompt.index("Tracked items")) + 1
                end = prompt.index("\nPeople:", start)
                prompt = prompt[:start] + registry_block(chain.registry, target, other, dual) + prompt[end:]
                prompt = re.sub(r"^- button_material\.[^\n]*\n", "", prompt, flags=re.M)
                chosen = target if subject == "case" else other if dual else None
                expected = [] if chosen is None else [source_expected(anchor, chosen, value, "double" if value == "double curved" else value)]
                if kind == "direct-rubber":
                    expected += [source_expected(anchor, "battery", "lithium", "lithium"),
                                 source_expected(anchor, "case_curve", "double curved", "double curved")]
                if kind == "direct-wood":
                    expected += [source_expected(anchor, "speech", "included", "voice recognition"),
                                 source_expected(anchor, "lcd", "included", "L_C_D_")]
                case = {"id": f"p{k}-{int(dual)}-{subject}", "pair": f"p{k}-{int(dual)}", "anchor_group": f"p{k}",
                        "split": "derive" if k < 4 else "check", "kind": "controlled-pair", "subject": subject,
                        "dual_tracked": dual, "meeting": meeting, "turn": anchor, "quote": quote, "value": value,
                        "target_id": target, "other_id": other, "correct_object_id": chosen, "expected": expected,
                        "prompt": prompt, "system": p["system"], "prompt_sha256": sha(prompt),
                        "source_prompt_key": p["key"], "source_prompt_sha256": p["prompt_sha256"],
                        "original_source": original, "source": turns,
                        "controlled_edits": {"form": kind, "subject": subject, "registry": "same-enum button alias added" if dual else "button material/curve untracked",
                                              "extra": "existing button_material removed in both controlled registry modes"}}
                cases.append(case)
    # Natural-source cases: no rewriting and no alias registry. Read only the
    # selected excerpt, with strictly source-anchored expected bindings.
    natural = [
        ("ES2003b", 177, 175, 178, []),
        ("TS3004c", 117, 116, 119, []),
        ("TS3004d", 176, 174, 178, []),
        ("IS1008b", 43, 41, 44, []),
        ("IS1008d", 19, 18, 19, [source_expected(19, "case_material", "wood", "wood"),
                                source_expected(19, "speech", "included", "voice recognition"),
                                source_expected(19, "lcd", "included", "L_C_D_")]),
        ("TS3006d", 423, 419, 425, [source_expected(420, "case_material", "plastic", "plastic")]),
    ]
    for k, (meeting, anchor, lo, hi, expected) in enumerate(natural):
        chain = chains[meeting[:-1]]
        gm = next(m for m in chain.meetings if m.meeting.meeting_id == meeting)
        p = pick_prompt(prompts, meeting, lo, hi)
        turns = [dataclasses.asdict(t) for t in gm.meeting.turns[lo:hi+1]]
        prompt = put_transcript(p["prompt"], turns)
        cases.append({"id": f"n{k}", "kind": "natural", "split": "derive" if k < 3 else "check", "meeting": meeting,
                      "turn": anchor, "expected": expected, "prompt": prompt, "system": p["system"],
                      "prompt_sha256": sha(prompt), "source_prompt_key": p["key"], "source_prompt_sha256": p["prompt_sha256"],
                      "source": turns, "original_source": turns, "controlled_edits": None})
    write_json(HERE / "data/cases.json", cases)
    write_json(HERE / "data/freeze.json", {"round1_hashes_verified": integrity, "case_sha256": sha((HERE / "data/cases.json").read_bytes()),
                                         "protocol_sha256": sha((HERE / "PROTOCOL.md").read_bytes()), "n_cases": len(cases),
                                         "controlled": 24, "natural": 6, "derive_anchors": [s[0] for s in SEEDS[:4]],
                                         "check_anchors": [s[0] for s in SEEDS[4:]], "layer_grid": [7, 17, 25]})
    print(json.dumps({"frozen_cases": len(cases), "controlled": 24, "natural": 6, "round1_hashes_match": integrity}))


if __name__ == "__main__":
    main()
