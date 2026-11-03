"""Full-token-sequence scoring at native extraction object selection; no auxiliary verdict task."""
import json
import resource
import signal
import time

from r2_common import HERE, SCRATCH, REVISION, sha, write_json, verify_round1
from experiment import Runtime, preflight, timeout

LAYERS = (7, 17, 25)


def tap(rt):
    mx, nn, sink = rt.mx, rt.nn, rt.sink
    original = {}

    class InputTap(nn.Module):
        def __init__(self, base, i):
            super().__init__()
            self.base, self.i = base, i

        def __call__(self, x):
            sink[f"a{self.i}"] = x[0, -1].astype(mx.float32)
            return self.base(x)

    class LayerTap(nn.Module):
        def __init__(self, base, i):
            super().__init__()
            self.base, self.i, self.is_linear = base, i, base.is_linear

        def __call__(self, x, mask=None, cache=None):
            y = self.base(x, mask=mask, cache=cache)
            sink[f"h{self.i}"] = y[0, -1].astype(mx.float32)
            return y

    for i in LAYERS:
        layer = rt.model.layers[i]
        original[i] = layer
        layer.mlp.down_proj = InputTap(layer.mlp.down_proj, i)
        rt.model.layers[i] = LayerTap(layer, i)

    def restore():
        for i, layer in original.items():
            layer.mlp.down_proj = layer.mlp.down_proj.base
            rt.model.layers[i] = layer
        original.clear()
        rt.reset()
    return restore


def encode(rt, text):
    return rt.tok.encode(text, add_special_tokens=rt.tok.bos_token is None or not text.startswith(rt.tok.bos_token))


def score_case(rt, case):
    import numpy as np
    from mlx_lm.models.cache import make_prompt_cache
    mx = rt.mx
    messages = ([{"role": "system", "content": case["system"]}] if case["system"] else []) + [{"role": "user", "content": case["prompt"]}]
    rendered = rt.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    native_prefix = '{"events":[{"turn":' + str(case["turn"]) + ',"quote":' + json.dumps(case["quote"], ensure_ascii=False) + ',"object_id":'
    prefix = rendered + native_prefix
    options = (case["target_id"], case["other_id"], None)
    targets = [json.dumps(x) + "," for x in options]
    base_ids = encode(rt, prefix)
    all_ids = [encode(rt, prefix + s) for s in targets]
    common = 0
    for tokens in zip(base_ids, *all_ids):
        if len(set(tokens)) != 1:
            break
        common += 1
    assert common >= len(base_ids)-4, (common, len(base_ids))
    head = all_ids[0][:common]
    out, states = [], None
    for option, target, ids in zip(options, targets, all_ids):
        rt.reset()
        mx.reset_peak_memory()
        cache = make_prompt_cache(rt.model)
        started = time.perf_counter()
        for start in range(0, len(head)-1, 128):
            rt.model(mx.array(head[start:min(start+128, len(head)-1)])[None], cache=cache)
            mx.eval([c.state for c in cache])
        logits = rt.model(mx.array(head[-1:])[None], cache=cache)[0, -1].astype(mx.float32)
        mx.eval(logits, *rt.sink.values())
        if states is None:
            states = {k: np.array(v) for k, v in rt.sink.items()}
        lps = []
        tail = ids[common:]
        for index, token in enumerate(tail):
            logp = logits - mx.logsumexp(logits)
            lp = float(logp[token])
            lps.append(lp)
            if index+1 < len(tail):
                logits = rt.model(mx.array([token])[None], cache=cache)[0, -1].astype(mx.float32)
                mx.eval(logits)
        out.append({"object_id": option, "target_text": target, "token_ids": tail,
                    "token_text": [rt.tok.decode([t]) for t in tail], "token_logprobs": lps,
                    "sum_logp": sum(lps), "mean_logp": sum(lps)/len(lps),
                    "seconds": time.perf_counter()-started, "peak_mlx_gb": mx.get_peak_memory()/1e9})
        del cache, logits, logp
        rt.reset()
    predicted = max(out, key=lambda x: x["sum_logp"])["object_id"]
    expected = next(x for x in out if x["object_id"] == case["correct_object_id"])
    wrong = max(x["sum_logp"] for x in out if x["object_id"] != case["correct_object_id"])
    config = {"revision": REVISION, "prompt_sha256": sha(prefix), "targets": targets, "intervention": "none",
              "prefix_tokens": common, "native_prefix": native_prefix, "joint_tokenization": True,
              "code_sha256": sha(__import__("pathlib").Path(__file__).read_bytes())}
    row = {"id": case["id"], "split": case["split"], "dual_tracked": case["dual_tracked"],
           "expected": case["correct_object_id"], "predicted": predicted,
           "correct": predicted == case["correct_object_id"], "margin": expected["sum_logp"]-wrong,
           "config": config, "key": sha(json.dumps(config, sort_keys=True)), "alternatives": out}
    return row, states


def unit(x):
    import numpy as np
    return x / max(float(np.linalg.norm(x)), 1e-12)


def localize(cases, rows, states):
    import numpy as np
    old = [c for c in cases if c["split"] == "derive" and c["dual_tracked"]]
    paired = [(next(c for c in old if c["anchor_group"] == group and c["subject"] == "case"),
               next(c for c in old if c["anchor_group"] == group and c["subject"] == "buttons"))
              for group in sorted({c["anchor_group"] for c in old})]
    diagnostics = []
    for layer in LAYERS:
        dh = np.array([states[a["id"]][f"h{layer}"]-states[b["id"]][f"h{layer}"] for a, b in paired])
        da = np.array([states[a["id"]][f"a{layer}"]-states[b["id"]][f"a{layer}"] for a, b in paired])
        cosines, input_correct = [], 0
        for i in range(len(paired)):
            train = [j for j in range(len(paired)) if j != i]
            u = unit(dh[train].mean(axis=0))
            cosines.append(float(unit(dh[i]) @ u))
            mu = np.mean([states[c["id"]][f"a{layer}"] for j in train for c in paired[j]], axis=0)
            v = da[train].mean(axis=0)
            v = unit(v - mu * float(v @ mu)/max(float(mu @ mu), 1e-12))
            a, b = paired[i]
            input_correct += float(states[a["id"]][f"a{layer}"] @ v) > 0
            input_correct += float(states[b["id"]][f"a{layer}"] @ v) < 0
        diagnostics.append({"layer": layer, "held_pair_cosines": cosines,
                            "positive_held_pairs": sum(x > 0 for x in cosines), "median_cosine": float(np.median(cosines)),
                            "centered_input_held_examples_correct": input_correct, "held_examples": 8})
    old_ids = {c["id"] for c in old}
    errors = sum(not r["correct"] for r in rows if r["id"] in old_ids)
    eligible = [d for d in diagnostics if d["positive_held_pairs"] >= 3 and d["median_cosine"] > .1
                and d["centered_input_held_examples_correct"] >= 6]
    chosen = max(eligible, key=lambda d: (d["median_cosine"], d["centered_input_held_examples_correct"])) if eligible and errors >= 2 else None
    return {"derive_only": True, "old_dual_native_errors": errors, "old_dual_n": len(old), "layers": diagnostics,
            "eligible_layer": chosen["layer"] if chosen else None,
            "decision": "localization warrants a small causal test" if chosen else "no justified native binding weight edit on this evidence",
            "rule": ">=2 old dual native errors; >=3/4 positive held-pair cosines, median>.1, centered input >=6/8"}


def main():
    import numpy as np
    verify_round1()
    check = preflight()
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(450)
    cases = [c for c in json.loads((HERE / "data/cases.json").read_text()) if c["kind"] == "controlled-pair"]
    rt = Runtime()
    restore = tap(rt)
    rows, states = [], {}
    path = HERE / "results/native-calls.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        for case in cases:
            row, state = score_case(rt, case)
            rows.append(row)
            states[case["id"]] = state
            with path.open("a") as out:
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(json.dumps({k: row[k] for k in ("id", "expected", "predicted", "margin", "correct")}), flush=True)
        localization = localize(cases, rows, states)
        SCRATCH.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(SCRATCH / "native-states.npz", **{f"{cid}_{k}": v for cid, state in states.items() for k, v in state.items()})
        result = {"preflight": check, "rows": rows, "localization": localization,
                  "summary": {split: {"correct": sum(r["correct"] for r in rows if r["split"] == split),
                                      "n": sum(r["split"] == split for r in rows)} for split in ("derive", "check")},
                  "peak_process_rss_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e9}
        write_json(HERE / "results/native.json", result)
        print(json.dumps({"summary": result["summary"], "localization": localization}), flush=True)
    finally:
        restore()
        rt.close()
        signal.alarm(0)
        print(json.dumps({"closed": True, "seconds": time.perf_counter()-rt.started}), flush=True)


if __name__ == "__main__":
    main()
