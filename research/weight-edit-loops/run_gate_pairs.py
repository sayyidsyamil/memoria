"""Adjacent base/nonlinear-adapter free generations, alternating order by prompt."""
import argparse
import json
import time

from context import HERE, prompt_rows, sha256, write_new_json
from activation_gate import install
import anchors
from quality import compare_quality, event_quality
from run_generation import generate
from runtime import close_model, hard_deadline, load_model, now, reset_shared


def main():
    import mlx.core as mx
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--ids", required=True)
    args = parser.parse_args()
    hard_deadline()
    rows_by_id = {r["id"]: r for r in prompt_rows()}
    rows = [rows_by_id[name] for name in args.ids.split(",")]
    spec = json.loads((HERE / "directions" / args.spec).read_text())
    started, lm = time.perf_counter(), load_model()
    metadata = {"label": args.label, "spec": spec, "load": lm.load_info, "started": now(),
                "design": "adjacent base/gate, alternating AB/BA order by prompt; no early stopping",
                "source": {f: sha256((HERE / f).read_bytes()) for f in ("run_gate_pairs.py", "run_generation.py", "activation_gate.py")}}
    try:
        with (HERE / "results" / (args.label + ".jsonl")).open("x") as out:
            for index, row in enumerate(rows):
                for condition in (("base", "gate") if index % 2 == 0 else ("gate", "base")):
                    if time.perf_counter() - started > 370:
                        metadata["deferred"] = {"id": row["id"], "condition": condition}
                        return
                    controller = undo = None
                    if condition == "gate":
                        info, undo, controller = install(lm.model, spec)
                    try:
                        reset_shared()
                        result = generate(lm, row, controller=controller)
                        result.update(condition=condition, label=args.label)
                        if condition == "gate":
                            result["adapter"] = info
                            assert not controller.active
                        reference = event_quality(row, row["reference"]["text"])
                        result["quality"] = event_quality(row, result["text"])
                        result["raw_clean"] = result["quality"]["parsed_cleanly"]
                        result["versus_historical"] = compare_quality(reference, result["quality"])
                        result["anchor_control"] = anchors.compare(row["id"], reference, result["quality"])
                        out.write(json.dumps(result, ensure_ascii=False) + "\n")
                        out.flush()
                        print(json.dumps({"condition": condition, **{k: result[k] for k in ("id", "output_tokens", "seconds", "finish_reason", "matches_historical_bytes")},
                                          "lost_gold": result["versus_historical"]["lost_gold"], "lost_anchors": result["anchor_control"]["lost_anchors"],
                                          "raw_clean": result["raw_clean"]}), flush=True)
                    finally:
                        if undo:
                            undo()
                        reset_shared()
                        mx.clear_cache()
    finally:
        close_model(lm)
        metadata.update(finished=now(), seconds=time.perf_counter() - started)
        write_new_json(HERE / "results" / (args.label + ".meta.json"), metadata)


if __name__ == "__main__":
    main()
