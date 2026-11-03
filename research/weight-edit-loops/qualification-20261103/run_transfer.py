"""One bounded, interleaved independent-loop transfer lease. No search or stopping rule."""
import gc
import json
import time

from qual_common import ARCHIVE, CONTROL, EDIT, HERE, PROMPT_ID, frozen, sha256, write_new_json
from context import prompt_rows
from qual_checks import analyse, compare, decide
from run_generation import generate
from runtime import close_model, hard_deadline, load_model, now, reset_shared
from weight_patch import install


def main():
    plan = frozen()
    hard_deadline()
    output = HERE / "results"
    output.mkdir(exist_ok=True)
    destination = output / "transfer.jsonl"
    if destination.exists():
        raise FileExistsError(destination)
    row = next(r for r in prompt_rows() if r["id"] == PROMPT_ID)
    assert row["prompt_sha256"] == plan["prompt_sha256"]
    records, lm = [], None
    started = time.perf_counter()
    metadata = {"started": now(), "plan_sha256": sha256((HERE / "frozen.json").read_bytes()),
                "order": plan["conditions"], "historical_prompt_sha256": row["prompt_sha256"],
                "source": {name: sha256((HERE / name).read_bytes()) for name in ("run_transfer.py", "qual_checks.py", "qual_common.py")}}
    try:
        lm = load_model()
        import mlx.core as mx
        metadata["load"] = lm.load_info
        metadata["tokenizer_eos_ids"] = sorted(lm.tokenizer.eos_token_ids)
        with destination.open("x") as out:
            for condition in plan["conditions"]:
                if time.perf_counter() - started > 365:
                    metadata["deferred"] = condition
                    break
                reset_shared()
                undo, patch = None, None
                if condition in ("edit", "random"):
                    path = EDIT if condition == "edit" else CONTROL
                    spec = json.loads((ARCHIVE / path).read_text())
                    assert spec["strength"] == 2
                    patch, undo = install(lm.model, spec)
                try:
                    result = generate(lm, row, stop=False)
                    result.update(condition=condition, label="qualification-transfer", patch=patch,
                                  natural_eos=(result["finish_reason"] == "stop" and result["token_ids"][-1] in lm.tokenizer.eos_token_ids))
                    result["audit"] = analyse(row, result["raw_text"])
                    baseline = records[0]["audit"] if records else result["audit"]
                    result["versus_before"] = compare(baseline, result["audit"])
                    result["baseline_wrong_count"] = len(baseline["premerge_wrong_value_candidates"])
                    records.append(result)
                    out.write(json.dumps(result, ensure_ascii=False) + "\n")
                    out.flush()
                    print(json.dumps({"condition": condition, "tokens": result["output_tokens"], "seconds": result["seconds"],
                                      "natural_eos": result["natural_eos"], "strict_raw_json": result["audit"]["strict_raw_schema"],
                                      "source_controls": result["audit"]["source_control_hits"],
                                      "lost_source_controls": result["versus_before"]["lost_source_controls"],
                                      "valid": len(result["audit"]["quality"]["unique_valid"]),
                                      "matches_historical_bytes": result["matches_historical_bytes"]}), flush=True)
                finally:
                    mx.synchronize()
                    if undo:
                        undo()
                    reset_shared()
                    gc.collect()
                    mx.clear_cache()
        decision = decide(records)
        write_new_json(output / "transfer_decision.json", decision)
        print(json.dumps(decision), flush=True)
    finally:
        if lm is not None:
            close_model(lm)
        metadata.update(finished=now(), process_seconds=round(time.perf_counter() - started, 4))
        write_new_json(output / "transfer.meta.json", metadata)


if __name__ == "__main__":
    main()
