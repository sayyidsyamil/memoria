"""No-model full-development audit of what first-repeat stopping would discard."""
import argparse
import json

from context import HERE, prompt_rows, write_new_json
from quality import compare_quality, event_quality
from stop_rule import analyse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conservative", action="store_true")
    args = parser.parse_args()
    policy = {"min_repeats": 3, "unresolved_only": True} if args.conservative else {}
    results = []
    for row in prompt_rows(selected=False):
        text = row["reference"]["text"]
        detector = analyse(text, **policy)
        before = event_quality(row, text)
        after = event_quality(row, detector.closed_text())
        results.append({"id": row["id"], "trigger": detector.reason, "cut_start": detector.cut_start,
                        "observed_end": detector.observed_end, "input_chars": len(text),
                        "returned_chars": len(detector.closed_text()),
                        "reference_clean": before["parsed_cleanly"], "returned_clean": after["parsed_cleanly"],
                        "reference_unique_valid": len(before["unique_valid"]), "reference_gold": before["gold_hits"],
                        **compare_quality(before, after)})
    summary = {"windows": len(results), "triggers": sum(bool(r["trigger"]) for r in results),
               "lost_gold": sum(len(r["lost_gold"]) for r in results),
               "lost_unique_valid": sum(len(r["lost_unique_valid"]) for r in results),
               "raw_unclean": sum(not r["reference_clean"] for r in results),
               "returned_unclean": sum(not r["returned_clean"] for r in results),
               "timing": "not measured by this offline audit", "policy": policy}
    filename = "stop_conservative_offline_audit.json" if args.conservative else "stop_offline_audit.json"
    write_new_json(HERE / "results" / filename, {"summary": summary, "prompts": results})
    print(json.dumps(summary, indent=2))
    for row in results:
        if row["trigger"]:
            print(json.dumps(row))


if __name__ == "__main__":
    main()
