"""Interleaved base/conservative timings, with order alternated between prompts."""
import argparse
import json
import time

from context import HERE, prompt_rows, write_new_json
from quality import compare_quality, event_quality
from run_generation import generate
from runtime import close_model, hard_deadline, load_model, now


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--ids", default="TS3004b.w0,TS3006d.w0,TS3006d.w3")
    args = parser.parse_args()
    hard_deadline()
    rows_by_id = {r["id"]: r for r in prompt_rows()}
    rows = [rows_by_id[name] for name in args.ids.split(",")]
    started, lm = time.perf_counter(), load_model()
    meta = {"label": args.label, "load": lm.load_info, "started": now(),
            "design": "adjacent base/conservative for each prompt; AB, BA, AB order"}
    try:
        with (HERE / "results" / (args.label + ".jsonl")).open("x") as out:
            for index, row in enumerate(rows):
                conditions = ("base", "conservative") if index % 2 == 0 else ("conservative", "base")
                for condition in conditions:
                    if time.perf_counter() - started > 375:
                        meta["deferred"] = {"id": row["id"], "condition": condition}
                        return
                    result = generate(lm, row, stop="conservative" if condition == "conservative" else False)
                    result.update(condition=condition, label=args.label)
                    result["quality"] = event_quality(row, result["text"])
                    result["raw_clean"] = event_quality(row, result["raw_text"])["parsed_cleanly"]
                    result["versus_historical"] = compare_quality(event_quality(row, row["reference"]["text"]), result["quality"])
                    out.write(json.dumps(result, ensure_ascii=False) + "\n")
                    out.flush()
                    print(json.dumps({"condition": condition, **{k: result[k] for k in ("id", "output_tokens", "seconds", "finish_reason", "matches_historical_bytes")}}), flush=True)
    finally:
        close_model(lm)
        meta.update(finished=now(), seconds=time.perf_counter() - started)
        write_new_json(HERE / "results" / (args.label + ".meta.json"), meta)


if __name__ == "__main__":
    main()
