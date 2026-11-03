"""Full-prompt extraction screen on preselected windows; other windows replay frozen base outputs.

This is explicitly OPEN LOOP, with original prior beliefs in every regenerated
prompt. It cannot establish a full-development closed-loop candidate win.
"""
import gc
import json
import resource
import signal
import sys
import time

from common import HERE, REVISION, harness, load_dev, offline_lm, sha, write_json
from experiment import Runtime, install, preflight, timeout

CONTEXT_RULES = """Source-to-entry check before writing each event:
- Bind each property to the component it describes. A material or colour of one part does not determine another part's material or colour, even when both allow that value.
- Read the preceding and following turns to resolve 'it', 'that', acceptance and rejection. An informal proposal followed by agreement can be a decision; an unaccepted alternative cannot.
- Separate decisions about the product from numerical ratings of its quality and descriptions of an old prototype. A comparison used to choose a rating does not change the product.
- A recap of an adopted design can confirm it, but a quotation about a different subject cannot support every existing belief. Quote the actual item/value evidence, not a nearby acknowledgement.
"""

BINDING_RULES = """Resolve the subject before matching a value:
For each quoted statement, first identify the exact component or tracked item it describes, using its label and nearby turns. Only then choose that item's attribute and value. A shared allowed-value word is not evidence that two components have the same property. If a property belongs to an untracked component, do not transfer it to a tracked component. Resolve references to an accepted design from nearby turns; an informal wording alone does not invalidate an accepted decision.
Keep distinct adopted decisions in chronological order, including two real changes of the same item within this meeting. Repeated recaps of an earlier value do not outvote a later explicit decision. Do not select one value by frequency.
"""

# Balanced, source-selected before model diagnostics. Includes old target and
# correct cases plus new-series checks; no choice uses an intervention output.
WINDOW_CASES = ("a04", "a14", "a05", "a09", "a11", "a17", "a20", "a23", "a27", "a22")


def selected_windows():
    cases = json.loads((HERE / "data/cases.json").read_text())
    keys = {c["prompt_key"] for c in cases if c["id"] in WINDOW_CASES}
    prompts = json.loads((HERE / "data/prompts.json").read_text())["app"]
    return [p for p in prompts if p["key"] in keys]


def changed_prompt(prompt, condition="context"):
    anchor = "Now the real task. Reply with JSON only, in this shape:"
    assert prompt.count(anchor) == 1
    rules = BINDING_RULES if condition == "binding" else CONTEXT_RULES
    return prompt.replace(anchor, rules + "\n" + anchor)


def configuration(rt, window, condition):
    prompt = changed_prompt(window["prompt"], condition) if condition in ("context", "binding") else window["prompt"]
    messages = ([{"role": "system", "content": window["system"]}] if window["system"] else []) + [{"role": "user", "content": prompt}]
    rendered = rt.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    return rendered, {"revision": REVISION, "intervention": rt.intervention, "condition": condition, "max_tokens": 1800,
                      "temperature": 0, "thinking": False, "loopstop": True, "rendered_prompt_sha256": sha(rendered)}


def generate(rt, window, condition):
    from mlx_lm import stream_generate
    from mlx_lm.sample_utils import make_sampler
    rendered, config = configuration(rt, window, condition)
    rt.reset()
    rt.mx.reset_peak_memory()
    text, last, cut = "", None, False
    started = time.perf_counter()
    stream = stream_generate(rt.model, rt.tok, prompt=rendered, max_tokens=1800, sampler=make_sampler(temp=0))
    try:
        for response in stream:
            text += response.text
            last = response
            stopped = harness.cut_at_repeat(text)
            if stopped is not None:
                text, cut = stopped, True
                break
    finally:
        stream.close()
    row = {"key": sha(json.dumps(config, sort_keys=True)), "original_key": window["key"], "condition": condition,
           "config": config, "text": text, "seconds": time.perf_counter()-started,
           "prompt_tokens": last.prompt_tokens if last else None, "output_tokens": last.generation_tokens if last else 0,
           "hit_budget": bool(last and last.generation_tokens >= 1800), "cut_repeat": cut,
           "peak_gb": rt.mx.get_peak_memory()/1e9, "tag": window["meeting"],
           "generation_tps": last.generation_tps if last else None, "prompt_tps": last.prompt_tps if last else None}
    rt.reset()
    return row


def model_run(conditions):
    check = preflight()
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(450)
    rt = Runtime()
    path = HERE / "results/extract-screen.jsonl"
    existing = [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
    done = {r["key"] for r in existing}
    try:
        for condition in conditions:
            restore = None
            if condition in ("target", "random", "amplify"):
                restore = install(rt, -.5 if condition == "amplify" else .5, random=condition == "random")
            elif condition not in ("context", "binding", "base-regression"):
                raise ValueError(condition)
            try:
                for window in selected_windows():
                    _, config = configuration(rt, window, condition)
                    if sha(json.dumps(config, sort_keys=True)) in done:
                        continue
                    if time.perf_counter()-rt.started > 390:
                        print("lease boundary: cached completed calls, rerun to continue", flush=True)
                        return
                    row = generate(rt, window, condition)
                    with path.open("a") as out:
                        out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    print(json.dumps({k: row[k] for k in ("condition", "tag", "seconds", "output_tokens", "peak_gb")}), flush=True)
                    if condition == "base-regression":
                        break
            finally:
                if restore:
                    restore()
    finally:
        rt.close()
        signal.alarm(0)
        print(json.dumps({"closed": True, "preflight": check, "seconds": time.perf_counter()-rt.started,
                          "process_peak_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e9}), flush=True)


def score():
    from score import summarise
    from memoria_engine.extractors import parse_events
    raw = (HERE / "results/extract-screen.jsonl").read_bytes()
    raw = raw[:raw.rfind(b"\n")+1]
    # Freeze complete records before consuming a cache that another bounded
    # lease might later extend. Partial trailing writes are never interpreted.
    frozen = HERE / f"data/extract-screen-snapshot-{sha(raw)[:12]}.jsonl"
    if not frozen.exists():
        frozen.write_bytes(raw)
    rows = [json.loads(line) for line in frozen.read_text().splitlines()]
    out = {}
    cases = json.loads((HERE / "data/cases.json").read_text())
    for condition in sorted({r["condition"] for r in rows}):
        replacements = {r["original_key"]: r for r in rows if r["condition"] == condition}
        scores, controls = [], []
        for chain in load_dev():
            base = harness.run_chain(chain, offline_lm(), "app")
            records = {m: [replacements.get(r["key"], r) for r in rs] for m, rs in base["records"].items()}
            changed = harness.run_chain(chain, harness._Recorded(records), "app")
            scores.append(harness.score_chain(chain, changed))
        for c in cases:
            if c["prompt_key"] not in replacements:
                continue
            row = replacements[c["prompt_key"]]
            candidates, clean = parse_events(row["text"])
            # Report both same source anchor and any same slot/value in the
            # window; corrections can use a better source quote.
            same = [d for d in candidates if d.object_id == c["object_id"] and str(d.value) == str(c["value"]) and not d.unresolved]
            controls.append({"id": c["id"], "expected_support": c["expected_support"],
                             "exact_anchor_present": any(d.turn == c["turn"] for d in same),
                             "same_value_any_anchor": bool(same), "parsed_cleanly": clean})
        out[condition] = {"scope": "open-loop selected-window replacement, all remaining windows frozen app replies",
                          "cache_snapshot": str(frozen.relative_to(HERE)), "cache_sha256": sha(raw),
                          "regenerated_windows": len(replacements), "summary": summarise(scores), "cases": controls}
    target = HERE / "results/extract-screen-summary.json"
    if target.exists():
        target = HERE / f"results/extract-screen-summary-{sha(json.dumps(rows))[:12]}.json"
    write_json(target, out)
    print(f"summary: {target}")
    print(json.dumps({k: {"regenerated_windows": v["regenerated_windows"],
                          **{m: v["summary"][m] for m in ("qa_exact", "qa_exact_by_type", "tp", "values", "inbox_confirm_all", "unclean")}}
                      for k, v in out.items()}, indent=2))


if __name__ == "__main__":
    if sys.argv[1] == "score":
        score()
    else:
        model_run(sys.argv[1:])
