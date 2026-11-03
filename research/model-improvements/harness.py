"""The app's tracked-fact extraction on AMI chains, and its scoring. Shared by run.py (fills the call cache with a model)
and score.py (replays the cache, no model).

The extractor is `temporal_service.SharedExtractor` with the worker request reproduced in-process (lm.LM.app_generate):
the engine's `build_prompt`, the worker's system message and 1,800-token budget, `parse_events`, `repaired`, inside
the engine's `WindowedExtractor` (7,000 characters), through `run_eval.run_pipeline` (immediate policy, as in October).
Mechanisms under test are small changes to that path, named in MECHANISMS; "app" is the shipped path.
"""
import json
import sys
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MEMORY = ROOT / "src-tauri" / "resources" / "memory"
LEDGER = ROOT / "research" / "ledger-engine"
for _path in (str(MEMORY), str(LEDGER / "scripts" / "ami"), str(HERE)):
    if _path not in sys.path:
        sys.path.insert(0, _path)
sys.dont_write_bytecode = True

from memoria_engine.evaluation import metrics, run_eval  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.evaluation.oracle import ledger_answer, values_equal  # noqa: E402
from memoria_engine.extractors import OracleExtractor, build_prompt, parse_events  # noqa: E402
from memoria_engine.pipeline import Pipeline  # noqa: E402
from memoria_engine.windowed import WindowedExtractor  # noqa: E402

SPLITS = json.loads((HERE / "data" / "splits.json").read_text())
DATA = {"old": LEDGER / "data" / "ami_v0", "new": HERE / "data" / "ami_new"}


def split_of(series):
    return next(name for name, part in SPLITS.items() if isinstance(part, dict) and series in part.get("series", ()))


def load_series(names, allow_validation=False):
    out = []
    for name in names:
        split = split_of(name)
        if split == "new-val" and not allow_validation:
            raise SystemExit(f"{name} is in the reserved validation split; it is opened only by the preregistered final run")
        if split == "reserve":
            raise SystemExit(f"{name} is reserved and has no gold in this round")
        folder = DATA["old" if split.startswith("old") else "new"]
        chains = [c for c in load_chains(str(folder)) if c.chain_id == name]
        if len(chains) != 1:
            raise SystemExit(f"no chain {name} in {folder}")
        out.append(chains[0])
    return out


def series_of(split_names):
    return [s for split in split_names.split(",") for s in SPLITS[split]["series"]]


def duplicate_events(text):
    """How many event objects in a reply repeat an earlier one exactly (a repetition loop writes the same event again)."""
    import re
    seen, repeats = set(), 0
    for match in re.finditer(r"\{[^{}]*\"quote\"[^{}]*\}", text):
        body = re.sub(r"\s+", " ", match.group(0))
        repeats += body in seen
        seen.add(body)
    return repeats


class AppExtractor:
    """temporal_service.SharedExtractor with the worker call made through lm.LM (cached)."""
    name = "workspace-qwen"

    def __init__(self, lm, budget=1800, prompt=build_prompt, system=None, post=None, repair=True):
        from lm import APP_SYSTEM
        self.lm, self.budget, self.prompt, self.repair = lm, budget, prompt, repair
        self.system = APP_SYSTEM if system is None else system
        self.post = post
        self.last_stats, self.calls = {}, []

    def extract(self, ctx):
        from temporal_service import repaired
        record = self.lm.app_generate(self.prompt(ctx), self.budget, self.system, tag=ctx.meeting.meeting_id)
        candidates, clean = parse_events(record["text"])
        fixed = [f for c in candidates if (f := repaired(c, ctx.registry) if self.repair else c) is not None]
        if self.post is not None:
            fixed = self.post(ctx, fixed, record)
        self.calls.append({"meeting": ctx.meeting.meeting_id, "turns": [ctx.meeting.turns[0].index, ctx.meeting.turns[-1].index],
                           "seconds": record["seconds"], "prompt_tokens": record["prompt_tokens"], "output_tokens": record["output_tokens"],
                           "hit_budget": record["hit_budget"], "parsed_cleanly": clean, "candidates": len(candidates),
                           "duplicates": duplicate_events(record["text"]), "peak_gb": record.get("peak_gb")})
        self.last_stats = {"prompt_tokens": record["prompt_tokens"], "output_tokens": record["output_tokens"],
                           "llm_seconds": record["seconds"], "parsed_cleanly": clean, "raw": record["text"]}
        return fixed


MECHANISMS = {"app": dict(),
              # October's request (no system message, 900 tokens, no repairs): only for checking the harness
              "october": dict(budget=900, system="", repair=False)}


def make_extractor(lm, mechanism="app"):
    spec = MECHANISMS[mechanism]
    inner = AppExtractor(lm, **{k: v for k, v in spec.items() if k in ("budget", "prompt", "system", "post", "repair")})
    outer = spec.get("outer")
    return (outer(inner) if outer else WindowedExtractor(inner)), inner


def run_chain(chain, lm, mechanism="app"):
    """mechanism: a name in MECHANISMS, optionally followed by post-hoc filters on its candidates, open loop
    ("app|support>=0"): the base run's candidates of each meeting, minus those a filter drops, go to a fresh pipeline."""
    base, *filters = mechanism.split("|")
    windowed, inner = make_extractor(lm, base)
    run = run_eval.run_pipeline(chain, windowed, "immediate")
    run["calls"] = inner.calls
    for name in filters:
        run = {**replay_filtered(chain, run["results"], make_filter(name, chain, run["results"], lm)), "calls": run["calls"]}
    return run


def make_filter(name, chain, results, lm):
    if name.startswith("support>="):
        import support
        tau = float(name.split(">=")[1])
        scores = support.scored(chain, results, lm)
        dropped = {(m, id(c)) for m, rows in scores.items() for c, v, s in rows if s is not None and s < tau}
        return lambda meeting, candidate: (meeting.meeting_id, id(candidate)) not in dropped
    raise SystemExit(f"unknown filter {name}")


def replay_filtered(chain, results, keep):
    by_id = {r.meeting_id: r for r in results}

    class Filtered:
        name, last_stats = "filtered", {}

        def extract(self, ctx):
            return [d.candidate for d in by_id[ctx.meeting.meeting_id].dispositions if keep(ctx.meeting, d.candidate)]

    return run_eval.run_pipeline(chain, Filtered(), "immediate")


# ---- scoring (no model) ----------------------------------------------------------------------------------------------

def gold_pipeline(chain):
    return run_eval.run_pipeline(chain, OracleExtractor(chain), "immediate")["pipeline"]


class _Replayed:
    """A meeting's candidates from the immediate run, handed to another pipeline (open loop, as in firmness-gate)."""
    name = "replayed"

    def __init__(self, results):
        self.results, self.last_stats = {r.meeting_id: r for r in results}, {}

    def extract(self, ctx):
        return [d.candidate for d in self.results[ctx.meeting.meeting_id].dispositions]


def inbox(chain, results):
    """confirm_all (the app's policy) with October's window oracle reviewer, open loop."""
    import run_ami_review  # noqa: F401  (sets run_eval.OracleReviewer to the window reviewer)
    run = run_eval.run_pipeline(chain, _Replayed(results), "confirm_all")
    proposed = [d for r in run["results"] for d in r.dispositions if d.status == "proposed"]
    reviews = Counter(d.review for d in proposed)
    answers = [values_equal(ledger_answer(run["pipeline"].ledger, q, chain.now), q.gold) for q in chain.questions]
    return {"proposals": len(proposed), "accepted": reviews.get("accepted", 0), "edited": reviews.get("accepted_edited", 0),
            "rejected": reviews.get("rejected", 0), "qa_after_review": answers}


def value_checks(chain, pipe, gold, results):
    """Each write that reached the ledger, against the gold value in force once its meeting's decisions are taken.
    'wrong' in the protocol's sense = earlier_value + other_value + no_gold_value_yet."""
    out = Counter()
    for gm, res in zip(chain.meetings, results):
        for d in res.dispositions:
            if d.status not in ("applied", "proposed"):
                continue
            truth = gold.ledger.as_of(d.object_id, d.attribute, valid_at=gm.meeting.occurred_at + 86_400_000_000 - 1)
            before = gold.ledger.as_of(d.object_id, d.attribute, valid_at=gm.meeting.occurred_at - 1)
            if truth is None:
                out["no_gold_value_yet"] += 1
            elif values_equal(truth.value, d.value):
                out["agrees"] += 1
            elif before is not None and values_equal(before.value, d.value):
                out["earlier_value"] += 1
            else:
                out["other_value"] += 1
            out["changes_belief"] += bool(d.changes_belief)
    out["wrong"] = out["earlier_value"] + out["other_value"] + out["no_gold_value_yet"]
    return dict(out)


def score_chain(chain, run, routes=None):
    gold = gold_pipeline(chain)
    pipe, results = run["pipeline"], run["results"]
    meetings = [metrics.score_meeting(gm, res, chain.registry) for gm, res in zip(chain.meetings, results)]
    exact = [values_equal(ledger_answer(pipe.ledger, q, chain.now), q.gold) for q in chain.questions]
    routed = None
    if routes is not None:
        from memoria_engine.evaluation import router as routing
        routed = [values_equal(routing.routed_answer(pipe.ledger, routes[q.qid], chain.now), q.gold) for q in chain.questions]
    return {"series": chain.chain_id, "meetings": meetings, "qa_exact": exact, "qa_routed": routed,
            "types": [q.type for q in chain.questions], "qids": [q.qid for q in chain.questions],
            "values": value_checks(chain, pipe, gold, results), "inbox": inbox(chain, results),
            "ledger": metrics.ledger_scores(pipe, gold, chain), "calls": run.get("calls", [])}
