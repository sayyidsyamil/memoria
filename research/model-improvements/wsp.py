"""The Weight-Space Programming edit of Qwen3.5-0.8B (Experiment 8, run p50c), rebuilt and checked, then applied in memory.

    python3.11 wsp.py rebuild    # the two edited down_proj tensors from the stock weights and the published diff, hash-checked
    python3.11 wsp.py release    # the released checkpoint against the stock one, tensor by tensor (streamed, not stored)
    python3.11 wsp.py quant      # does the edit survive 4-bit affine quantisation (group 64)? no model is run

Sources, pinned: Qwen/Qwen3.5-0.8B @ 2fc06364715b967f1860aea9cf38778875588b17 (Apache-2.0);
RikiyaT/lm_understand-logs @ 4d09ba6d6a7e891dd8063974dfe81b3d78e3494f, exp8_math/runs/p50c/edit/{edit.npz,manifest.json}
and exp8_math/code/{apply_edit.py,st_numpy.py} (MIT / CC BY 4.0); RikiyaT/Qwen3.5-0.8B-weight-space-programming @
d1671a178705bcab7644806d23c535517f35723b (Apache-2.0), the released edited checkpoint.
"""
import hashlib
import json
import struct
import sys
import urllib.request
from pathlib import Path

import numpy as np

SCRATCH = Path("/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/model-improvements")
WSP = SCRATCH / "wsp"
STOCK = SCRATCH / "hf/models--Qwen--Qwen3.5-0.8B/snapshots/2fc06364715b967f1860aea9cf38778875588b17"
RELEASE = "https://huggingface.co/RikiyaT/Qwen3.5-0.8B-weight-space-programming/resolve/d1671a178705bcab7644806d23c535517f35723b/"
FILE = "model.safetensors-00001-of-00001.safetensors"
MLX_NAME = {"model.language_model.layers.15.mlp.down_proj.weight": "language_model.model.layers.15.mlp.down_proj.weight",
            "model.language_model.layers.19.mlp.down_proj.weight": "language_model.model.layers.19.mlp.down_proj.weight"}


def manifest():
    return json.loads((WSP / "manifest.json").read_text())


def header(read):
    size = struct.unpack("<Q", read(0, 8))[0]
    return json.loads(read(8, size)), 8 + size


def local_reader(path):
    def read(offset, length):
        with open(path, "rb") as handle:
            handle.seek(offset)
            return handle.read(length)
    return read


def bf16_bits(path, name):
    head, base = header(local_reader(path))
    info = head[name]
    start, end = info["data_offsets"]
    raw = local_reader(path)(base + start, end - start)
    assert info["dtype"] == "BF16"
    return np.frombuffer(raw, dtype=np.uint16).reshape(info["shape"])


def rebuild():
    sys.path.insert(0, str(WSP))
    import apply_edit
    z = np.load(WSP / "edit.npz")
    out = {}
    for i, t in enumerate(manifest()["tensors"]):
        base = bf16_bits(STOCK / FILE, t["name"])
        assert hashlib.sha256(base.tobytes()).hexdigest() == t["base_sha256"], t["name"]
        edited = apply_edit.rebuild(base.copy(), t, z, i)
        assert hashlib.sha256(np.ascontiguousarray(edited).tobytes()).hexdigest() == t["edited_sha256"], t["name"]
        np.save(WSP / f"{t['name']}.bf16bits.npy", edited)
        changed_columns = np.unique(np.nonzero(edited != base)[1])
        out[t["name"]] = {"changed_entries": int((edited != base).sum()), "changed_columns": int(len(changed_columns)),
                          "edited_sha256": t["edited_sha256"], "hash": "OK"}
        print(t["name"], out[t["name"]])
    return out


def to_f32(bits):
    return (bits.astype(np.uint32) << 16).view(np.float32)


def apply(model):
    """Replace the two tensors in a loaded MLX model (bf16, before any quantisation); checks the stock tensors first."""
    import mlx.core as mx
    from mlx.utils import tree_flatten, tree_unflatten
    params = dict(tree_flatten(model.parameters()))
    updates, info = [], {}
    for t in manifest()["tensors"]:
        name = MLX_NAME[t["name"]]
        current = np.array(params[name].astype(mx.float32))
        bits = (current.view(np.uint32) >> 16).astype(np.uint16)
        assert hashlib.sha256(bits.tobytes()).hexdigest() == t["base_sha256"], f"{name} is not the stock tensor"
        edited = np.load(WSP / f"{t['name']}.bf16bits.npy")
        updates.append((name, mx.array(to_f32(edited)).astype(mx.bfloat16)))
        info[name] = t["edited_sha256"][:16]
    model.update(tree_unflatten(updates))
    mx.eval(model.parameters())
    params = dict(tree_flatten(model.parameters()))
    for t in manifest()["tensors"]:
        bits = (np.array(params[MLX_NAME[t["name"]]].astype(mx.float32)).view(np.uint32) >> 16).astype(np.uint16)
        assert hashlib.sha256(bits.tobytes()).hexdigest() == t["edited_sha256"]
    return info


def release():
    """Stream the released file; hash every tensor and compare with the stock file. Nothing is written to disk."""
    def remote(offset, length):
        request = urllib.request.Request(RELEASE + FILE, headers={"Range": f"bytes={offset}-{offset + length - 1}"})
        with urllib.request.urlopen(request) as reply:
            return reply.read()
    their, their_base = header(remote)
    ours, our_base = header(local_reader(STOCK / FILE))
    names = sorted(k for k in ours if k != "__metadata__")
    same_layout = sorted(k for k in their if k != "__metadata__") == names and all(
        (their[n]["dtype"], their[n]["shape"]) == (ours[n]["dtype"], ours[n]["shape"]) for n in names)
    order = sorted(names, key=lambda n: their[n]["data_offsets"][0])
    request = urllib.request.Request(RELEASE + FILE, headers={"Range": f"bytes={their_base}-"})
    differ, position = [], 0
    with urllib.request.urlopen(request) as stream, open(STOCK / FILE, "rb") as local:
        for n in order:
            start, end = their[n]["data_offsets"]
            assert start == position, (n, start, position)
            remote_bytes = stream.read(end - start)
            position = end
            a, b = ours[n]["data_offsets"]
            local.seek(our_base + a)
            if hashlib.sha256(remote_bytes).digest() != hashlib.sha256(local.read(b - a)).digest():
                differ.append((n, hashlib.sha256(remote_bytes).hexdigest()))
    small = {}
    for name in ("config.json", "tokenizer.json", "tokenizer_config.json", "chat_template.jinja", "vocab.json", "merges.txt"):
        with urllib.request.urlopen(RELEASE + name) as reply:
            small[name] = reply.read() == (STOCK / name).read_bytes()
    result = {"tensors": len(names), "same_names_dtypes_shapes": same_layout, "differing_tensors": differ,
              "metadata": {"release": their.get("__metadata__"), "stock": ours.get("__metadata__")}, "same_small_files": small}
    print(json.dumps(result, indent=1))
    return result


def quant():
    """4-bit affine, group 64 along the input dimension (MLX's quantisation): how much of the edit is left?"""
    import mlx.core as mx
    out = {}
    for t in manifest()["tensors"]:
        base = to_f32(bf16_bits(STOCK / FILE, t["name"]))
        edited = to_f32(np.load(WSP / f"{t['name']}.bf16bits.npy"))
        delta = edited - base

        def roundtrip(w):
            q, s, b = mx.quantize(mx.array(w).astype(mx.bfloat16), group_size=64, bits=4)
            return np.array(mx.dequantize(q, s, b, group_size=64, bits=4).astype(mx.float32))
        dq = roundtrip(edited) - roundtrip(base)
        cols = np.unique(np.nonzero(delta)[1])
        u, sv, _ = np.linalg.svd(delta[:, cols], full_matrices=False)
        direction = u[:, 0]
        out[t["name"]] = {
            "edit_norm": float(np.linalg.norm(delta)), "rank1_share": float(sv[0] ** 2 / (sv ** 2).sum()),
            "after_q4_norm": float(np.linalg.norm(dq)),
            "cosine(edit, q4 difference)": float((delta * dq).sum() / (np.linalg.norm(delta) * np.linalg.norm(dq))),
            "loop direction written by edited columns, bf16 -> q4": [
                float(np.abs(direction @ edited[:, cols]).mean()), float(np.abs(direction @ roundtrip(edited)[:, cols]).mean())],
            "same, stock": [float(np.abs(direction @ base[:, cols]).mean()), float(np.abs(direction @ roundtrip(base)[:, cols]).mean())],
        }
        print(t["name"], json.dumps(out[t["name"]], indent=1))
    return out


if __name__ == "__main__":
    command = sys.argv[1]
    result = {"rebuild": rebuild, "release": release, "quant": quant}[command]()
    (WSP / f"{command}.json").write_text(json.dumps(result, indent=1, default=str))
