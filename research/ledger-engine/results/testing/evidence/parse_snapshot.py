"""Run parse_events over every model reply recorded in results/cache/*memoria*.jsonl, results/cache/ami_*.jsonl (read only)
and results/{dev,test}_v2.json, and save (candidates, parsed_cleanly) per reply. Run once per engine version, then compare:

    python3.11 results/testing/evidence/parse_snapshot.py OUTPUT.json
    python3.11 results/testing/evidence/compare_parse.py BEFORE.json AFTER.json
"""
import json, sys, glob
sys.path.insert(0, ".")
from memoria_engine.extractors import parse_events
out = {}
texts = []
for f in sorted(glob.glob("results/cache/*memoria*.jsonl")) + sorted(glob.glob("results/cache/ami_*.jsonl")):
    for line in open(f, encoding="utf-8"):
        if line.strip():
            r = json.loads(line)
            texts.append((f, r["key"], r["text"]))
for f in ("results/dev_v2.json", "results/test_v2.json"):
    d = json.load(open(f))
    for pol, body in d["pipeline"].items():
        for a in body["audit"]:
            texts.append((f, f"{pol}/{a['chain']}/{a['meeting']}", a["stats"]["raw"]))
for f, k, t in texts:
    try:
        cands, clean = parse_events(t)
        out[f"{f}#{k}"] = [[(c.object_id, c.attribute, c.value, c.quote, c.turn, c.valid_from, c.confidence, c.unresolved) for c in cands], clean]
    except BaseException as e:
        out[f"{f}#{k}"] = ["RAISED", type(e).__name__]
json.dump(out, open(sys.argv[1], "w"), sort_keys=True, default=str)
print("records:", len(out), "raised:", sum(1 for v in out.values() if v[0] == "RAISED"), "unclean:", sum(1 for v in out.values() if v[0] != "RAISED" and v[1] is False))
