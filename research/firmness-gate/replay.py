"""Replay the October AMI run from its call cache (no model) with a gate between extraction and the ledger.

For each series the October pipeline is run first, exactly as in October (same prompts, so every extraction and
router call is a cache hit; a miss stops the run). Its candidates for each meeting are then handed, minus the ones
the gate rejects, to a fresh pipeline with the same policy. The October run_memoria (ledger, router, scorer) does the
rest unchanged. The extractor's input is therefore held fixed: in a live system the gated ledger's beliefs would
appear in the next meeting's prompt, which this replay cannot show (meetings where they differ are listed as `drift`).
"""
import sys
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent / "ledger-engine"
sys.path[:0] = [str(ENGINE / "scripts" / "ami"), str(ENGINE)]

import replay_offline  # noqa: E402  (CacheOnly: a cache miss raises SystemExit)
import run_ami  # noqa: E402
import run_ami_review  # noqa: E402,F401  (the October review run's reviewer: run_eval.OracleReviewer = WindowOracleReviewer)
from memoria_engine.evaluation import run_eval  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.evaluation.metrics import _near, _same_content, score_meeting  # noqa: E402
from memoria_engine.extractors import OracleExtractor  # noqa: E402
from memoria_engine.pipeline import Pipeline  # noqa: E402
from specs import SPECS  # noqa: E402

CACHE = {("dev", "immediate"): "results/cache/ami_dev_memoria.jsonl",
         ("test", "immediate"): "results/cache/ami_test_memoria.jsonl",
         ("test", "confirm_conflicts"): "results/cache/ami_test_memoria_review.jsonl"}
STORED = {("dev", "immediate"): "results/ami/memoria_dev.json",
          ("test", "immediate"): "results/ami/memoria_test.json",
          ("test", "confirm_conflicts"): "results/ami/memoria_test_review.json"}
REACH = ("applied", "proposed")


def keep_all(meeting, registry, disposition):
    return True


def chains(split):
    return [c for c in load_chains(str(ENGINE / "data" / "ami_v0")) if SPECS[c.chain_id]["split"] == split]


def classify(meeting, registry, candidate):
    """The pipeline's own grounding and validation (status 'valid' = it would be written to the ledger)."""
    return Pipeline._classify(SimpleNamespace(registry=registry), meeting, candidate)


class Recorder:
    """The October extractor, unchanged, noting the beliefs its prompt was given."""

    def __init__(self, inner):
        self.inner, self.name, self.last_stats, self.beliefs = inner, inner.name, {}, {}

    def extract(self, ctx):
        self.beliefs[ctx.meeting.meeting_id] = dict(ctx.beliefs)
        out = self.inner.extract(ctx)
        self.last_stats = self.inner.last_stats
        return out


class Replayed:
    """Gives the pipeline the October candidates of a meeting, minus those the gate rejects."""

    def __init__(self, october, registry, keep, name):
        self.october, self.registry, self.keep, self.name = october, registry, keep, name
        self.last_stats, self.beliefs = {}, {}

    def extract(self, ctx):
        self.beliefs[ctx.meeting.meeting_id] = dict(ctx.beliefs)
        res = self.october[ctx.meeting.meeting_id]
        self.last_stats = res.stats
        out = []
        for d in res.dispositions:
            v = classify(ctx.meeting, self.registry, d.candidate)
            if v.status != "valid" or self.keep(ctx.meeting, self.registry, v):
                out.append(d.candidate)
        return out


def gold_matches(gm, result, registry):
    """[(disposition, gold event id or None)] for the dispositions that reached the ledger, by score_meeting's matching."""
    reach = [d for d in result.dispositions if d.status in REACH]
    used, match = set(), {}
    for g in gm.events:
        options = [(abs(d.turn - g.turn), i) for i, d in enumerate(reach) if i not in used and _same_content(d, g) and _near(d.turn, g)]
        if options:
            _, i = min(options)
            used.add(i)
            match[i] = g.event_id
    assert len(match) == len(score_meeting(gm, result, registry)["tp"])
    return [(d, match.get(i)) for i, d in enumerate(reach)]


def run(split, policy, keep=keep_all, gated_policy=None, log=lambda *a, **k: None):
    """(October run_memoria report with `keep(meeting, registry, disposition)` as gate, per-series trace).
    `policy` picks the October run (and its cache); `gated_policy` (default the same) is the gated ledger's policy."""
    llm = replay_offline.CacheOnly(str(ENGINE / CACHE[(split, policy)]))
    trace = {}

    def run_pipeline(chain, extractor, _policy_name):
        if isinstance(extractor, OracleExtractor):
            return run_eval.run_pipeline(chain, extractor, "immediate")
        recorder = Recorder(extractor)
        october = run_eval.run_pipeline(chain, recorder, policy)
        replayed = Replayed({r.meeting_id: r for r in october["results"]}, chain.registry, keep, recorder.name)
        gated = run_eval.run_pipeline(chain, replayed, gated_policy or policy)
        drift = [m for m in recorder.beliefs if recorder.beliefs[m] != replayed.beliefs[m]]
        trace[chain.chain_id] = {"chain": chain, "october": october, "gated": gated, "drift": drift}
        return gated

    run_ami.run_pipeline = run_pipeline
    try:
        report = run_ami.run_memoria(chains(split), llm, log)
    finally:
        run_ami.run_pipeline = run_eval.run_pipeline
    report["cache"] = {"hits": llm.hits, "misses": llm.misses}
    return report, trace
