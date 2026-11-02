"""Replay the raw model replies stored in results/{dev,test}_v2.json through the pipeline under each review policy and
check the dispositions against the recorded ones. No model is used.

Run from the engine directory on each engine version (original, patched copy) and compare the two output files:

    python3.11 results/testing/evidence/replay_policies.py OUTPUT.json
"""
import json, sys
sys.path.insert(0, ".")
from memoria_engine.extractors import parse_events
from memoria_engine.evaluation.dataset import load_chains
from memoria_engine.evaluation.oracle import OracleReviewer, ledger_answer
from memoria_engine.pipeline import Pipeline, make_policy

class Recorded:
    name = "recorded"
    def __init__(self, raw_by_meeting): self.raw = raw_by_meeting
    def extract(self, ctx):
        cands, _clean = parse_events(self.raw[ctx.meeting.meeting_id])
        return cands

def snapshot(path):
    rec = json.load(open(path))
    chains = {c.chain_id: c for c in load_chains("data/pilot_v0", "ask")}
    out, mismatches = {}, []
    for policy_name, body in rec["pipeline"].items():
        audit = body["audit"]
        for chain_id in sorted({a["chain"] for a in audit}):
            chain = chains[chain_id]
            raw = {a["meeting"]: a["stats"]["raw"] for a in audit if a["chain"] == chain_id}
            policy = make_policy(policy_name)
            pipe = Pipeline(chain.registry, Recorded(raw), policy, OracleReviewer(chain) if policy.kind != "immediate" else None)
            for gm in chain.meetings:
                res = pipe.ingest(gm.meeting)
                got = [{"status": d.status, "reason": d.reason, "turn": d.turn, "object": d.object_id, "attribute": d.attribute, "value": d.value,
                        "review": d.review, "outcome": d.outcome, "conflict": d.conflict, "quote": d.candidate.quote, "confidence": d.candidate.confidence}
                       for d in res.dispositions]
                want = next(a for a in audit if a["chain"] == chain_id and a["meeting"] == gm.meeting.meeting_id)["dispositions"]
                if json.loads(json.dumps(got)) != json.loads(json.dumps(want)):
                    mismatches.append((policy_name, chain_id, gm.meeting.meeting_id))
                out[f"{policy_name}/{chain_id}/{gm.meeting.meeting_id}"] = got
            assert pipe.ledger.check_invariants() == []
            out[f"{policy_name}/{chain_id}/LEDGER"] = json.loads(json.dumps(pipe.ledger.dump(), default=str))
            out[f"{policy_name}/{chain_id}/ANSWERS"] = [json.loads(json.dumps(ledger_answer(pipe.ledger, q, chain.now), default=str)) for q in chain.questions]
    return out, mismatches

if __name__ == "__main__":
    res = {}
    for f in ("results/dev_v2.json", "results/test_v2.json"):
        snap, mism = snapshot(f)
        res[f] = snap
        print(f, "entries:", len(snap), "| differing from the recorded dispositions:", mism)
    json.dump(res, open(sys.argv[1], "w"), indent=1, sort_keys=True, default=str)
    print("written", sys.argv[1])
