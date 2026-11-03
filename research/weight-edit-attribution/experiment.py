"""Bounded, gradient-free 4B diagnostics and static low-rank projection adapters.

Every invocation MUST be wrapped in the shared run-exclusive.py launcher.
Only small layer matrices are temporarily dequantized for inspection. Inference
uses the original 4-bit projections plus a sparse rank-one additive weight delta.
"""
import gc
import json
import os
import resource
import signal
import subprocess
import sys
import time

from common import HERE, SCRATCH, MODEL, REVISION, sha, write_json
from cases import probe

LAYERS = (8, 16, 24, 28)  # 4B 32-layer architecture: quarter-depth through late residual stream.


def preflight():
    rows = subprocess.check_output(["ps", "-axo", "pid,ppid,rss,command"], text=True).splitlines()
    conflicts = []
    for row in rows[1:]:
        parts = row.split(None, 3)
        if len(parts) != 4:
            continue
        pid, ppid, rss, command = parts
        if int(pid) in (os.getpid(), os.getppid()):
            continue
        resident = ("Memoria.app/Contents/MacOS/" in command or "model_server.py" in command
                    or "llama-server" in command or "ollama runner" in command
                    or ("python" in command.lower() and int(rss) > 1_000_000))
        if resident:
            conflicts.append(row)
    if conflicts:
        raise SystemExit("resident model/app conflict; nothing killed:\n" + "\n".join(conflicts))
    return {"time": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "conflicts": conflicts}


def timeout(signum, frame):
    raise TimeoutError("450-second model lease exhausted")


class Runtime:
    def __init__(self):
        import mlx.core as mx
        import mlx.nn as nn
        from mlx_lm import load
        self.mx, self.nn = mx, nn
        mx.set_cache_limit(256 * 1024 * 1024)
        self.started = time.perf_counter()
        self.model, self.tok = load(str(MODEL))
        mx.eval(self.model.parameters())
        self.load_seconds = time.perf_counter() - self.started
        self.original = {}
        self.sink = {}
        self.intervention = {"kind": "base", "revision": REVISION}
        self.reset()

    def reset(self):
        # No prompt state survives any call or model change; also clear the
        # shipped worker's two global prefix stores in case a helper imported it.
        import model_server
        model_server._prefix.update(ids=None, state=None, seen=None)
        model_server._meeting.update(ids=None, state=None)
        self.sink.clear()
        gc.collect()
        self.mx.clear_cache()

    def taps(self):
        mx, nn, sink = self.mx, self.nn, self.sink

        class DownTap(nn.Module):
            def __init__(self, base, index):
                super().__init__()
                self.base, self.index = base, index

            def __call__(self, x):
                sink[f"a{self.index}"] = x[0, -1].astype(mx.float32)
                return self.base(x)

        class BlockTap(nn.Module):
            def __init__(self, base, index):
                super().__init__()
                self.base, self.index, self.is_linear = base, index, base.is_linear

            def __call__(self, x, mask=None, cache=None):
                y = self.base(x, mask=mask, cache=cache)
                sink[f"h{self.index}"] = y[0, -1].astype(mx.float32)
                return y

        for i in LAYERS:
            layer = self.model.layers[i]
            self.original[i] = layer
            layer.mlp.down_proj = DownTap(layer.mlp.down_proj, i)
            self.model.layers[i] = BlockTap(layer, i)

    def untap(self):
        for i, layer in self.original.items():
            layer.mlp.down_proj = layer.mlp.down_proj.base
            self.model.layers[i] = layer
        self.original.clear()
        self.reset()

    def score(self, messages):
        import numpy as np
        from mlx_lm.models.cache import make_prompt_cache
        mx = self.mx
        self.reset()
        mx.reset_peak_memory()
        rendered = self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        ids = self.tok.encode(rendered, add_special_tokens=self.tok.bos_token is None or not rendered.startswith(self.tok.bos_token))
        cache = make_prompt_cache(self.model)
        started = time.perf_counter()
        for start in range(0, len(ids)-1, 128):
            self.model(mx.array(ids[start:min(start+128, len(ids)-1)])[None], cache=cache)
            mx.eval([part for layer in cache for part in layer.state if part is not None])
        logits = self.model(mx.array(ids[-1:])[None], cache=cache)[0, -1].astype(mx.float32)
        logp = logits - mx.logsumexp(logits)
        tokens = {w: self.tok.encode(w, add_special_tokens=False)[0] for w in ("YES", "NO")}
        mx.eval(logp, *self.sink.values())
        lp = {w: float(logp[t]) for w, t in tokens.items()}
        activations = {k: np.array(v) for k, v in self.sink.items()}
        row = {"intervention": self.intervention, "key": sha(json.dumps([REVISION, self.intervention, rendered])),
               "prompt_sha256": sha(rendered), "prompt_tokens": len(ids), "logprobs": lp,
               "margin": lp["YES"]-lp["NO"], "seconds": time.perf_counter()-started,
               "peak_gb": mx.get_peak_memory()/1e9, "cache": "fresh per call, 128-token prefill"}
        del cache, logits, logp
        self.reset()
        return row, activations

    def close(self):
        self.original.clear()
        self.model = self.tok = None
        self.reset()


def auc(labels, scores):
    pos = [s for y, s in zip(labels, scores) if y]
    neg = [s for y, s in zip(labels, scores) if not y]
    return sum((p > n) + .5*(p == n) for p in pos for n in neg)/(len(pos)*len(neg))


def summarize(rows, cases):
    out = {}
    lookup = {c["id"]: c for c in cases}
    for split in ("derive", "check"):
        part = [(lookup[r["id"]], r) for r in rows if lookup[r["id"]]["split"] == split]
        if not part:
            continue
        out[split] = {"correct": sum((r["margin"] >= 0) == c["expected_support"] for c, r in part),
                      "n": len(part), "false_accept": sum(r["margin"] >= 0 and not c["expected_support"] for c, r in part),
                      "false_reject": sum(r["margin"] < 0 and c["expected_support"] for c, r in part),
                      "auc": auc([c["expected_support"] for c, r in part], [r["margin"] for c, r in part]),
                      "mean_seconds": sum(r["seconds"] for c, r in part)/len(part)}
    return out


def diagnose(rt, cases):
    import numpy as np
    rt.taps()
    rows, acts = [], {}
    for context in (False, True):
        for case in cases:
            row, act = rt.score(probe(case, context=context))
            row.update(id=case["id"], context=context)
            rows.append(row)
            if context:
                acts[case["id"]] = act
            print(json.dumps({"task": "probe", "id": case["id"], "context": context, "margin": row["margin"]}), flush=True)
    rt.untap()
    SCRATCH.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(SCRATCH / "activations.npz", **{f"{cid}_{k}": v for cid, a in acts.items() for k, v in a.items()})
    old = [c for c in cases if c["split"] == "derive"]
    labels = np.array([not c["expected_support"] for c in old])
    diagnostics, dirs = [], {}
    for layer in LAYERS:
        h = np.array([acts[c["id"]][f"h{layer}"] for c in old])
        d = h[labels].mean(axis=0)-h[~labels].mean(axis=0)
        d /= np.linalg.norm(d)
        dirs[layer] = d
        series_dirs, held = [], []
        for series in ("ES2003", "TS3004"):
            which = np.array([c["series"] == series for c in old])
            sd = h[labels & which].mean(axis=0)-h[~labels & which].mean(axis=0)
            sd /= np.linalg.norm(sd)
            series_dirs.append(sd)
            held.append(auc(labels[~which], (h[~which] @ sd).tolist()))
        check = [c for c in cases if c["split"] == "check"]
        diagnostics.append({"layer": layer, "derive_series_direction_cosine": float(series_dirs[0] @ series_dirs[1]),
                            "derive_leave_series_out_auc": held,
                            "check_direction_auc": auc([not c["expected_support"] for c in check],
                                                       [float(acts[c["id"]][f"h{layer}"] @ d) for c in check])})
    # Selection is ONLY by old-dev leave-series-out behavior, never check scores.
    selected = max(diagnostics, key=lambda x: (sum(x["derive_leave_series_out_auc"]), x["derive_series_direction_cosine"]))
    layer, u = selected["layer"], dirs[selected["layer"]]
    q = rt.model.layers[layer].mlp.down_proj
    mx = rt.mx
    w = mx.dequantize(q.weight, q.scales, q.biases, group_size=q.group_size, bits=q.bits).astype(mx.float32)
    proj = u @ np.array(w)
    wnorm = float(mx.linalg.norm(w))
    a = np.array([acts[c["id"]][f"a{layer}"] for c in old])
    contrast = a[labels].mean(axis=0)-a[~labels].mean(axis=0)
    contribution = contrast * proj
    indices = np.argsort(contribution)[-16:][::-1].copy()
    p = proj[indices].copy()
    rnd = np.random.default_rng(20261103).normal(size=len(u)).astype(np.float32)
    rnd -= u * (rnd @ u)
    rnd /= np.linalg.norm(rnd)
    patch_path = HERE / "data/rank-one-patch.npz"
    np.savez_compressed(patch_path, u=u, random_u=rnd, indices=indices, p=p)
    spec = {"kind": "static sparse rank-one weight adapter on original 4-bit down_proj", "model_revision": REVISION,
            "layer": layer, "path": f"language_model.model.layers.{layer}.mlp.down_proj",
            "formula": "W'[:, J] = W[:, J] - alpha * outer(u, p); p = u @ W[:, J]",
            "derive_cases": [c["id"] for c in old], "selection": "max old-dev leave-series-out AUC, then direction cosine",
            "diagnostics": diagnostics, "indices": indices.tolist(), "direction_norm": float(np.linalg.norm(u)),
            "unscaled_delta_frobenius": float(np.linalg.norm(p)), "layer_weight_frobenius": wnorm,
            "relative_delta_at_half": .5*float(np.linalg.norm(p))/wnorm,
            "top_contribution": contribution[indices].tolist(), "strengths": [.25, .5], "random_seed": 20261103,
            "random_control": "same indices and p, orthogonal unit random_u, exactly matched Frobenius norm",
            "patch_sha256": sha(patch_path.read_bytes()), "probes_sha256": sha((HERE / "data/cases.json").read_bytes())}
    write_json(HERE / "data/patch-spec.json", spec)
    del w
    rt.reset()
    result = {"rows": rows, "summary": {"quote": summarize([r for r in rows if not r["context"]], cases),
                                         "context": summarize([r for r in rows if r["context"]], cases)},
              "patch": spec, "load_seconds": rt.load_seconds, "process_peak_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e9}
    write_json(HERE / "results/diagnose.json", result)
    print(json.dumps({"summary": result["summary"], "diagnostics": diagnostics, "selected_layer": layer}), flush=True)


def install(rt, strength, random=False):
    import numpy as np
    spec = json.loads((HERE / "data/patch-spec.json").read_text())
    path = HERE / "data/rank-one-patch.npz"
    assert sha(path.read_bytes()) == spec["patch_sha256"]
    arr = np.load(path)
    layer = rt.model.layers[spec["layer"]]
    original = layer.mlp.down_proj
    mx, nn = rt.mx, rt.nn

    class RankOne(nn.Module):
        def __init__(self):
            super().__init__()
            self.base = original
            self.u = mx.array(arr["random_u" if random else "u"])
            self.p = mx.array(arr["p"])
            self.indices = mx.array(arr["indices"].astype(np.int32))

        def __call__(self, x):
            y = self.base(x)
            component = mx.sum(mx.take(x, self.indices, axis=-1).astype(mx.float32)*self.p, axis=-1)
            return (y.astype(mx.float32)-strength*component[..., None]*self.u).astype(y.dtype)

    layer.mlp.down_proj = RankOne()
    rt.intervention = {"kind": "rank-one", "patch_sha256": spec["patch_sha256"], "strength": strength,
                       "random": random, "layer": spec["layer"], "code_sha256": sha(__import__("pathlib").Path(__file__).read_bytes())}
    rt.reset()

    def restore():
        layer.mlp.down_proj = original
        rt.intervention = {"kind": "base", "revision": REVISION}
        rt.reset()
    return restore


def edit_probes(rt, cases):
    rows, summaries = [], {}
    for strength, random in ((.25, False), (.5, False), (.5, True)):
        restore = install(rt, strength, random)
        name = f"{'random' if random else 'target'}-{strength}"
        this = []
        try:
            for case in cases:
                row, _ = rt.score(probe(case, context=True))
                row.update(id=case["id"], condition=name)
                rows.append(row)
                this.append(row)
        finally:
            restore()
        summaries[name] = summarize(this, cases)
        print(json.dumps({"condition": name, "summary": summaries[name]}), flush=True)
    # Regression: removing the adapter must restore scores exactly, across both
    # supported and unsupported material cases (fresh recurrent / prefix state).
    baseline = json.loads((HERE / "results/diagnose.json").read_text())
    base = {r["id"]: r for r in baseline["rows"] if r["context"]}
    regression = []
    for case in (cases[4], cases[8], cases[-1]):
        row, _ = rt.score(probe(case, context=True))
        regression.append({"id": case["id"], "identical": row["logprobs"] == base[case["id"]]["logprobs"],
                           "before": base[case["id"]]["logprobs"], "after": row["logprobs"]})
    write_json(HERE / "results/edit-probes.json", {"rows": rows, "summary": summaries, "restoration_regression": regression,
                                                   "process_peak_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e9})


def main():
    check = preflight()
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(450)
    cases = json.loads((HERE / "data/cases.json").read_text())
    rt = Runtime()
    try:
        if sys.argv[1] == "diagnose":
            diagnose(rt, cases)
        elif sys.argv[1] == "edit-probes":
            edit_probes(rt, cases)
        else:
            raise SystemExit("expected diagnose or edit-probes")
    finally:
        rt.close()
        signal.alarm(0)
        print(json.dumps({"preflight": check, "closed": True, "elapsed_seconds": time.perf_counter()-rt.started}), flush=True)


if __name__ == "__main__":
    main()
