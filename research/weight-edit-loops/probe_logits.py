"""Causal next-delimiter screen on fixed derivation prefixes, not a free-generation score."""
import argparse
import json
import time

from context import HERE, prompt_rows, read_jsonl, write_new_json
from runtime import close_model, hard_deadline, load_model, now, reset_shared
from weight_patch import install


def main():
    import mlx.core as mx
    from mlx_lm.models.cache import make_prompt_cache

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--specs", required=True)
    args = parser.parse_args()
    hard_deadline()
    probe = json.loads((HERE / "results" / "activation_probe.json").read_text())
    selected = {r["id"]: r for r in prompt_rows() if r["role"].startswith("derive_")}
    baselines = {r["id"]: r for r in read_jsonl(HERE / "results" / "baseline-r1.jsonl")}
    continuation, completion = probe["continuation_id"], probe["completion_id"]
    started, lm = time.perf_counter(), load_model()
    results = []
    try:
        for filename in args.specs.split(","):
            spec = json.loads((HERE / "directions" / filename).read_text())
            info, undo = install(lm.model, spec)
            try:
                for position_spec in probe["prompts"]:
                    reset_shared()
                    row = selected[position_spec["id"]]
                    rendered = lm.tokenizer.apply_chat_template(
                        [{"role": "system", "content": row["system"]}, {"role": "user", "content": row["prompt"]}],
                        tokenize=False, add_generation_prompt=True, enable_thinking=False)
                    encoded = lm.tokenizer.encode(rendered, add_special_tokens=lm.tokenizer.bos_token is None or not rendered.startswith(lm.tokenizer.bos_token))
                    cache = make_prompt_cache(lm.model)
                    for start in range(0, len(encoded) - 1, 2048):
                        lm.model(mx.array(encoded[start:min(start + 2048, len(encoded) - 1)])[None], cache=cache)
                        mx.eval([c.state for c in cache])
                    logits = lm.model(mx.array(encoded[-1:])[None], cache=cache)[0, -1]
                    mx.eval(logits)
                    ids, boundaries = baselines[row["id"]]["token_ids"], position_spec["boundaries"]
                    mismatch, frames = 0, []
                    for j in range(max(boundaries) + 1):
                        mismatch += int(mx.argmax(logits)) != ids[j]
                        logits = lm.model(mx.array([ids[j]])[None], cache=cache)[0, -1]
                        mx.eval(logits)
                        if j in boundaries:
                            top = int(mx.argmax(logits))
                            frames.append({"position": j, "continue_minus_close": float(logits[continuation] - logits[completion]),
                                           "top_id": top, "top_text": lm.tokenizer.decode([top])})
                    result = {"spec": filename, "patch": info, "id": row["id"], "frames": frames,
                              "earlier_greedy_mismatches": mismatch}
                    results.append(result)
                    print(json.dumps({k: v for k, v in result.items() if k != "patch"}), flush=True)
                    del cache, logits
            finally:
                undo()
                reset_shared()
                mx.clear_cache()
        write_new_json(HERE / "results" / (args.label + ".json"), {
            "scope": "fixed-prefix causal logit probe only; not free-generation accuracy", "recorded": now(),
            "seconds": time.perf_counter() - started, "load": lm.load_info, "conditions": results})
    finally:
        close_model(lm)


if __name__ == "__main__":
    main()
