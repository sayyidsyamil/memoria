"""Qwen3.5-9B (4-bit MLX, on this Mac) in place of Qwen3.5-4B on the October AMI ledger pipeline. Only the model changes.

The October entry points run unchanged (scripts/ami/run_ami.py, run_ami_review.py, review_burden.py, replay_offline.py,
render_ami.py). As in ../strong-model/run.py and October's replay_offline.py, `memoria_engine.llmcache.CachingMLX` is
replaced, here by `Local`: October's CachingMLX (same cache key, same record, same greedy `MLXExtractor.complete` with
thinking off) that loads a pinned local snapshot with no network, records MLX peak memory per call and notes which meeting
each call read. Extractor prompt v2, router r1, 7000-character windows and max_tokens 900 / 90 are October's.

    python3.11 run.py replay-october          # no model: today's engine reproduces October's dev, test and review runs
    python3.11 run.py check-4b                # Qwen3.5-4B today on October's test prompts: same replies? seconds, memory
    python3.11 run.py sanity                  # 9B: one dev window and one route, parsed by the October parsers
    python3.11 run.py run dev|dev-review|test|test-review
    python3.11 run.py replay dev|dev-review|test|test-review   # no model: the run again from cache/, must be identical
    python3.11 run.py burden dev|test         # October review_burden.py on the review run (no model)
    python3.11 run.py render dev|test         # October render_ami.py reports (no model)
"""
import argparse
import io
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from contextlib import redirect_stdout
from pathlib import Path

sys.dont_write_bytecode = True  # a release build packages the engine folder ../ledger-engine links to: no .pyc there
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"  # nor from October's scripts run as subprocesses
os.environ.setdefault("HF_HUB_OFFLINE", "1")  # never download: the weights are already in the HF cache
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

HERE = Path(__file__).resolve().parent
LEDGER = HERE.parent / "ledger-engine"
AMI = LEDGER / "scripts" / "ami"
sys.path[:0] = [str(AMI), str(LEDGER)]

import memoria_engine.llmcache as llmcache  # noqa: E402
from memoria_engine.evaluation import baselines, router as routing  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.extractors import MLXExtractor  # noqa: E402
from memoria_engine.pipeline import Meeting, MeetingContext, ground  # noqa: E402
from memoria_engine.windowed import WindowedExtractor  # noqa: E402
from specs import SPECS  # noqa: E402

MODEL, REVISION = "mlx-community/Qwen3.5-9B-MLX-4bit", "938d8919941c6e7efd3c7150eff7fe9d12afa631"
OCT_MODEL, OCT_REVISION = "mlx-community/Qwen3.5-4B-MLX-4bit", "32f3e8ecf65426fc3306969496342d504bfa13f3"
CACHE, RESULTS = HERE / "cache", HERE / "results"
OCTOBER = LEDGER / "results"
PARTS = {
    "dev": dict(split="dev", cache="dev_memoria.jsonl", out="memoria_dev.json"),
    "dev-review": dict(split="dev", review=True, cache="dev_memoria_review.jsonl", out="memoria_dev_review.json", seed="dev_memoria.jsonl"),
    "test": dict(split="test", cache="test_memoria.jsonl", out="memoria_test.json"),
    "test-review": dict(split="test", review=True, cache="test_memoria_review.jsonl", out="memoria_test_review.json", seed="test_memoria.jsonl"),
}


class Local(llmcache.CachingMLX):
    """October's CachingMLX with the weights taken from a pinned local snapshot. Same key (model id, max_tokens, prompt),
    same record fields plus revision and MLX peak memory; generation is October's MLXExtractor.complete."""

    def __init__(self, cache_path, model_id=MODEL, max_tokens=900, revision=REVISION, offline=False):
        super().__init__(cache_path, model_id, max_tokens)
        self.revision, self.offline = revision, offline
        self.calls, self.tag = [], None
        self.load_seconds = self.weights_gb = None
        self.peak_gb = 0.0

    def load(self):
        if self.offline or self._model is not None:
            return
        import mlx.core as mx
        from huggingface_hub import snapshot_download
        from mlx_lm import load

        path = snapshot_download(self.model_id, revision=self.revision, local_files_only=True)
        started = time.perf_counter()
        self._model, self._tok = load(path)
        self.load_seconds = round(time.perf_counter() - started, 2)
        self.weights_gb = round(mx.get_active_memory() / 1e9, 3)
        self.peak_gb = max(self.peak_gb, round(mx.get_peak_memory() / 1e9, 3))

    def extract(self, ctx):
        self.tag = ctx.meeting.meeting_id
        try:
            return super().extract(ctx)
        finally:
            self.tag = None

    def complete(self, prompt, max_tokens=None):
        budget = max_tokens or self.max_tokens
        key = self._key(prompt, budget)
        record = self._cache.get(key)
        hit = record is not None
        if hit:
            self.hits += 1
        elif self.offline:
            raise SystemExit("cache miss in an offline replay: this prompt was never sent to the model")
        else:
            import mlx.core as mx

            mx.reset_peak_memory()
            out = MLXExtractor.complete(self, prompt, budget)
            peak = round(mx.get_peak_memory() / 1e9, 3)
            self.peak_gb = max(self.peak_gb, peak)
            record = {"key": key, "model": self.model_id, "revision": self.revision, "max_tokens": budget, "prompt_head": prompt[:120],
                      "text": out["text"], "seconds": out["seconds"], "prompt_tokens": out["prompt_tokens"], "output_tokens": out["output_tokens"],
                      "peak_gb": peak, "recorded": time.strftime("%Y-%m-%d %H:%M:%S")}
            self._cache[key] = record
            with self.cache_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
            self.misses += 1
        self.calls.append({"key": key, "hit": hit, "tag": self.tag})
        return {"text": record["text"], "seconds": record["seconds"], "prompt_tokens": record["prompt_tokens"],
                "output_tokens": record["output_tokens"], "cached": hit}


def runtime():
    import importlib.metadata as md

    chip = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
    ram = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True).stdout.strip() or 0)
    return {"python": platform.python_version(), "machine": platform.platform(), "chip": chip, "ram_gb": round(ram / 2 ** 30),
            **{p: md.version(p) for p in ("mlx", "mlx-lm", "transformers", "huggingface_hub")}}


def chains_of(split):
    return [c for c in load_chains(str(LEDGER / "data/ami_v0")) if SPECS[c.chain_id]["split"] == split]


def use_local(offline=False):
    """Make the October scripts build Local wherever they build CachingMLX."""
    made = []

    def factory(cache_path, *args, **kwargs):
        made.append(Local(cache_path, offline=offline))
        return made[-1]

    llmcache.CachingMLX = factory
    return made


# ---- checks that the comparison is fair -------------------------------------------------------------------------------

def replay_october():
    """October's own replay tool on October's caches: today's engine must give the stored dev, test and review runs."""
    tmp = Path(os.environ.get("TMPDIR", "/tmp")) / "local-9b-replay"
    tmp.mkdir(parents=True, exist_ok=True)
    for split, cache, stored, review in (("dev", "ami_dev_memoria.jsonl", "memoria_dev.json", False),
                                         ("test", "ami_test_memoria.jsonl", "memoria_test.json", False),
                                         ("test", "ami_test_memoria_review.jsonl", "memoria_test_review.json", True)):
        cmd = [sys.executable, str(AMI / "replay_offline.py"), "--split", split, "--part", "memoria", "--cache", f"results/cache/{cache}",
               "--stored", f"results/ami/{stored}", "--out", str(tmp / stored)] + (["--review"] if review else [])
        res = subprocess.run(cmd, cwd=LEDGER, capture_output=True, text=True)
        print(f"[replay-october] {stored}: {res.stdout.strip().splitlines()[-1] if res.stdout.strip() else res.stderr.strip()[-300:]}", flush=True)
        if res.returncode:
            sys.exit(1)


def october_calls(split="test"):
    """Every request of October's Qwen3.5-4B ledger run, rebuilt by replaying its cache (no model), in call order."""
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
            self.seen.append({"prompt": prompt, "max_tokens": max_tokens or self.max_tokens, "tag": self.tag, "october": out})
            return out

    rec = Recorder(str(OCTOBER / "cache" / f"ami_{split}_memoria.jsonl"))
    run_ami.run_memoria(chains_of(split), rec, lambda *a, **k: None)
    return rec.seen


def check_4b():
    """Qwen3.5-4B today, on October's own test prompts: every window of each team's first meeting (whose prompt is the
    same for any extractor, since nothing is believed yet) and all 96 routes (the router prompt never depends on the ledger).
    Same replies as October means today's runtime is October's; the seconds and memory are the 4B reference for the 9B."""
    calls = [c for c in october_calls("test") if c["tag"] is None or c["tag"].endswith("a")]
    llm = Local(str(CACHE / "check_4b.jsonl"), model_id=OCT_MODEL, revision=OCT_REVISION)
    llm.load()
    print(f"[check-4b] {OCT_MODEL}@{OCT_REVISION[:7]} loaded in {llm.load_seconds} s, {llm.weights_gb} GB; {len(calls)} October calls", flush=True)
    rows = []
    for c in calls:
        out = llm.complete(c["prompt"], c["max_tokens"])
        rec = llm._cache[llm._key(c["prompt"], c["max_tokens"])]
        rows.append({"tag": c["tag"], "key": rec["key"], "identical": out["text"] == c["october"]["text"], "seconds_today": round(out["seconds"], 3),
                     "seconds_october": round(c["october"]["seconds"], 3), "prompt_tokens": out["prompt_tokens"], "output_tokens": out["output_tokens"],
                     "output_tokens_october": c["october"]["output_tokens"], "peak_gb": rec.get("peak_gb")})
        print(f"[check-4b] {c['tag'] or 'route'}: identical={rows[-1]['identical']} {rows[-1]['seconds_today']} s (October {rows[-1]['seconds_october']} s) "
              f"{out['prompt_tokens']} in / {out['output_tokens']} out, peak {rec.get('peak_gb')} GB", flush=True)
    out = {"model": OCT_MODEL, "revision": OCT_REVISION, "runtime": runtime(), "date": time.strftime("%Y-%m-%d %H:%M:%S"),
           "load_seconds": llm.load_seconds, "weights_gb": llm.weights_gb, "mlx_peak_gb": llm.peak_gb,
           "identical": sum(r["identical"] for r in rows), "n": len(rows), "rows": rows}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "check_4b.json").write_text(json.dumps(out, indent=1))
    print(f"[check-4b] identical {out['identical']}/{out['n']}; MLX peak {llm.peak_gb} GB", flush=True)


def sanity():
    """Two 9B requests on the dev split (ES2003), as the strong-model study did: a window holding a gold decision, one route."""
    chain = [c for c in chains_of("dev") if c.chain_id == "ES2003"][0]
    llm = Local(str(CACHE / "dev_sanity.jsonl"))
    llm.load()
    print(f"[sanity] {MODEL}@{REVISION[:7]} loaded in {llm.load_seconds} s, weights {llm.weights_gb} GB", flush=True)
    gm = chain.meetings[0]
    window = next(w for w in WindowedExtractor(None).windows(gm.meeting) if gm.events[0].turn in w)
    sub = Meeting(gm.meeting.meeting_id, gm.meeting.occurred_at, gm.meeting.ingested_at, tuple(gm.meeting.turns[i] for i in window))
    candidates = llm.extract(MeetingContext(sub, chain.registry, {}))
    st = llm.last_stats
    print(f"[sanity] extraction {gm.meeting.meeting_id} turns {window[0]}-{window[-1]}: parsed cleanly = {st['parsed_cleanly']}, {len(candidates)} candidates, "
          f"{st['llm_seconds']} s, {st['prompt_tokens']} in / {st['output_tokens']} out; gold here: {[(e.turn, e.object_id, e.value) for e in gm.events if e.turn in window]}")
    for c in candidates:
        print(f"   turn {c.turn} {c.object_id}.{c.attribute} = {c.value!r} conf {c.confidence} grounded={ground(gm.meeting, c.quote, c.turn) is not None} quote={c.quote[:70]!r}")
    q = next(q for q in chain.questions if q.type == "as_of_valid")
    router = routing.MLXRouter(llm)
    route = router.route(chain.registry, baselines.today_iso(chain), q.ask)
    print(f"[sanity] route for {q.qid} {q.ask!r}: {route.as_dict()} exact = {routing.route_matches(route, q)}, {router.last_stats['seconds']} s")
    print(f"[sanity] MLX peak {llm.peak_gb} GB")


# ---- the runs ----------------------------------------------------------------------------------------------------------

def run(name):
    spec = PARTS[name]
    RESULTS.mkdir(parents=True, exist_ok=True)
    cache = CACHE / spec["cache"]
    if spec.get("seed") and not cache.exists():  # as in October: a request already answered is not asked again
        shutil.copyfile(CACHE / spec["seed"], cache)
    if spec.get("review"):
        import run_ami_review  # noqa: F401  (October: policy confirm_conflicts and the oracle reviewer)
    import run_ami

    made = use_local()
    out = RESULTS / spec["out"]
    sys.argv = ["run_ami.py", "--split", spec["split"], "--part", "memoria", "--cache", str(cache), "--out", str(out)]
    started = time.time()
    run_ami.main()
    llm = made[-1]
    report = json.loads(out.read_text())
    report["local_model"] = {"model": MODEL, "revision": REVISION, "runtime": runtime(), "load_seconds": llm.load_seconds,
                             "weights_gb": llm.weights_gb, "mlx_peak_gb": llm.peak_gb, "process_seconds": round(time.time() - started, 1),
                             "calls": llm.calls}
    out.write_text(json.dumps(report, indent=1, default=str))
    print(f"[run] {name}: {report['cache']}; weights {llm.weights_gb} GB, MLX peak {llm.peak_gb} GB, load {llm.load_seconds} s", flush=True)


def replay(name):
    """The finished run again from cache/ with no model; it must reproduce the stored result (October's comparable())."""
    spec = PARTS[name]
    if spec.get("review"):
        import run_ami_review  # noqa: F401
    import run_ami
    from replay_offline import comparable

    use_local(offline=True)
    tmp = Path(os.environ.get("TMPDIR", "/tmp")) / f"local-9b-replay-{name}.json"
    sys.argv = ["run_ami.py", "--split", spec["split"], "--part", "memoria", "--cache", str(CACHE / spec["cache"]), "--out", str(tmp)]
    with redirect_stdout(io.StringIO()):
        run_ami.main()
    same = comparable(json.loads((RESULTS / spec["out"]).read_text())) == comparable(json.loads(tmp.read_text()))
    print(f"[replay] {name}: " + ("REPLAY IDENTICAL" if same else "REPLAY DIFFERS"), flush=True)
    if not same:
        sys.exit(1)


def burden(split):
    import replay_offline
    import review_burden  # imports run_ami_review: the October review policy and reviewer

    replay_offline.CacheOnly = lambda path: Local(path, offline=True)
    sys.argv = ["review_burden.py", "--split", split, "--cache", str(CACHE / f"{split}_memoria_review.jsonl"),
                "--out", str(RESULTS / f"review_burden_{split}.json")]
    review_burden.main()


def render(split):
    import render_ami

    for mem, md in ((f"memoria_{split}.json", f"qwen9b_{split}_report.md"), (f"memoria_{split}_review.json", f"qwen9b_{split}_review_report.md")):
        if (RESULTS / mem).exists():
            buf = io.StringIO()
            with redirect_stdout(buf):
                render_ami.main(str(RESULTS / mem), None)
            (RESULTS / md).write_text(buf.getvalue())
            print(f"wrote {RESULTS / md}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=("replay-october", "check-4b", "sanity", "run", "replay", "burden", "render"))
    ap.add_argument("part", nargs="?")
    a = ap.parse_args()
    started = time.time()
    if a.command in ("run", "replay") and a.part not in PARTS:
        ap.error(f"part must be one of {tuple(PARTS)}")
    if a.command in ("burden", "render") and a.part not in ("dev", "test"):
        ap.error("part must be dev or test")
    {"replay-october": replay_october, "check-4b": check_4b, "sanity": sanity, "run": lambda: run(a.part),
     "replay": lambda: replay(a.part), "burden": lambda: burden(a.part), "render": lambda: render(a.part)}[a.command]()
    print(f"[{a.command}] {time.time() - started:.0f} s", flush=True)
