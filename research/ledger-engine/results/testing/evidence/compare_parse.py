"""Compare two parse_snapshot.py outputs (before and after the fixes), run from the engine directory:

    python3.11 results/testing/evidence/compare_parse.py BEFORE.json AFTER.json

The result caches also hold replies of other prompts (the question router and the baselines) that are not event lists.
Only the extraction replies (prompt starting "You maintain a decision and commitment ledger") and the raw replies kept in
results/{dev,test}_v2.json are extractions; the rest is reported separately.
"""
import glob
import json
import sys
from collections import Counter

before, after = (json.load(open(p)) for p in sys.argv[1:3])
is_extraction = {}
for path in glob.glob("results/cache/*.jsonl"):
    for line in open(path, encoding="utf-8"):
        if line.strip():
            row = json.loads(line)
            is_extraction[f"{path}#{row['key']}"] = row["prompt_head"].startswith("You maintain a decision and commitment ledger")
for key in before:
    if key.startswith("results/dev_v2.json#") or key.startswith("results/test_v2.json#"):
        is_extraction[key] = True

shared = sorted(set(before) & set(after))
extraction = [k for k in shared if is_extraction.get(k)]
other = [k for k in shared if not is_extraction.get(k)]
changed = [k for k in extraction if before[k] != after[k]]
print(f"recorded replies compared: {len(shared)} ({len(before)} before, {len(after)} after)")
print(f"  extraction replies: {len(extraction)}  identical candidates and clean flag: {len(extraction) - len(changed)}  different: {len(changed)}")
print(f"  raised before: {sum(1 for k in shared if before[k][0] == 'RAISED')}  raised after: {sum(1 for k in shared if after[k][0] == 'RAISED')}")
moved = Counter()
for k in other:
    if before[k] != after[k]:
        same_candidates = before[k][0] == after[k][0]
        moved[f"candidates {'unchanged' if same_candidates else 'changed'}, clean flag {before[k][1]} -> {after[k][1]}"] += 1
print(f"  other replies (router, baselines; not event lists): {len(other)}, changed: {sum(moved.values())}")
for what, n in sorted(moved.items()):
    print(f"    {n} x {what}")
