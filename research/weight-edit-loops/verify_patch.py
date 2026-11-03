"""Check real quantised projection + residual against a materialised single-matrix edit.

Use the exclusive model lease. Tests zero identity, numerical weight-equivalence,
and untouched base arrays; never dequantises more than one projection.
"""
import json

from context import HERE, SCRATCH, sha256, write_new_json
from runtime import close_model, hard_deadline, load_model, reset_shared
from weight_patch import install


def main():
    import mlx.core as mx
    import numpy as np

    hard_deadline()
    lm = load_model()
    rows = []
    activations = np.load(SCRATCH / "derivation_activations.npz", allow_pickle=False)
    try:
        for family in ("contrast", "repeat64"):
            spec = json.loads((HERE / "directions" / f"{family}_layer30_s1.json").read_text())
            layer = lm.model.layers[spec["layer"]]
            base = layer.mlp.down_proj

            def fingerprint():
                return {name: sha256(np.asarray(value.astype(mx.float32) if value.dtype != mx.uint32 else value).tobytes())
                        for name, value in (("weight", base.weight), ("scales", base.scales), ("biases", base.biases))}

            before = fingerprint()
            matrix = mx.dequantize(base.weight, base.scales, base.biases, group_size=base.group_size, bits=base.bits).astype(mx.float32)
            x = mx.array(activations["loop_x"][spec["layer"], [0, -1]]).astype(mx.float32)
            normal = base(x)
            arrays = np.load(HERE / spec["direction_file"], allow_pickle=False)
            u, v = mx.array(arrays["u"]), mx.array(arrays["v"])
            info, undo = install(lm.model, {**spec, "strength": 0})
            try:
                identity = bool(mx.array_equal(layer.mlp.down_proj(x), normal))
            finally:
                undo()
                reset_shared()
            info, undo = install(lm.model, spec)
            try:
                runtime = layer.mlp.down_proj(x)
                dense = x @ (matrix - u[:, None] * v[None, :]).T
                mx.eval(runtime, dense)
                max_error = float(mx.max(mx.abs(runtime - dense)))
                relative_l2 = float(mx.linalg.norm(runtime - dense) / mx.maximum(mx.linalg.norm(dense), 1e-9))
                norm_control = float(np.linalg.norm(arrays["random_u"]) * np.linalg.norm(arrays["random_v"]))
            finally:
                undo()
                reset_shared()
            unchanged = fingerprint() == before
            row = {"family": family, "layer": spec["layer"], "zero_identity": identity, "base_unchanged": unchanged,
                   "runtime_vs_dense_max_abs": max_error, "runtime_vs_dense_relative_l2": relative_l2,
                   "edit_frobenius": info["edit_frobenius"], "random_control_frobenius": norm_control,
                   "base_fingerprint": before, "projection_shape": list(matrix.shape), "dtype_for_equivalence_test": "float32 inputs"}
            rows.append(row)
            print(json.dumps(row), flush=True)
            assert identity and unchanged and relative_l2 < 2e-3
            del matrix, x, normal, runtime, dense
            mx.clear_cache()
        write_new_json(HERE / "results" / "patch_verification.json", {"checks": rows, "peak_mlx_gb": mx.get_peak_memory() / 1e9})
    finally:
        close_model(lm)


if __name__ == "__main__":
    main()
