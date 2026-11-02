"""DeepSeek V4.1 Flash in place of Qwen3.5-4B, on the frozen AMI test split, with the October code unchanged.

The October entry points are run as they are (scripts/ami/run_ami.py, run_ami_review.py, review_burden.py, render_ami.py);
the only change is that `memoria_engine.llmcache.CachingMLX` is replaced by `CachingOpenRouter` (see openrouter.py),
the same trick the October scripts/ami/replay_offline.py uses to replay a run without the model.

    python3.11 run.py key                      # spend and limit of the key
    python3.11 run.py estimate memoria         # tokens and cost of a run, from the October prompts, before paying
    python3.11 run.py sanity                   # two calls on the dev split, parsed with the October parsers
    python3.11 run.py run memoria              # (a) ledger: DeepSeek extracts, DeepSeek routes (immediate policy)
    python3.11 run.py run memoria-review       # (a) same, belief-changing conflicts to an oracle reviewer (October run_ami_review)
    python3.11 run.py burden                   # proposals per meeting a reviewer would see (October review_burden, offline)
    python3.11 run.py run fc                   # (b) full-context + chain of thought
    python3.11 run.py run bm25                 # (c) BM25 retrieval, k = 12
    python3.11 run.py render                   # the October report format for the DeepSeek runs (offline)

Every run prints its estimate and refuses to start when the expected cost (no prompt caching) exceeds what is left under
the $0.90 cap; during a run, a call whose worst case would cross the cap is not made.
"""
import argparse
import io
import json
import shutil
import sys
import time
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEDGER = HERE.parent / "ledger-engine"
AMI = LEDGER / "scripts" / "ami"
sys.path[:0] = [str(HERE), str(AMI), str(LEDGER)]

import memoria_engine.llmcache as llmcache  # noqa: E402
from memoria_engine.evaluation import baselines, router as routing  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.evaluation.run_scaling import BASELINE_CONFIGS  # noqa: E402
from memoria_engine.pipeline import Meeting, MeetingContext, ground  # noqa: E402
from memoria_engine.windowed import WindowedExtractor  # noqa: E402
from openrouter import CAP_USD, MODEL, PRICE, SETTINGS, CachingOpenRouter, key_check, load_cache, request_body, request_key, spend_total  # noqa: E402
from specs import SPECS  # noqa: E402

CACHE, RESULTS = HERE / "cache", HERE / "results"
OCTOBER = LEDGER / "results" / "cache"
PARTS = {
    "memoria": dict(part="memoria", cache="test_memoria.jsonl", out="memoria_test.json", october="ami_test_memoria.jsonl"),
    "memoria-review": dict(part="memoria", review=True, cache="test_memoria_review.jsonl", out="memoria_test_review.json",
                           october="ami_test_memoria.jsonl", seed="test_memoria.jsonl"),
    "fc": dict(part="baselines", configs="fc+cot", cache="test_fc.jsonl", out="baselines_fc_test.json", october="ami_test_baselines.jsonl"),
    "bm25": dict(part="baselines", configs="bm25-12", cache="test_bm25.jsonl", out="baselines_bm25_test.json", october="ami_test_baselines.jsonl"),
}


def chains_of(split):
    return [c for c in load_chains(str(LEDGER / "data/ami_v0")) if SPECS[c.chain_id]["split"] == split]


def use_openrouter(run_name, offline=False):
    """Make the October scripts build CachingOpenRouter wherever they build CachingMLX."""
    made = []

    def factory(cache_path, *args, **kwargs):
        made.append(CachingOpenRouter(cache_path, run=run_name, offline=offline))
        return made[-1]

    llmcache.CachingMLX = factory
    return made


# ---- estimate --------------------------------------------------------------------------------------

def october_calls(name):
    """Every request of the October Qwen run of this part, rebuilt by replaying its call cache (no model)."""
    import replay_offline
    import run_ami

    class Recorder(replay_offline.CacheOnly):
        def __init__(self, path):
            super().__init__(path)
            self.seen, self.tag = [], None

        def extract(self, ctx):
            self.tag = ctx.meeting.meeting_id
            try:
                return super().extract(ctx)
            finally:
                self.tag = None

        def complete(self, prompt, max_tokens=None):
            out = super().complete(prompt, max_tokens)
            self.seen.append({"prompt": prompt, "max_tokens": max_tokens or self.max_tokens, "tag": self.tag,
                              "qwen_in": out["prompt_tokens"], "qwen_out": out["output_tokens"]})
            return out

    spec, chains = PARTS[name], chains_of("test")
    rec = Recorder(str(OCTOBER / spec["october"]))
    quiet = lambda *a, **k: None  # noqa: E731
    if spec["part"] == "memoria":
        run_ami.run_memoria(chains, rec, quiet)
    else:
        run_ami.run_baselines(chains, rec, spec["configs"].split(","), quiet)
    if spec.get("review"):  # upper bound on new requests: every window after a chain's first meeting (routes are cached)
        first = {c.meetings[0].meeting.meeting_id for c in chains}
        rec.seen = [s for s in rec.seen if s["tag"] is not None and s["tag"] not in first]
    return rec.seen


def chars_per_token(calls):
    """DeepSeek's ratio from the requests already paid; before the first one, Qwen's ratio on the October prompts."""
    paid = [r for p in CACHE.glob("*.jsonl") for r in load_cache(p).values() if r.get("prompt_tokens")]
    if paid:
        return sum(r["prompt_chars"] for r in paid) / sum(r["prompt_tokens"] for r in paid), f"DeepSeek, {len(paid)} paid requests"
    return sum(len(c["prompt"]) for c in calls) / sum(c["qwen_in"] for c in calls), "Qwen tokenizer on the October prompts (no DeepSeek call yet)"


def common_prefix(a, b):
    n, i = min(len(a), len(b)), 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def estimate(name, quiet=False):
    spec = PARTS[name]
    calls = october_calls(name)
    have = load_cache(CACHE / spec["cache"])
    if spec.get("seed"):
        have.update(load_cache(CACHE / spec["seed"]))
    ratio, source = chars_per_token(calls)
    todo = [c for c in calls if request_key(request_body(c["prompt"], c["max_tokens"])) not in have]
    tokens_in = sum(len(c["prompt"]) for c in todo) / ratio
    shared = sum(common_prefix(a["prompt"], b["prompt"]) for a, b in zip(todo, todo[1:])) / ratio
    out_expected, out_max = sum(c["qwen_out"] for c in todo), sum(c["max_tokens"] for c in todo)
    est = {"part": name, "requests": len(calls), "to_pay": len(todo), "chars_per_token": round(ratio, 3), "ratio_source": source,
           "input_tokens": round(tokens_in), "cacheable_tokens": round(shared), "output_tokens_expected": out_expected, "output_tokens_max": out_max,
           "usd_no_cache": round(tokens_in * PRICE["input"] + out_expected * PRICE["output"], 4),
           "usd_with_cache": round((tokens_in - shared) * PRICE["input"] + shared * PRICE["cached"] + out_expected * PRICE["output"], 4),
           "usd_worst": round(tokens_in * PRICE["input"] + out_max * PRICE["output"], 4)}
    if not quiet:
        print(f"[estimate] {name}: {est['requests']} requests, {est['to_pay']} not yet cached; ~{est['input_tokens']:,} input tokens "
              f"({est['chars_per_token']} chars/token, {source}), ~{est['cacheable_tokens']:,} of them a prefix shared with the previous request; "
              f"output ~{est['output_tokens_expected']:,} tokens (October Qwen lengths), at most {est['output_tokens_max']:,}", flush=True)
        print(f"[estimate] {name}: ${est['usd_no_cache']} without prompt caching, ${est['usd_with_cache']} if every shared prefix is cached, "
              f"${est['usd_worst']} worst case (no caching, every output at max_tokens)", flush=True)
    return est


# ---- runs ------------------------------------------------------------------------------------------

def run(name):
    spec = PARTS[name]
    RESULTS.mkdir(parents=True, exist_ok=True)
    est = estimate(name)
    before = key_check(f"before {name}")
    left = CAP_USD - max(float(before["usage"] or 0.0), spend_total())
    if est["usd_no_cache"] > left:
        sys.exit(f"[estimate] NO-GO: ${est['usd_no_cache']} expected, ${left:.4f} left under the ${CAP_USD} cap")
    print(f"[estimate] GO: ${est['usd_no_cache']} expected (worst ${est['usd_worst']}), ${left:.4f} left under the cap", flush=True)
    if spec.get("seed") and not (CACHE / spec["cache"]).exists():  # as in October: identical requests are not asked again
        shutil.copyfile(CACHE / spec["seed"], CACHE / spec["cache"])
    if spec.get("review"):
        import run_ami_review  # noqa: F401  (October: confirm_conflicts policy and the oracle reviewer)
    import run_ami
    made = use_openrouter(f"test-{name}")
    out = RESULTS / spec["out"]
    sys.argv = ["run_ami.py", "--split", "test", "--part", spec["part"], "--cache", str(CACHE / spec["cache"]), "--out", str(out)]
    if spec.get("configs"):
        sys.argv += ["--configs", spec["configs"]]
    try:
        run_ami.main()
    finally:
        after = key_check(f"after {name}")
        if made:
            print(f"[spend] {name}: paid ${made[-1].paid:.4f} in this process ({made[-1].misses} new requests, {made[-1].hits} from the cache)", flush=True)
    llm = made[-1]
    report = json.loads(out.read_text())
    report["strong_model"] = {"model": MODEL, "settings": SETTINGS, "estimate": est, "key_before": before, "key_after": after,
                              "paid_usd": round(llm.paid, 6), "calls": llm.calls}
    out.write_text(json.dumps(report, indent=1, default=str))


def sanity():
    """Two requests on the dev split (ES2003): one extraction window holding a gold decision, one question route."""
    chain = [c for c in chains_of("dev") if c.chain_id == "ES2003"][0]
    llm = CachingOpenRouter(str(CACHE / "dev_sanity.jsonl"), run="dev-sanity")
    key_check("before sanity")
    gm = chain.meetings[0]
    gold = gm.events[0]
    window = next(w for w in WindowedExtractor(None).windows(gm.meeting) if gold.turn in w)
    sub = Meeting(gm.meeting.meeting_id, gm.meeting.occurred_at, gm.meeting.ingested_at, tuple(gm.meeting.turns[i] for i in window))
    candidates = llm.extract(MeetingContext(sub, chain.registry, {}))
    print(f"[sanity] extraction {gm.meeting.meeting_id} turns {window[0]}-{window[-1]}: parsed cleanly = {llm.last_stats['parsed_cleanly']}, "
          f"{len(candidates)} candidates; gold in this window: {[(e.turn, e.object_id, e.value) for e in gm.events if e.turn in window]}")
    for c in candidates:
        print(f"   turn {c.turn} {c.object_id}.{c.attribute} = {c.value!r} conf {c.confidence} grounded={ground(gm.meeting, c.quote, c.turn) is not None} quote={c.quote[:70]!r}")
    q = next(q for q in chain.questions if q.type == "as_of_valid")
    route = routing.MLXRouter(llm).route(chain.registry, baselines.today_iso(chain), q.ask)
    print(f"[sanity] route for {q.qid} {q.ask!r}: {route.as_dict()} exact = {routing.route_matches(route, q)}")
    for r in load_cache(CACHE / "dev_sanity.jsonl").values():
        print(f"[sanity] {r['prompt_head'][:40]!r}: {r['prompt_tokens']} in ({r['prompt_chars']} chars), {r['output_tokens']} out, "
              f"reasoning {r['reasoning_tokens']}, cached {r['cached_tokens']}, ${r['cost']}, {r['seconds']} s, provider {r['provider']}, "
              f"finish {r['finish_reason']}")
    key_check("after sanity")


def burden():
    import replay_offline
    import review_burden  # imports run_ami_review: the October review policy and reviewer

    replay_offline.CacheOnly = lambda path: CachingOpenRouter(path, run="replay", offline=True)
    sys.argv = ["review_burden.py", "--split", "test", "--cache", str(CACHE / "test_memoria_review.jsonl"), "--out", str(RESULTS / "review_burden_test.json")]
    review_burden.main()


def render():
    import render_ami

    parts = [json.loads((RESULTS / PARTS[p]["out"]).read_text()) for p in ("fc", "bm25") if (RESULTS / PARTS[p]["out"]).exists()]
    if parts:
        merged = {"config": parts[0]["config"], "baselines": {k: v for p in parts for k, v in p["baselines"].items()}}
        (RESULTS / "baselines_test.json").write_text(json.dumps(merged, indent=1, default=str))
    for mem, base, md in (("memoria_test.json", "baselines_test.json", "deepseek_test_report.md"),
                          ("memoria_test_review.json", None, "deepseek_test_review_report.md")):
        if (RESULTS / mem).exists():
            buf = io.StringIO()
            with redirect_stdout(buf):
                render_ami.main(str(RESULTS / mem), str(RESULTS / base) if base else None)
            (RESULTS / md).write_text(buf.getvalue())
            print(f"wrote {RESULTS / md}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=("key", "estimate", "sanity", "run", "burden", "render"))
    ap.add_argument("part", nargs="?", choices=tuple(PARTS))
    a = ap.parse_args()
    started = time.time()
    if a.command == "key":
        key_check("manual check")
    elif a.command == "estimate":
        for name in ([a.part] if a.part else PARTS):
            estimate(name)
    elif a.command == "sanity":
        sanity()
    elif a.command == "run":
        run(a.part)
    elif a.command == "burden":
        burden()
    else:
        render()
    print(f"[{a.command}] {time.time() - started:.0f} s", flush=True)
