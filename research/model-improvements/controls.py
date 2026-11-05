"""Random-thinning controls for filters (no model): does a filter beat removing the same number of writes at random?

    python3.11 controls.py <variant> <base mechanism> <filter> <split[,split]> [--draws 500]

For each meeting, k = the number of valid candidates the filter removes; each draw removes k valid candidates of that
meeting chosen at random (seeded), replays the meeting's remaining candidates through a fresh pipeline (open loop), and
scores QA with exact routes and gold events kept. Reports the filter, the draws' mean, 5th/90th/95th percentiles and
the share of draws at least as good as the filter (the PROTOCOL's rule: QA at or above the draws' 90th percentile,
and more gold events kept than the draws on average).
"""
import json
import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402
import support  # noqa: E402
from lm import LM  # noqa: E402

HERE = Path(__file__).resolve().parent


def lm_for(variant):
    if variant == "october":
        from check_harness import OCTOBER, OctoberReplies
        return OctoberReplies(OCTOBER / "cache" / "ami_dev_memoria.jsonl")
    return LM(variant, HERE / "cache" / f"{variant}.jsonl", offline=True)


def outcome(chain, run):
    s = harness.score_chain(chain, run)
    return sum(s["qa_exact"]), sum(len(m["tp"]) for m in s["meetings"]), s["values"].get("wrong", 0)


def controls(variant, base, filt, splits, draws=500, seed=0):
    if any(s not in ("old-dev", "new-dev") for s in splits.split(",")):
        raise SystemExit("controls are computed on development splits only")
    lm = lm_for(variant)
    chains = harness.load_series(harness.series_of(splits))
    bases, filtered, removable = {}, [0, 0, 0], {}
    for chain in chains:
        run = harness.run_chain(chain, lm, base)
        bases[chain.chain_id] = run
        keep = harness.make_filter(filt, chain, run, lm)
        after = harness.replay_filtered(chain, run["results"], keep)
        for i, x in enumerate(outcome(chain, after)):
            filtered[i] += x
        removable[chain.chain_id] = []
        for gm, res in zip(chain.meetings, run["results"]):
            valid = [d.candidate for d in res.dispositions if support.valid(gm.meeting, chain.registry, d.candidate).status == "valid"]
            k = sum(1 for c in valid if not keep(gm.meeting, c))
            removable[chain.chain_id].append((gm.meeting.meeting_id, valid, k))
    rnd = random.Random(seed)
    samples = []
    for _ in range(draws):
        total = [0, 0, 0]
        for chain in chains:
            dropped = set()
            for meeting_id, valid, k in removable[chain.chain_id]:
                dropped |= {id(c) for c in rnd.sample(valid, k)}
            after = harness.replay_filtered(chain, bases[chain.chain_id]["results"], lambda m, c: id(c) not in dropped)
            for i, x in enumerate(outcome(chain, after)):
                total[i] += x
        samples.append(total)
    qa = sorted(s[0] for s in samples)
    pct = lambda p: qa[min(len(qa) - 1, int(p / 100 * len(qa)))]
    base_out = [0, 0, 0]
    for chain in chains:
        for i, x in enumerate(outcome(chain, bases[chain.chain_id])):
            base_out[i] += x
    result = {"variant": variant, "base": base, "filter": filt, "splits": splits, "draws": draws, "seed": seed,
              "removed": sum(k for rows in removable.values() for _, _, k in rows),
              "base_qa_tp_wrong": base_out, "filter_qa_tp_wrong": filtered,
              "random_qa_mean": round(sum(qa) / len(qa), 2), "random_qa_p5_p90_p95": [pct(5), pct(90), pct(95)],
              "random_tp_mean": round(sum(s[1] for s in samples) / len(samples), 2),
              "random_wrong_mean": round(sum(s[2] for s in samples) / len(samples), 2),
              "share_random_at_least_filter_qa": round(sum(q >= filtered[0] for q in qa) / len(qa), 3)}
    result["passes"] = filtered[0] >= pct(90) and filtered[1] > result["random_tp_mean"]
    return result


if __name__ == "__main__":
    args = sys.argv[1:]
    draws = 500
    if "--draws" in args:
        at = args.index("--draws")
        draws = int(args[at + 1])
        del args[at:at + 2]
    result = controls(*args[:4], draws=draws)
    print(json.dumps(result, indent=1))
    out = HERE / "results" / "controls.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a") as handle:
        handle.write(json.dumps(result) + "\n")
