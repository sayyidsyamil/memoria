"""Opt-in linear residuals on a quantised projection; the base arrays stay immutable.

For unit u and a saved vector v (derived from the bf16-rounded dequantisation of W,
optionally zero outside selected columns), the exact real-arithmetic edit is
W' = W - strength * u v.T. Inference retains W's original
4-bit matmul and adds the rank-one term in float32, casting back to the base output
dtype. This is a weight-equivalent runtime patch, NOT a requantised checkpoint.
Floating-point summation/rounding can differ from a materialised dense W'.
"""
from context import HERE, sha256


def install(model, spec):
    import mlx.core as mx
    import mlx.nn as nn
    import numpy as np

    class LowRankDown(nn.Module):
        def __init__(self, base, u, v, strength):
            super().__init__()
            self.base = base
            self.u, self.v = mx.array(u), mx.array(v)
            self.strength = float(strength)

        def __call__(self, x):
            y = self.base(x)
            if self.strength == 0:
                return y
            scalar = x.astype(mx.float32) @ self.v
            return (y.astype(mx.float32) - self.strength * scalar[..., None] * self.u).astype(y.dtype)

    path = HERE / spec["direction_file"]
    digest = sha256(path.read_bytes())
    if spec.get("direction_sha256") != digest:
        raise ValueError("direction file hash mismatch")
    arrays = np.load(path, allow_pickle=False)
    u, v = arrays[spec.get("u_key", "u")], arrays[spec.get("v_key", "v")]
    layer = model.layers[spec["layer"]]
    base = layer.mlp.down_proj
    assert base.bits == 4 and base.group_size == 64
    assert u.shape == (base.weight.shape[0],)
    assert v.shape == (base.weight.shape[1] * 8,)
    patch = LowRankDown(base, u, v, spec["strength"])
    mx.eval(patch.u, patch.v)
    layer.mlp.down_proj = patch

    def undo():
        layer.mlp.down_proj = base

    return {**spec, "runtime": "quantised-base-plus-float32-rank-one-residual", "direction_sha256": digest,
            "edit_frobenius": float(abs(spec["strength"]) * np.linalg.norm(u) * np.linalg.norm(v)),
            "added_vector_bytes": int(u.nbytes + v.nbytes)}, undo
