"""Freeze a live cache before replay; reconstruct full prompts and source evidence without loading weights."""
import dataclasses
import json
import os
import time

from common import HERE, ROOT, HARNESS, SCRATCH, OLD, NEW, harness, load_dev, sha, write_json
from lm import LM
from score import summarise
from memoria_engine.evaluation.oracle import values_equal


def snapshot():
    target = HERE / "data/cache-dev.jsonl"
    if target.exists():
        return
    source = ROOT.parent / "memoria-wt-models/research/model-improvements/cache/4b.jsonl"
    SCRATCH.mkdir(parents=True, exist_ok=True)
    with source.open("rb") as handle:
        stat = os.fstat(handle.fileno())
        raw = handle.read(stat.st_size)
    raw = raw[:raw.rfind(b"\n") + 1]
    frozen = SCRATCH / "source-cache-frozen.jsonl"
    frozen.write_bytes(raw)
    # Inspect only metadata to select authorized development records. Never use
    # unselected model replies, regardless of what the coordinator later adds.
    selected = []
    for line in raw.splitlines():
        row = json.loads(line)
        tag = row.get("tag") or ""
        if any(tag.startswith(name) or tag.startswith(f"support:{name}") or tag.startswith(f"route:{name}:")
               for name in OLD + NEW):
            selected.append(line)
    data = b"\n".join(selected) + b"\n"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    inputs = {}
    for name in OLD + NEW:
        folder = ROOT / "research/ledger-engine/data/ami_v0" if name in OLD else HARNESS / "data/ami_new"
        for suffix in ("chain", "ask"):
            path = folder / f"{name}.{suffix}"
            inputs[str(path.relative_to(ROOT))] = sha(path.read_bytes())
    for name in ("lm.py", "harness.py", "score.py", "audit.py", "run.py", "support.py"):
        inputs[f"research/model-improvements/{name}"] = sha((HARNESS / name).read_bytes())
    write_json(HERE / "data/snapshot.json", {
        "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "source": str(source), "source_bytes": stat.st_size,
        "source_mtime_ns": stat.st_mtime_ns, "complete_snapshot_sha256": sha(raw),
        "complete_snapshot_path": str(frozen), "dev_cache_sha256": sha(data), "records": len(selected), "inputs": inputs,
    })


class Capture(LM):
    def __init__(self):
        super().__init__("4b", HERE / "data/cache-dev.jsonl", offline=True)
        self.prompts = {}

    def app_generate(self, prompt, max_tokens=1800, system=None, tag=None, **kw):
        record = super().app_generate(prompt, max_tokens, system, tag, **kw)
        self.prompts[record["key"]] = {"key": record["key"], "meeting": tag, "prompt": prompt,
                                        "system": system, "max_tokens": max_tokens,
                                        "prompt_sha256": sha(prompt), "baseline": record}
        return record


def main():
    snapshot()
    all_prompts, summaries, evidence = {}, {}, []
    for mechanism in ("app", "app-nosys-numwords-loopstop+modevalue", "app|lexsupport", "app|support>=0"):
        lm = Capture()
        scores = []
        for chain in load_dev():
            run = harness.run_chain(chain, lm, mechanism)
            scores.append(harness.score_chain(chain, run))
            if mechanism != "app":
                continue
            gold = harness.gold_pipeline(chain)
            for gm, result in zip(chain.meetings, run["results"]):
                for d in result.dispositions:
                    if d.status != "applied":
                        continue
                    truth = gold.ledger.as_of(d.object_id, d.attribute, valid_at=gm.meeting.occurred_at + 86_400_000_000 - 1)
                    label = "agrees" if truth is not None and values_equal(truth.value, d.value) else "wrong"
                    evidence.append({"series": chain.chain_id, "meeting": gm.meeting.meeting_id,
                        "turn": d.turn, "object_id": d.object_id, "attribute": d.attribute, "value": d.value,
                        "candidate": dataclasses.asdict(d.candidate), "gold_value": truth.value if truth else None,
                        "value_class": label, "source": [dataclasses.asdict(t) for t in gm.meeting.turns[max(0, d.turn-4):d.turn+5]],
                        "gold_events": [dataclasses.asdict(g) for g in gm.events if g.object_id == d.object_id]})
        summaries[mechanism] = summarise(scores)
        all_prompts[mechanism] = list(lm.prompts.values())
    write_json(HERE / "data/prompts.json", all_prompts)
    write_json(HERE / "data/evidence.json", evidence)
    write_json(HERE / "results/baselines.json", summaries)
    print(json.dumps({m: {k: s[k] for k in ("qa_exact", "qa_exact_by_type", "tp", "values", "inbox_confirm_all")}
                      for m, s in summaries.items()}, indent=2))


if __name__ == "__main__":
    main()
