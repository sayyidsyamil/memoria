"""Snapshot allowed cache records and reconstruct complete app prompts without weights."""
import json
import subprocess
from collections import defaultdict

from context import ALLOWED, COORD, HERE, ROOT, load_chain, sha256, write_new_json
import harness
from lm import LM
from memoria_engine.extractors import parse_events
from stop_rule import analyse


def main():
    data = HERE / "data"
    data.mkdir(parents=True, exist_ok=True)
    source = COORD / "cache" / "4b.jsonl"
    raw = source.read_bytes()
    # Filter by permitted extraction tag before decoding any row's payload.
    permitted = [line for line in raw.splitlines()
                 if any(('"tag": "' + name).encode() in line for name in ALLOWED)]
    snapshot = data / "reference_cache.jsonl"
    with snapshot.open("xb") as out:
        out.write(b"\n".join(permitted) + b"\n")

    class Capture(LM):
        def __init__(self):
            super().__init__("4b", snapshot, offline=True)
            self.rows = []
            self.indices = defaultdict(int)

        def app_generate(self, prompt, max_tokens=1800, system=None, tag=None):
            record = super().app_generate(prompt, max_tokens, system, tag)
            assert record["prompt_sha256"] == sha256(prompt)
            i = self.indices[tag]
            self.indices[tag] += 1
            self.rows.append({"id": f"{tag}.w{i}", "series": tag[:-1], "meeting": tag,
                              "window": i, "prompt": prompt, "prompt_sha256": sha256(prompt),
                              "max_tokens": max_tokens, "system": system, "reference": record})
            return record

    capture = Capture()
    scores = []
    for name in ALLOWED:
        chain = load_chain(name)
        run = harness.run_chain(chain, capture, "app")
        scores.append(harness.score_chain(chain, run))
        for row, call in zip([r for r in capture.rows if r["series"] == name], run["calls"]):
            row["turns"] = call["turns"]
    assert len(capture.rows) == 97 and capture.misses == 0
    with (data / "dev_prompts.jsonl").open("x") as out:
        for row in capture.rows:
            out.write(json.dumps(row, ensure_ascii=False) + "\n")

    capped = [r for r in capture.rows if r["reference"]["hit_budget"]]
    assert len(capped) == 3
    selected, used = [], set()
    for i, row in enumerate(capped):
        kind = "loop" if analyse(row["reference"]["text"]).reason else "enumeration_cap"
        selected.append({"id": row["id"], "role": ("derive_" if i == 0 else "independent_") + kind})
        used.add(row["id"])
    for i, target in enumerate(capped):
        options = [r for r in capture.rows if r["series"] == target["series"] and r["id"] not in used
                   and not r["reference"]["hit_budget"] and all(parse_events(r["reference"]["text"]))
                   and not analyse(r["reference"]["text"]).reason]
        matched = min(options, key=lambda r: (abs(r["reference"]["prompt_tokens"] - target["reference"]["prompt_tokens"]), r["id"]))
        selected.append({"id": matched["id"], "role": "derive_normal" if i == 0 else "independent_normal",
                         "matched_to": target["id"]})
        used.add(matched["id"])
    for name in ("ES2003", "ES2011", "IS1008"):
        options = [r for r in capture.rows if r["series"] == name and not r["reference"]["hit_budget"]
                   and all(parse_events(r["reference"]["text"])) and not analyse(r["reference"]["text"]).reason]
        chosen = max(options, key=lambda r: (r["reference"]["output_tokens"], r["id"]))
        selected.append({"id": chosen["id"], "role": "independent_normal"})

    for spec in selected:
        row = next(r for r in capture.rows if r["id"] == spec["id"])
        spec.update(prompt_sha256=row["prompt_sha256"], reference_tokens=row["reference"]["output_tokens"],
                    turns=row["turns"])
    manifest = {"source_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "source_cache": str(source.relative_to(ROOT)), "source_sha256": sha256(raw),
                "snapshot_sha256": sha256(snapshot.read_bytes()), "allowed_series": ALLOWED,
                "dev_prompt_bundle_sha256": sha256((data / "dev_prompts.jsonl").read_bytes()),
                "dev_count": len(capture.rows), "prompts": selected,
                "source_files": {str(p.relative_to(ROOT)): sha256(p.read_bytes()) for p in
                                 [COORD / f for f in ("harness.py", "lm.py", "score.py", "run.py")]}}
    write_new_json(data / "diagnostics.json", manifest)
    from score import summarise
    write_new_json(data / "reference_scores.json", summarise(scores))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
