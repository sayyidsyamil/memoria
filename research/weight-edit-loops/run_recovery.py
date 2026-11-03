"""Actual generation controls: duplicate A, then grounded distinct B must survive.

The copy control uses two events already grounded in TS3006b turn107 (speech + LCD).
The continuation control appends A,A as a forced assistant prefix to that window's
unchanged extraction prompt. It is labelled a stress intervention, not spontaneous
baseline generation. Neither expected event is part of candidate inference code.
"""
import argparse
import json
import time

from context import HERE, prompt_rows, sha256, write_new_json
from quality import event_quality
from runtime import close_model, hard_deadline, load_model, now, reset_shared
from stop_rule import EventRepeatStop, conservative


def main():
    import mlx.core as mx
    from mlx_lm import stream_generate
    from mlx_lm.models.cache import make_prompt_cache
    from mlx_lm.sample_utils import make_sampler

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--edit")
    args = parser.parse_args()
    hard_deadline()
    source = next(r for r in prompt_rows() if r["id"] == "TS3006b.w1")
    a, b = json.loads(source["reference"]["text"])["events"][:2]
    assert a["object_id"] != b["object_id"] and a["quote"] == b["quote"] and a["turn"] == b["turn"] == 107
    expected = json.dumps({"events": [a, a, b]}, ensure_ascii=False, separators=(",", ":"))
    prefix = '{"events":[' + ','.join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in (a, a)) + ','
    frozen = {"source_prompt_sha256": source["prompt_sha256"], "copy_json_sha256": sha256(expected),
              "forced_prefix_sha256": sha256(prefix), "source": "two distinct decisions explicitly stated at TS3006b turn107",
              "expected_later_object": b["object_id"], "expected_later_value": b["value"]}
    lm, undo = load_model(), None
    meta = {"label": args.label, "load": lm.load_info, "started": now(), "control": frozen}
    try:
        if args.edit:
            from weight_patch import install
            meta["patch"], undo = install(lm.model, json.loads((HERE / args.edit).read_text()))
        with (HERE / "results" / (args.label + ".jsonl")).open("x") as out:
            for mode in ("copy", "forced-prefix"):
                prompt = ("Return this supplied extraction record exactly as JSON, preserving every array element including repeated entries:\n" + expected
                          if mode == "copy" else source["prompt"])
                for policy in ("base", "first-repeat", "conservative"):
                    reset_shared()
                    rendered = lm.tokenizer.apply_chat_template(
                        [{"role": "system", "content": source["system"]}, {"role": "user", "content": prompt}],
                        tokenize=False, add_generation_prompt=True, enable_thinking=False)
                    initial = prefix if mode == "forced-prefix" else ""
                    rendered += initial
                    detector = EventRepeatStop() if policy == "first-repeat" else conservative() if policy == "conservative" else None
                    raw, last, early = initial, None, False
                    started = time.perf_counter()
                    if detector and initial:
                        early = detector.feed(initial)
                    if not early:
                        stream = stream_generate(lm.model, lm.tokenizer, prompt=rendered,
                                                 max_tokens=600 if mode == "copy" else 1800,
                                                 sampler=make_sampler(temp=0), prompt_cache=make_prompt_cache(lm.model))
                        try:
                            for response in stream:
                                raw += response.text
                                last = response
                                if detector and detector.feed(response.text):
                                    early = True
                                    break
                        finally:
                            stream.close()
                            mx.synchronize()
                    text = detector.closed_text() if early else raw
                    quality = event_quality(source, text)
                    later = any(e["object_id"] == b["object_id"] and e["value"] == b["value"] and e["quote"] == b["quote"]
                                for e in quality["events"])
                    row = {"mode": mode, "policy": policy, "seconds": round(time.perf_counter() - started, 4),
                           "generated_tokens": last.generation_tokens if last else 0,
                           "forced_prefix_tokens": len(lm.tokenizer.encode(initial, add_special_tokens=False)),
                           "early_stopped": early, "distinct_correct_event_preserved": later,
                           "text": text, "raw_text": raw, "quality": quality}
                    out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    out.flush()
                    print(json.dumps({k: row[k] for k in ("mode", "policy", "seconds", "generated_tokens", "early_stopped", "distinct_correct_event_preserved")}), flush=True)
    finally:
        if undo:
            undo()
        close_model(lm)
        meta["finished"] = now()
        write_new_json(HERE / "results" / (args.label + ".meta.json"), meta)


if __name__ == "__main__":
    main()
