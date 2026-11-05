"""A bounded batch of weight edits; fresh caches and restore base between every spec."""
import argparse
import json
import time
from pathlib import Path

from context import HERE, prompt_rows, sha256, write_new_json
from quality import compare_quality, event_quality
from run_generation import generate
from runtime import close_model, hard_deadline, load_model, now, reset_shared
from weight_patch import install


def main():
    import mlx.core as mx

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--specs", required=True, help="comma-separated JSON filenames under directions/")
    parser.add_argument("--ids", default="TS3004b.w0,TS3004b.w1")
    parser.add_argument("--seconds", type=int, default=390)
    args = parser.parse_args()
    hard_deadline()
    all_rows = {r["id"]: r for r in prompt_rows()}
    rows = [all_rows[name] for name in args.ids.split(",")]
    started, lm = time.perf_counter(), load_model()
    meta = {"label": args.label, "load": lm.load_info, "started": now(), "conditions": [],
            "source": {f: sha256((HERE / f).read_bytes()) for f in ("screen_weights.py", "weight_patch.py", "run_generation.py")}}
    try:
        for filename in args.specs.split(","):
            spec = json.loads((HERE / "directions" / filename).read_text())
            label = args.label + "-" + Path(filename).stem
            path = HERE / "results" / (label + ".jsonl")
            if path.exists():
                raise FileExistsError(path)
            reset_shared()
            patch_info, undo = install(lm.model, spec)
            meta["conditions"].append({"label": label, "patch": patch_info})
            try:
                with path.open("x") as out:
                    for row in rows:
                        if time.perf_counter() - started > args.seconds - 90:
                            meta["deferred"] = {"condition": filename, "prompt": row["id"]}
                            return
                        result = generate(lm, row, stop=False)
                        result.update(condition="edit", label=label, patch=patch_info)
                        result["quality"] = event_quality(row, result["text"])
                        result["raw_clean"] = result["quality"]["parsed_cleanly"]
                        result["versus_historical"] = compare_quality(event_quality(row, row["reference"]["text"]), result["quality"])
                        out.write(json.dumps(result, ensure_ascii=False) + "\n")
                        out.flush()
                        print(json.dumps({"condition": label, **{k: result[k] for k in ("id", "output_tokens", "seconds", "finish_reason", "peak_mlx_gb", "matches_historical_bytes")},
                                          "gold": result["quality"]["gold_hits"], "lost_gold": result["versus_historical"]["lost_gold"],
                                          "valid": len(result["quality"]["unique_valid"])}), flush=True)
            finally:
                mx.synchronize()
                undo()
                reset_shared()
                mx.clear_cache()
    finally:
        close_model(lm)
        meta.update(finished=now(), seconds=time.perf_counter() - started)
        write_new_json(HERE / "results" / (args.label + ".meta.json"), meta)


if __name__ == "__main__":
    main()
