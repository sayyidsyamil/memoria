"""Narrow Ask/router/guard probes under one pinned model condition and fresh caches."""
import argparse
import json
import re
import time

from context import HERE, load_chain, sha256, write_new_json
from runtime import close_model, hard_deadline, load_model, now, reset_shared


def main():
    import mlx.core as mx
    import model_server
    from mlx_lm import stream_generate
    from mlx_lm.models.cache import make_prompt_cache
    from mlx_lm.sample_utils import make_sampler
    from ask_facts import _complete_attribute
    from memoria_engine.evaluation.router import parse_route, route_matches

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--edit")
    args = parser.parse_args()
    hard_deadline()
    probe_file = HERE / "data" / "cross_task_probes.json"
    probes = json.loads(probe_file.read_text())["probes"]
    lm, undo = load_model(), None
    meta = {"label": args.label, "started": now(), "probe_sha256": sha256(probe_file.read_bytes()), "load": lm.load_info}
    try:
        if args.edit:
            from weight_patch import install
            meta["patch"], undo = install(lm.model, json.loads((HERE / args.edit).read_text()))
        with (HERE / "results" / (args.label + ".jsonl")).open("x") as out:
            for probe in probes:
                reset_shared()
                mx.reset_peak_memory()
                started = time.perf_counter()
                row = {"id": probe["id"], "kind": probe["kind"]}
                if probe["kind"] == "guard":
                    result = model_server.score_first_tokens(lm.model, lm.tokenizer,
                                                            {"messages": probe["messages"], "candidates": ["YES", "NO"]})
                    odds = result["logprobs"]["YES"] - result["logprobs"]["NO"]
                    row.update(**result, log_odds=odds, expected=probe["expected_conflict"],
                               alert=odds >= probe["threshold"], correct=(odds >= probe["threshold"]) == probe["expected_conflict"])
                elif probe["kind"] == "meeting":
                    text = model_server.meeting_answer(lm.model, lm.tokenizer, probe)
                    row.update(text=text, phrase_found=probe["required_phrase"] in text.casefold(),
                               citation_found=bool(re.search(r"\[\d+:\d+\]", text)))
                    row["smoke_pass"] = row["phrase_found"] and (row["citation_found"] or not probe["requires_citation"])
                else:
                    chain = load_chain(probe["series"])
                    question = next(q for q in chain.questions if q.qid == probe["qid"])
                    rendered = lm.tokenizer.apply_chat_template(
                        [{"role": "system", "content": probe["system"]}, {"role": "user", "content": probe["prompt"]}],
                        tokenize=False, add_generation_prompt=True, enable_thinking=False)
                    text, last = "", None
                    for response in stream_generate(lm.model, lm.tokenizer, prompt=rendered,
                                                    max_tokens=probe["max_tokens"], sampler=make_sampler(temp=0),
                                                    prompt_cache=make_prompt_cache(lm.model)):
                        text += response.text
                        last = response
                    route = parse_route(_complete_attribute(text, chain.registry, question.ask), chain.registry)
                    row.update(text=text, exact=route_matches(route, question), parsed=route.ok,
                               output_tokens=last.generation_tokens)
                mx.synchronize()
                row.update(seconds=round(time.perf_counter() - started, 4), peak_mlx_gb=mx.get_peak_memory() / 1e9)
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
                out.flush()
                print(json.dumps(row, ensure_ascii=False), flush=True)
    finally:
        if undo:
            undo()
        close_model(lm)
        meta["finished"] = now()
        write_new_json(HERE / "results" / (args.label + ".meta.json"), meta)


if __name__ == "__main__":
    main()
