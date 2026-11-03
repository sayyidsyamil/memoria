"""Experimental nonlinear activation steering, NOT a static weight edit.

y' = base(x) - strength * ReLU(v.T x - threshold) * u.
The caller enables this only after the first generated-token prediction, resets it
for every new request, and uses fresh model caches. No shipping worker is modified.
"""
from context import HERE, sha256


def output_phase_sampler(sampler, controller):
    """The first model forward/prediction is unsteered; subsequent token forwards may steer."""
    def sample(logprobs):
        token = sampler(logprobs)
        controller.enable()
        return token
    return sample


def install(model, spec):
    import mlx.core as mx
    import mlx.nn as nn
    import numpy as np

    class RectifiedDown(nn.Module):
        def __init__(self, base, u, v):
            super().__init__()
            self.base = base
            self.u, self.v = mx.array(u), mx.array(v)
            self.active = False
            self.strength = float(spec["strength"])
            self.threshold = float(spec["threshold"])

        def __call__(self, x):
            y = self.base(x)
            if not self.active:
                return y
            feature = x.astype(mx.float32) @ self.v
            amount = mx.maximum(feature - self.threshold, 0.0)
            return (y.astype(mx.float32) - self.strength * amount[..., None] * self.u).astype(y.dtype)

        def reset(self):
            self.active = False

        def enable(self):
            self.active = True

    path = HERE / spec["direction_file"]
    if sha256(path.read_bytes()) != spec["direction_sha256"]:
        raise ValueError("direction artifact hash mismatch")
    arrays = np.load(path, allow_pickle=False)
    u, v = arrays[spec.get("u_key", "u")], arrays[spec.get("v_key", "v")]
    layer = model.layers[spec["layer"]]
    base = layer.mlp.down_proj
    adapter = RectifiedDown(base, u, v)
    mx.eval(adapter.u, adapter.v)
    layer.mlp.down_proj = adapter

    def undo():
        adapter.reset()
        layer.mlp.down_proj = base

    metadata = {**spec, "kind": "nonlinear_activation_adapter", "phase": "after first generated-token prediction",
                "formula": "y' = y - strength * relu(v^T x - threshold) * u",
                "static_weight_equivalent": False, "added_vector_bytes": int(u.nbytes + v.nbytes),
                "active_u_sha256": sha256(u.tobytes()), "active_v_sha256": sha256(v.tobytes())}
    return metadata, undo, adapter
