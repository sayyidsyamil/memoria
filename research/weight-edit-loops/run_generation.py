"""Actual greedy 4-bit MLX generations. Use run-exclusive.py; every invocation is bounded.

python run_generation.py --label baseline --condition base
python run_generation.py --label online-stop --condition stop
"""
import argparse
import importlib.metadata
import json
import resource
import time

from context import HERE, prompt_rows, sha256, write_new_json
from quality import compare_quality, event_quality
from runtime import close_model, hard_deadline, load_model, now, reset_shared
from stop_rule import EventRepeatStop, analyse


def generate(lm, row, stop=False, controller=None):
    import mlx.core as mx
    from mlx_lm import stream_generate
    from mlx_lm.models.cache import make_prompt_cache
    from mlx_lm.sample_utils import make_sampler
    reset_shared()
    if controller:
        controller.reset()
    rendered = lm.tokenizer.apply_chat_template(
        [{"role": "system", "content": row["system"]}, {"role": "user", "content": row["prompt"]}],
        tokenize=False, add_generation_prompt=True, enable_thinking=False)
    detector = (EventRepeatStop(min_repeats=3, unresolved_only=True) if stop == "conservative"
                else EventRepeatStop() if stop else None)
    cache = make_prompt_cache(lm.model)
    mx.reset_peak_memory()
    raw, tokens, first, last = "", [], None, None
    started = time.perf_counter()
    sampler = make_sampler(temp=0)
    if controller:
        from activation_gate import output_phase_sampler
        sampler = output_phase_sampler(sampler, controller)
    stream = stream_generate(lm.model, lm.tokenizer, prompt=rendered, max_tokens=row["max_tokens"],
                             sampler=sampler, prompt_cache=cache)
    try:
        for response in stream:
            if first is None:
                first = time.perf_counter() - started
            raw += response.text
            tokens.append(response.token)
            last = response
            if detector and detector.feed(response.text):
                break
    finally:
        stream.close()
        mx.synchronize()
        if controller:
            controller.reset()
    seconds = time.perf_counter() - started
    stopped = bool(detector and detector.reason)
    returned = detector.closed_text() if stopped else raw
    diagnostic = detector if stopped else analyse(raw)
    peak = mx.get_peak_memory() / 1e9
    assert last is not None
    record = {"id": row["id"], "role": row["role"], "prompt_sha256": row["prompt_sha256"],
              "rendered_prompt_sha256": sha256(rendered), "text": returned, "raw_text": raw,
              "token_ids": tokens, "seconds": round(seconds, 4), "first_token_seconds": round(first, 4),
              "prompt_tokens": last.prompt_tokens, "output_tokens": last.generation_tokens,
              "returned_tokens": len(lm.tokenizer.encode(returned, add_special_tokens=False)),
              "finish_reason": diagnostic.reason if stopped else last.finish_reason,
              "hit_budget": last.generation_tokens >= row["max_tokens"], "early_stopped": stopped,
              "repeat_detected": diagnostic.reason, "repeat_start_char": diagnostic.cut_start,
              "repeat_observed_char": diagnostic.observed_end,
              "peak_mlx_gb": round(peak, 4), "max_rss_gb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 4),
              "matches_historical_bytes": returned == row["reference"]["text"], "recorded": now()}
    del stream, cache, last, response
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--condition", choices=("base", "stop", "conservative", "edit"), default="base")
    parser.add_argument("--edit", help="JSON patch specification relative to this directory")
    parser.add_argument("--ids", help="comma-separated diagnostic IDs")
    parser.add_argument("--seconds", type=int, default=390)
    args = parser.parse_args()
    hard_deadline()
    rows = prompt_rows()
    if args.ids:
        wanted = args.ids.split(",")
        rows = [next(r for r in rows if r["id"] == name) for name in wanted]
    results = HERE / "results"
    results.mkdir(exist_ok=True)
    destination = results / (args.label + ".jsonl")
    if destination.exists():
        raise FileExistsError(destination)
    started = time.perf_counter()
    lm = load_model()
    info = {"label": args.label, "condition": args.condition, "started": now(), "load": lm.load_info,
            "versions": {p: importlib.metadata.version(p) for p in ("mlx", "mlx-lm", "transformers", "numpy")},
            "source": {f: sha256((HERE / f).read_bytes()) for f in ("run_generation.py", "stop_rule.py", "runtime.py")}}
    undo = None
    try:
        if args.condition == "edit":
            from weight_patch import install
            spec = json.loads((HERE / args.edit).read_text())
            info["patch"], undo = install(lm.model, spec)
            reset_shared()
        with destination.open("x") as out:
            for row in rows:
                # Leave room for the slowest historical request and cleanup.
                estimate = row["reference"]["seconds"] * 1.5 + 10
                if time.perf_counter() - started + estimate > args.seconds:
                    info["deferred_from"] = row["id"]
                    break
                result = generate(lm, row, stop=args.condition if args.condition in ("stop", "conservative") else False)
                result.update(condition=args.condition, label=args.label)
                result["quality"] = event_quality(row, result["text"])
                result["raw_clean"] = event_quality(row, result["raw_text"])["parsed_cleanly"]
                result["versus_historical"] = compare_quality(event_quality(row, row["reference"]["text"]), result["quality"])
                out.write(json.dumps(result, ensure_ascii=False) + "\n")
                out.flush()
                print(json.dumps({k: result[k] for k in ("id", "output_tokens", "seconds", "finish_reason", "peak_mlx_gb", "matches_historical_bytes")}
                                 | {"gold_hits": result["quality"]["gold_hits"], "lost_gold": result["versus_historical"]["lost_gold"]}), flush=True)
    finally:
        if undo:
            undo()
        close_model(lm)
        info.update(finished=now(), wall_seconds=round(time.perf_counter() - started, 3))
        write_new_json(results / (args.label + ".meta.json"), info)


if __name__ == "__main__":
    main()
