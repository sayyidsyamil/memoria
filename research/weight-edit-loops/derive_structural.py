"""Third hypothesis: a recurrence input feature writes against the continuation axis.

No optimizer/autograd. Last-MLP placement leaves all attention/recurrent caches
upstream of the intervention. A sparse input vector is made orthogonal to the
derivation normal's entire decode and the loop's first event. This protection is
by construction, NOT independent evidence of normal preservation. Held-out prompts
and repeat-then-new-event recovery remain mandatory.
"""
import json
import time

from context import HERE, SCRATCH, prompt_rows, read_jsonl, sha256, write_new_json
from runtime import close_model, hard_deadline, load_model, now, reset_shared


def null_feature(positive, controls, columns):
    import numpy as np
    restricted = positive[columns].astype(np.float64)
    matrix = controls[:, columns].astype(np.float64)
    _, singular, vt = np.linalg.svd(matrix, full_matrices=False)
    rank = int((singular > singular[0] * 1e-7).sum())
    vector = restricted - vt[:rank].T @ (vt[:rank] @ restricted)
    kept = float(np.linalg.norm(vector) / np.linalg.norm(restricted))
    if not np.isfinite(kept) or kept < 1e-5:
        raise ValueError("No supported recurrence direction remains after control projection")
    vector /= np.linalg.norm(vector)
    full = np.zeros_like(positive, dtype=np.float32)
    full[columns] = vector.astype(np.float32)
    return full, {"control_rank": rank, "control_rows": len(matrix), "retained_contrast_fraction": kept,
                  "max_protected_dot": float(np.max(np.abs(controls @ full)))}


def main():
    import mlx.core as mx
    import mlx.nn as nn
    import numpy as np
    from mlx_lm.models.cache import make_prompt_cache

    hard_deadline()
    started = time.perf_counter()
    selected = {r["id"]: r for r in prompt_rows() if r["role"].startswith("derive_")}
    baselines = {r["id"]: r for r in read_jsonl(HERE / "results" / "baseline-r1.jsonl")}
    prior = json.loads((HERE / "results" / "activation_probe.json").read_text())
    lm = load_model()
    index = len(lm.model.layers) - 1
    layer = lm.model.layers[index]
    base = layer.mlp.down_proj

    class Capture(nn.Module):
        def __init__(self):
            super().__init__()
            self.base = base
            self.enabled = False
            self.frames = []

        def __call__(self, x):
            if self.enabled:
                self.frames.append(x[0, -1].astype(mx.float32))
            return self.base(x)

    holder = Capture()
    layer.mlp.down_proj = holder
    captured, source = {}, []
    try:
        for info in prior["prompts"]:
            reset_shared()
            row, ids = selected[info["id"]], baselines[info["id"]]["token_ids"]
            last_position = max(info["boundaries"]) if row["role"] == "derive_loop" else len(ids) - 2
            rendered = lm.tokenizer.apply_chat_template(
                [{"role": "system", "content": row["system"]}, {"role": "user", "content": row["prompt"]}],
                tokenize=False, add_generation_prompt=True, enable_thinking=False)
            encoded = lm.tokenizer.encode(rendered, add_special_tokens=lm.tokenizer.bos_token is None or not rendered.startswith(lm.tokenizer.bos_token))
            cache = make_prompt_cache(lm.model)
            holder.enabled = False
            for start in range(0, len(encoded) - 1, 2048):
                lm.model(mx.array(encoded[start:min(start + 2048, len(encoded) - 1)])[None], cache=cache)
                mx.eval([c.state for c in cache])
            holder.enabled = True
            logits = lm.model(mx.array(encoded[-1:])[None], cache=cache)[0, -1]
            mx.eval(logits)
            mismatches = []
            for j in range(last_position + 1):
                if int(mx.argmax(logits)) != ids[j]:
                    mismatches.append(j)
                logits = lm.model(mx.array([ids[j]])[None], cache=cache)[0, -1]
                mx.eval(logits, holder.frames[-1])
            captured[row["role"]] = np.stack([np.asarray(x) for x in holder.frames])
            source.append({"id": row["id"], "role": row["role"], "last_position": last_position,
                           "prompt_sha256": row["prompt_sha256"], "greedy_mismatches": mismatches})
            assert not mismatches
            holder.frames.clear()
            holder.enabled = False
            del cache, logits
            mx.clear_cache()
        layer.mlp.down_proj = base
        loop, normal = captured["derive_loop"], captured["derive_normal"]
        boundaries = prior["prompts"][0]["boundaries"]
        # Frame 0 is the last prompt token; decoded position j is frame j+1.
        first = boundaries[0] + 1
        later = np.stack([loop[j + 1] for j in boundaries[1:]]).mean(0)
        difference = later - loop[first]
        controls = np.concatenate([loop[:first + 1], normal])
        columns = np.argsort(np.abs(difference))[-512:]
        v, geometry = null_feature(difference, controls, columns)

        language = lm.model.language_model
        head = language.model.embed_tokens if language.args.tie_word_embeddings else language.lm_head
        token_ids = [prior["continuation_id"], prior["completion_id"]]
        rows = mx.dequantize(head.weight[token_ids], head.scales[token_ids].astype(mx.float32),
                             head.biases[token_ids].astype(mx.float32), group_size=head.group_size, bits=head.bits)
        axis = np.asarray((rows[0] - rows[1]) * language.model.norm.weight.astype(mx.float32)).copy()
        u = axis / np.linalg.norm(axis)
        matrix = mx.dequantize(base.weight, base.scales.astype(mx.float32), base.biases.astype(mx.float32),
                               group_size=base.group_size, bits=base.bits)
        w_norm = float(mx.linalg.norm(matrix))
        v *= w_norm * 0.01
        random_u = np.random.default_rng(20261103).standard_normal(u.shape).astype(np.float32)
        random_u /= np.linalg.norm(random_u)
        path = HERE / "directions" / f"structural_layer{index}.npz"
        if path.exists():
            raise FileExistsError(path)
        np.savez(path, u=u, v=v, random_u=random_u, random_v=v, columns=columns)
        spec = {"family": "structural", "layer": index, "direction_file": str(path.relative_to(HERE)),
                "direction_sha256": sha256(path.read_bytes()), "seed": 20261103,
                "formula": "W' = W - strength * u v^T; u is the weighted continuation-minus-close unembedding axis",
                "unit_strength_edit_norm": float(np.linalg.norm(v)), "base_projection_norm": w_norm,
                "relative_unit_edit_norm": 0.01, "columns": len(columns),
                "u_sha256": sha256(u.tobytes()), "v_sha256": sha256(v.tobytes()),
                "selection": "last MLP; top512 recurrence-input contrasts; null all derivation-normal and first-event inputs"}
        for strength in (0, 0.5, 1, 2, 4):
            write_new_json(HERE / "directions" / f"structural_layer{index}_s{strength}.json", {**spec, "strength": strength})
        for strength in (1, 2, 4):
            write_new_json(HERE / "directions" / f"structural_layer{index}_random_output_s{strength}.json",
                           {**spec, "strength": strength, "u_key": "random_u", "v_key": "v",
                            "control": "random_output_same_input_axis_equal_weight_and_per_input_perturbation_norm"})
        write_new_json(HERE / "directions" / f"structural_layer{index}_opposite.json", {**spec, "strength": -2, "control": "opposite_sign"})
        write_new_json(HERE / "results" / "structural_derivation.json", {
            "recorded": now(), "seconds": time.perf_counter() - started, "load": lm.load_info, "source": source,
            "spec": spec, "geometry": geometry,
            "boundary_feature_values": [float(loop[j + 1] @ v) for j in boundaries],
            "max_protected_feature": float(np.max(np.abs(controls @ v))),
            "caveat": "Normal derivation preservation is imposed algebraically; only independent prompts can establish generalisation."})
        np.savez(SCRATCH / "last_mlp_inputs.npz", loop=loop, normal=normal)
        print(json.dumps({"spec": spec, "geometry": geometry,
                          "boundary_feature_values": [float(loop[j + 1] @ v) for j in boundaries]}, indent=2))
    finally:
        layer.mlp.down_proj = base
        holder.frames.clear()
        close_model(lm)


if __name__ == "__main__":
    main()
