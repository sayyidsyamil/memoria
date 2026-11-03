"""Gate calibration/causal screen on derivation prefixes only, with fresh caches.

Also records the unedited feature throughout each generated prefix; phase gating
is explicit and prompt prefill is never steered. No free-generation success claim.
"""
import argparse
import json
import time

from context import HERE, prompt_rows, read_jsonl, sha256, write_new_json
from runtime import close_model, hard_deadline, load_model, now, reset_shared


def main():
    import mlx.core as mx
    import mlx.nn as nn
    import numpy as np
    from mlx_lm.models.cache import make_prompt_cache
    from activation_gate import install

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", default="gate-causal")
    parser.add_argument("--specs", default="base,gate_layer30_t2_s12.json,gate_layer30_t2_s24.json,gate_layer30_t2_s24_random_output.json")
    args = parser.parse_args()
    hard_deadline()
    prior = json.loads((HERE / "results" / "activation_probe.json").read_text())
    rows = {r["id"]: r for r in prompt_rows() if r["role"].startswith("derive_")}
    baseline = {r["id"]: r for r in read_jsonl(HERE / "results" / "baseline-r1.jsonl")}
    vector_spec = json.loads((HERE / "directions" / "contrast_layer30_s1.json").read_text())
    v = mx.array(np.load(HERE / vector_spec["direction_file"])["v"])
    started, lm = time.perf_counter(), load_model()
    results = []

    class Observe(nn.Module):
        def __init__(self, base):
            super().__init__()
            self.base = base
            self.enabled = False
            self.features = []

        def __call__(self, x):
            if self.enabled:
                self.features.append((x[0, -1].astype(mx.float32) @ v))
            return self.base(x)

    try:
        for name in args.specs.split(","):
            adapter = undo = None
            metadata = {"kind": "unchanged"}
            if name != "base":
                metadata, undo, adapter = install(lm.model, json.loads((HERE / "directions" / name).read_text()))
            layer = lm.model.layers[30]
            previous = layer.mlp.down_proj
            observer = Observe(previous)
            layer.mlp.down_proj = observer
            try:
                for info in prior["prompts"]:
                    reset_shared()
                    if adapter:
                        adapter.reset()
                    observer.enabled = False
                    observer.features.clear()
                    row, ids = rows[info["id"]], baseline[info["id"]]["token_ids"]
                    is_normal = row["role"] == "derive_normal"
                    last_position = len(ids) - 2 if is_normal else max(info["boundaries"])
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
                    if adapter:
                        adapter.enable()
                    observer.enabled = True
                    mismatches, frames = [], []
                    for j in range(last_position + 1):
                        got = int(mx.argmax(logits))
                        if got != ids[j]:
                            mismatches.append({"position": j, "expected": ids[j], "got": got})
                        logits = lm.model(mx.array([ids[j]])[None], cache=cache)[0, -1]
                        mx.eval(logits, observer.features[-1])
                        if j in info["boundaries"]:
                            top = int(mx.argmax(logits))
                            frames.append({"position": j, "feature": float(observer.features[-1]),
                                           "continue_minus_close": float(logits[prior["continuation_id"]] - logits[prior["completion_id"]]),
                                           "top_id": top, "top_text": lm.tokenizer.decode([top])})
                    if is_normal and int(mx.argmax(logits)) != ids[-1]:
                        mismatches.append({"position": len(ids) - 1, "expected": ids[-1], "got": int(mx.argmax(logits))})
                    features = [float(x) for x in observer.features]
                    record = {"spec": name, "metadata": metadata, "id": row["id"], "role": row["role"],
                              "frames": frames, "greedy_mismatches": mismatches,
                              "feature_min": min(features), "feature_max": max(features),
                              "features_over2": sum(x > 2 for x in features), "observations": len(features),
                              "features": features if name == "base" else None}
                    results.append(record)
                    print(json.dumps({k: v for k, v in record.items() if k not in ("metadata", "features")}), flush=True)
                    del cache, logits
                    observer.features.clear()
                    mx.clear_cache()
            finally:
                layer.mlp.down_proj = previous
                if undo:
                    undo()
                reset_shared()
        write_new_json(HERE / "results" / (args.label + ".json"), {
            "scope": "derivation-only causal nonlinear activation probe; not free-generation evidence", "recorded": now(),
            "seconds": time.perf_counter() - started, "load": lm.load_info,
            "source": {f: sha256((HERE / f).read_bytes()) for f in ("probe_gate.py", "activation_gate.py")},
            "conditions": results})
    finally:
        close_model(lm)


if __name__ == "__main__":
    main()
