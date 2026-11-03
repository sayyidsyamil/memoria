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


def cut_at_repeat(text):
    """The reply up to the first event object that repeats an earlier one exactly: what a worker that stops generating
    there would have returned (greedy decoding writes the same prefix). None when nothing repeats."""
    import re
    seen = set()
    for match in re.finditer(r"\{[^{}]*\"quote\"[^{}]*\}", text):
        body = re.sub(r"\s+", " ", match.group(0))
        if body in seen:
            return text[:match.start()]
        seen.add(body)
    return None


class AppExtractor:
    """temporal_service.SharedExtractor with the worker call made through lm.LM (cached)."""
    name = "workspace-qwen"

    def __init__(self, lm, budget=1800, prompt=build_prompt, system=None, post=None, repair=True, loopstop=False):
        from lm import APP_SYSTEM
        self.lm, self.budget, self.prompt, self.repair, self.loopstop = lm, budget, prompt, repair, loopstop
        self.system = APP_SYSTEM if system is None else system
        self.post = post
        self.last_stats, self.calls, self.records = {}, [], {}

    def extract(self, ctx):
        from temporal_service import repaired
        record = self.lm.app_generate(self.prompt(ctx), self.budget, self.system, tag=ctx.meeting.meeting_id)
        self.records.setdefault(ctx.meeting.meeting_id, []).append(record)
        text, seconds, output_tokens = record["text"], record["seconds"], record["output_tokens"]
        cut = cut_at_repeat(text) if self.loopstop else None
        if cut is not None and record.get("generation_tps") and record.get("prompt_tps"):
            output_tokens = round(record["output_tokens"] * len(cut) / max(1, len(text)))
            seconds = round(record["prompt_tokens"] / record["prompt_tps"] + output_tokens / record["generation_tps"], 3)
            text = cut
        candidates, clean = parse_events(text)
        repair = (repaired if self.repair is True else self.repair) if self.repair else None
        fixed = [f for c in candidates if (f := repair(c, ctx.registry) if repair else c) is not None]
        if self.post is not None:
            fixed = self.post(ctx, fixed, record)
        self.calls.append({"meeting": ctx.meeting.meeting_id, "turns": [ctx.meeting.turns[0].index, ctx.meeting.turns[-1].index],
                           "seconds": seconds, "prompt_tokens": record["prompt_tokens"], "output_tokens": output_tokens,
                           "hit_budget": record["hit_budget"] and cut is None, "parsed_cleanly": clean, "candidates": len(candidates),
                           "duplicates": duplicate_events(text), "peak_gb": record.get("peak_gb"), "cut": cut is not None})
        self.last_stats = {"prompt_tokens": record["prompt_tokens"], "output_tokens": output_tokens,
                           "llm_seconds": seconds, "parsed_cleanly": clean, "raw": text}
        return fixed


MECHANISMS = {"app": dict(),
              # the worker stops a reply at its first repeated event (simulated on the cached reply: same greedy prefix)
              "app-loopstop": dict(loopstop=True),
              # amounts stated in words in the quote are kept instead of dropped (numwords.repaired)
              "app-numwords": dict(repair="numwords"),
              # October's request (no system message, 900 tokens, no repairs): only for checking the harness
              "october": dict(budget=900, system="", repair=False),
              "october-numwords": dict(budget=900, system="", repair="numwords"),
              # the app's request without its JSON system message (the evaluated October request, with the app's budget)
              "app-nosys": dict(system=""),
              "app-nosys-numwords": dict(system="", repair="numwords")}


def make_extractor(lm, mechanism="app"):
    spec = dict(MECHANISMS[mechanism])
    if spec.get("repair") == "numwords":
        import numwords
        spec["repair"] = numwords.repaired
    inner = AppExtractor(lm, **{k: v for k, v in spec.items() if k in ("budget", "prompt", "system", "post", "repair", "loopstop")})
    outer = spec.get("outer")
    return (outer(inner) if outer else WindowedExtractor(inner)), inner


def run_chain(chain, lm, mechanism="app"):
    """mechanism: a name in MECHANISMS, then optionally
    "+filter" (closed loop: applied to each meeting's candidates before they are written, so later prompts show the
    filtered beliefs) and "|filter" (open loop: the finished run's candidates of each meeting, minus those the filter
    drops, go to a fresh pipeline; the prompts stay those of the run), e.g. "app+lastvalue" or "app|support>=0".
    "app>app-numwords": the app's replies, read the way app-numwords reads them, open loop."""
    head, *filters = mechanism.split("|")
    head, *gates = head.split("+")
    reader_lm = lm
    if ">" in head:
        source, reader = head.split(">")
        recorded = run_chain(chain, lm, source)
        reader_lm = _Recorded(recorded["records"])
        head = reader
    windowed, inner = make_extractor(reader_lm, head)
    extractor = _Gated(windowed, gates, chain, lm) if gates else windowed
    run = run_eval.run_pipeline(chain, extractor, "immediate")
    run["calls"], run["records"] = inner.calls, inner.records
    for name in filters:
        run = {**replay_filtered(chain, run["results"], make_filter(name, chain, run, lm)), "calls": run["calls"],
               "records": run["records"]}
    return run


class _Recorded:
    """Gives back another run's replies in order, per meeting, whatever the prompt (open-loop re-reading)."""

    def __init__(self, records):
        self.records, self.used = records, {}

    def app_generate(self, prompt, max_tokens=1800, system=None, tag=None):
        i = self.used.get(tag, 0)
        self.used[tag] = i + 1
        return self.records[tag][i]

    def score(self, *args, **kwargs):
        raise SystemExit("scores are not replayed by _Recorded")


class _Gated:
    """Closed loop: filters applied to a meeting's candidates inside the pipeline, before they are written."""

    def __init__(self, inner, names, chain, lm):
        self.inner, self.names, self.chain, self.lm = inner, names, chain, lm
        self.name = getattr(inner, "name", "gated")
        self.last_stats = {}

    def extract(self, ctx):
        candidates = self.inner.extract(ctx)
        self.last_stats = getattr(self.inner, "last_stats", {})
        for name in self.names:
            kept = meeting_keep(name, self.chain, ctx.meeting, candidates, ctx.beliefs, self.lm)
            candidates = [c for c in candidates if id(c) in kept]
        return candidates


def make_filter(name, chain, run, lm):
    """Open loop: keep(meeting, candidate) for the finished run's candidates, each meeting judged with the beliefs its
    prompt showed."""
    kept = set()
    for gm, res in zip(chain.meetings, run["results"]):
        beliefs = run["pipeline"].beliefs_at(gm.meeting.occurred_at)
        kept |= meeting_keep(name, chain, gm.meeting, [d.candidate for d in res.dispositions], beliefs, lm)
    return lambda meeting, candidate: id(candidate) in kept


CONSOLIDATION_LOG = []


def meeting_keep(name, chain, meeting, candidates, beliefs, lm):
    """ids of the candidates of one meeting that the filter keeps. Candidates the pipeline would not write are kept
    (it drops or rejects them itself)."""
    import support
    valid = [(c, support.valid(meeting, chain.registry, c)) for c in candidates]
    if name.startswith("support>="):
        tau = float(name.split(">=")[1])
        return {id(c) for c, v in valid if v.status != "valid" or support.score(meeting, chain.registry, v, lm) >= tau}
    if name == "lexsupport":
        return {id(c) for c, v in valid if v.status != "valid" or lexical_support(chain, meeting, c)}
    if name == "lastvalue":
        last = {}
        for c, v in valid:
            if v.status == "valid" and ((v.object_id, v.attribute) not in last or v.turn >= last[(v.object_id, v.attribute)][0]):
                last[(v.object_id, v.attribute)] = (v.turn, v.value)
        return {id(c) for c, v in valid if v.status != "valid" or values_equal(v.value, last[(v.object_id, v.attribute)][1])}
    if name in ("consolidate", "consolidate-think"):
        import consolidate
        kept, log = consolidate.consolidate_meeting(chain, meeting, valid, beliefs, lm, think=name.endswith("think"))
        CONSOLIDATION_LOG.extend(log)
        return kept
    raise SystemExit(f"unknown filter {name}")


def _words(text):
    import re
    text = re.sub(r"(?<=[A-Za-z])_\s*(?=[A-Za-z]_)", "", text)  # AMI spells letters out: "L_ C_ D_" -> "LCD_"
    text = text.replace("_", "")
    stop = {"the", "a", "an", "of", "to", "and", "is", "are", "for", "with", "what", "which", "whether", "remote", "it", "in", "on", "type",
            "we", "so", "be", "do", "go", "uh", "um", "or", "if", "as", "at", "by", "my", "me", "no", "up", "us", "oh", "ok", "he", "mm", "hm"}
    return {w for w in re.findall(r"[a-z]+", text.casefold()) if w not in stop and len(w) > 1}


def lexical_support(chain, meeting, candidate):
    """Control for the support check: keep a write when its turn or the one before names a word of the item or the value."""
    from memoria_engine.pipeline import ground
    located = ground(meeting, candidate.quote, candidate.turn)
    if located is None or candidate.object_id not in chain.registry.objects:
        return True  # the pipeline drops or rejects it anyway
    spec = chain.registry.objects[candidate.object_id]
    wanted = _words(f"{spec.label} {spec.object_id.replace('_', ' ')} {candidate.value}")
    turn = located[0]
    seen = _words(" ".join(t.text for t in meeting.turns[max(0, turn - 1): turn + 1]))
    return bool(wanted & seen)


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
