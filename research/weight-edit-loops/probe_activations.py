"""Teacher-force the derivation pair only; inspect all MLP layers, then one matrix at a time.

Run only under run-exclusive.py. Uses the exact saved baseline generated token IDs
and identical prefill chunking, with fresh recurrent/KV state per prompt. Captures
four token positions before the closing delimiter of the first/second/third repeated
event and the normal final event. No inference answers are supplied or trained.
"""
import json
import re
import time

from context import HERE, SCRATCH, prompt_rows, read_jsonl, sha256, write_new_json
from runtime import close_model, hard_deadline, load_model, now, reset_shared


def event_spans(text):
    start = re.match(r'\s*\{\s*"events"\s*:\s*\[\s*', text)
    if not start:
        return []
    decoder, position, spans = json.JSONDecoder(), start.end(), []
    while position < len(text):
        while position < len(text) and text[position] in " \n\t\r,":
            position += 1
        if position == len(text) or text[position] != "{":
            break
        try:
            _, end = decoder.raw_decode(text, position)
        except ValueError:
            break
        spans.append((position, end))
        position = end
    return spans


def main():
    import mlx.core as mx
    import mlx.nn as nn
    import numpy as np
    from mlx_lm.models.cache import make_prompt_cache

    hard_deadline()
    started = time.perf_counter()
    rows = [r for r in prompt_rows() if r["role"].startswith("derive_")]
    assert len(rows) == 2
    baselines = {r["id"]: r for r in read_jsonl(HERE / "results" / "baseline-r1.jsonl")}
    lm = load_model()
    holders = []

    class CaptureDown(nn.Module):
        def __init__(self, base):
            super().__init__()
            self.base = base
            self.capture = False
            self.frames = []

        def __call__(self, x):
            y = self.base(x)
            if self.capture:
                self.frames.append((x[0, -1].astype(mx.float32), y[0, -1].astype(mx.float32)))
            return y

    for layer in lm.model.layers:
        holder = CaptureDown(layer.mlp.down_proj)
        layer.mlp.down_proj = holder
        holders.append(holder)
    captures, metadata = {}, []
    try:
        for row in rows:
            reset_shared()
            baseline = baselines[row["id"]]
            ids = baseline["token_ids"]
            spans = event_spans(baseline["raw_text"])
            chosen = spans[:3] if row["role"] == "derive_loop" else spans[-1:]
            boundaries = []
            for _, end in chosen:
                # Last token BEFORE the token that closes the event. BPE often
                # merges `},{` or `}]}`; avoid aligning unlike delimiter tokens.
                closing = next(j for j in range(len(ids)) if len(lm.tokenizer.decode(ids[:j + 1])) >= end)
                boundaries.append(closing - 1)
            wanted = sorted({j for end in boundaries for j in range(max(0, end - 3), end + 1)})
            rendered = lm.tokenizer.apply_chat_template(
                [{"role": "system", "content": row["system"]}, {"role": "user", "content": row["prompt"]}],
                tokenize=False, add_generation_prompt=True, enable_thinking=False)
            encoded = lm.tokenizer.encode(rendered, add_special_tokens=lm.tokenizer.bos_token is None or not rendered.startswith(lm.tokenizer.bos_token))
            cache = make_prompt_cache(lm.model)
            # Match generate_step's default 2048-token prefill, then its last-token step.
            for start in range(0, len(encoded) - 1, 2048):
                lm.model(mx.array(encoded[start:min(start + 2048, len(encoded) - 1)])[None], cache=cache)
                mx.eval([c.state for c in cache])
            logits = lm.model(mx.array(encoded[-1:])[None], cache=cache)[0, -1]
            mx.eval(logits)
            mismatches, next_tokens = [], []
            for j in range(max(wanted) + 1):
                prediction = int(mx.argmax(logits))
                if prediction != ids[j]:
                    mismatches.append({"position": j, "expected": ids[j], "got": prediction})
                for holder in holders:
                    holder.capture = j in wanted
                logits = lm.model(mx.array([ids[j]])[None], cache=cache)[0, -1]
                mx.eval(logits, *[a for h in holders for pair in h.frames for a in pair])
                if j in boundaries:
                    top = np.asarray(mx.argsort(logits)[-8:])[::-1].tolist()
                    next_tokens.append({"position": j, "token": ids[j], "text": lm.tokenizer.decode([ids[j]]),
                                        "actual_next": ids[j + 1], "next_text": lm.tokenizer.decode([ids[j + 1]]),
                                        "top": [{"id": t, "text": lm.tokenizer.decode([t]), "logit": float(logits[t])} for t in top]})
            x = np.stack([np.stack([np.asarray(a) for a, _ in h.frames]) for h in holders])
            y = np.stack([np.stack([np.asarray(b) for _, b in h.frames]) for h in holders])
            captures[row["role"]] = (x, y)
            metadata.append({"id": row["id"], "role": row["role"], "prompt_sha256": row["prompt_sha256"],
                             "positions": wanted, "boundaries": boundaries, "greedy_mismatches": mismatches,
                             "next_tokens": next_tokens})
            for h in holders:
                h.capture = False
                h.frames.clear()
            del cache, logits
            mx.clear_cache()

        for layer, holder in zip(lm.model.layers, holders):
            layer.mlp.down_proj = holder.base
        # Compare actual continuation vs completion delimiter unembedding rows.
        loop_id = metadata[0]["next_tokens"][0]["actual_next"]
        normal_id = metadata[1]["next_tokens"][-1]["actual_next"]
        language = lm.model.language_model
        head = language.model.embed_tokens if language.args.tie_word_embeddings else language.lm_head
        weights = mx.dequantize(head.weight[[loop_id, normal_id]], head.scales[[loop_id, normal_id]],
                               head.biases[[loop_id, normal_id]], group_size=head.group_size, bits=head.bits)
        logit_axis = np.asarray((weights[0] - weights[1]).astype(mx.float32)
                               * lm.model.language_model.model.norm.weight.astype(mx.float32))
        del weights

        lx, ly = captures["derive_loop"]
        nx, ny = captures["derive_normal"]
        contrast = ly[:, -4:].mean(1) - ny.mean(1)
        repeat_delta = ly[:, -4:].mean(1) - ly[:, :4].mean(1)
        ranking = []
        for i in range(len(holders)):
            ranking.append({"layer": i, "contrast_norm": float(np.linalg.norm(contrast[i])),
                            "repeat_delta_norm": float(np.linalg.norm(repeat_delta[i])),
                            "contrast_continuation_dla": float(contrast[i] @ logit_axis),
                            "repeat_continuation_dla": float(repeat_delta[i] @ logit_axis),
                            "normal_output_norm": float(np.linalg.norm(ny[i].mean(0))),
                            "loop_output_norm": float(np.linalg.norm(ly[i, -4:].mean(0)))})
        # Fixed selection: strongest positive direct logit attribution, not largest raw norm.
        choices = [("contrast", max(ranking, key=lambda r: r["contrast_continuation_dla"])["layer"], contrast),
                   ("repeat64", max(ranking, key=lambda r: r["repeat_continuation_dla"])["layer"], repeat_delta)]
        directions = HERE / "directions"
        directions.mkdir(exist_ok=True)
        specs = []
        rng = np.random.default_rng(20261103)
        for family, layer_index, source in choices:
            base = lm.model.layers[layer_index].mlp.down_proj
            u = source[layer_index].astype(np.float32)
            u /= np.linalg.norm(u)
            # Only this single matrix is dequantised. It is dropped before the next.
            matrix = mx.dequantize(base.weight, base.scales, base.biases, group_size=base.group_size,
                                   bits=base.bits).astype(mx.float32)
            v = np.asarray(mx.array(u) @ matrix).copy()
            w_norm = float(mx.linalg.norm(matrix))
            random_u = rng.standard_normal(u.shape).astype(np.float32)
            random_u /= np.linalg.norm(random_u)
            random_v = np.asarray(mx.array(random_u) @ matrix).copy()
            columns = np.arange(len(v))
            if family == "repeat64":
                contrast_x = lx[layer_index, -4:].mean(0) - lx[layer_index, :4].mean(0)
                columns = np.argsort(np.abs(v * contrast_x))[-64:]
                mask = np.zeros_like(v)
                mask[columns] = 1
                v *= mask
                random_v *= mask
            # Exact same Frobenius norm (u is unit), same support for random direction.
            random_v *= np.linalg.norm(v) / np.linalg.norm(random_v)
            name = f"{family}_layer{layer_index}"
            path = directions / (name + ".npz")
            if path.exists():
                raise FileExistsError(path)
            np.savez(path, u=u, v=v, random_u=random_u, random_v=random_v, columns=columns)
            spec = {"family": family, "layer": layer_index, "direction_file": str(path.relative_to(HERE)),
                    "direction_sha256": sha256(path.read_bytes()), "seed": 20261103,
                    "formula": "W' = W - strength * u v^T", "base_projection_norm": w_norm,
                    "unit_strength_edit_norm": float(np.linalg.norm(v)),
                    "relative_unit_edit_norm": float(np.linalg.norm(v) / w_norm),
                    "columns": len(columns), "u_sha256": sha256(u.tobytes()), "v_sha256": sha256(v.tobytes())}
            specs.append(spec)
            for strength in (0, 0.5, 1, 2):
                write_new_json(directions / f"{name}_s{strength}.json", {**spec, "strength": strength})
            for strength in (1, 2):
                write_new_json(directions / f"{name}_random_s{strength}.json",
                               {**spec, "strength": strength, "u_key": "random_u", "v_key": "random_v", "control": "random_equal_frobenius"})
            write_new_json(directions / f"{name}_opposite.json", {**spec, "strength": -1, "control": "opposite_sign"})
            del matrix
            mx.clear_cache()
        SCRATCH.mkdir(parents=True, exist_ok=True)
        np.savez(SCRATCH / "derivation_activations.npz", loop_x=lx, loop_y=ly, normal_x=nx, normal_y=ny)
        write_new_json(HERE / "results" / "activation_probe.json", {
            "recorded": now(), "load": lm.load_info, "seconds": time.perf_counter() - started,
            "peak_mlx_gb": mx.get_peak_memory() / 1e9, "prompts": metadata, "layer_ranking": ranking,
            "selection": specs, "continuation_id": loop_id, "completion_id": normal_id,
            "caveat": "Direct-logit attribution is a hypothesis, not a causal result. Derived only on one loop/normal pair."})
        print(json.dumps({"selected": specs, "greedy_mismatch_counts": [len(m["greedy_mismatches"]) for m in metadata]}, indent=2))
    finally:
        for layer, holder in zip(lm.model.layers, holders):
            layer.mlp.down_proj = holder.base
        holders.clear()
        close_model(lm)


if __name__ == "__main__":
    main()
