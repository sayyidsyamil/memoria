"""A constructed stream, using real grounded dev events, falsifies lossless stopping.

No model is run here. Four unresolved copies followed by a distinct correct event
are a possible complete response; the conservative rule cuts before that later event.
"""
import json

from context import HERE, prompt_rows, write_new_json
from quality import compare_quality, event_quality
from stop_rule import conservative


def main():
    row = next(r for r in prompt_rows() if r["id"] == "TS3006b.w1")
    a, b = json.loads(row["reference"]["text"])["events"][:2]
    unresolved = {**a, "unresolved": True}
    text = json.dumps({"events": [unresolved] * 4 + [b]}, ensure_ascii=False)
    detector = conservative()
    assert detector.feed(text)
    original, returned = event_quality(row, text), event_quality(row, detector.closed_text())
    difference = compare_quality(original, returned)
    assert len(original["unique_valid"]) == 1 and len(returned["unique_valid"]) == 0
    assert difference["lost_gold"] and difference["lost_unique_valid"]
    result = {"scope": "constructed streaming counterexample with real dev-source events; not a naturally observed or newly generated reply",
              "source_id": row["id"], "source_prompt_sha256": row["prompt_sha256"],
              "evidence": "TS3006b turn107 explicitly requires integrating both the screen and speech; B is LCD included, supported verbatim.",
              "input": text, "returned": detector.closed_text(), "policy": "three consecutive unresolved repeats",
              "first_repeat_termination": False, "conservative_termination": True, **difference,
              "decision": "conservative stopping remains research-only; general lossless event preservation is falsified"}
    write_new_json(HERE / "results" / "conservative_recovery_counterexample.json", result)
    print(json.dumps({k: v for k, v in result.items() if k not in ("input", "returned")}, indent=2))


if __name__ == "__main__":
    main()
