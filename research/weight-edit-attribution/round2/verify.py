"""Meaningful no-model checks for source labels, matching and round-1 isolation."""
import ast
import json

from r2_common import HERE, load_dev, sha, verify_round1, write_json
from generation import registry, score_output


def row(events):
    return {"text": json.dumps({"events": events}), "condition": "fixture", "seconds": 0, "output_tokens": 0, "peak_gb": 0}


def main():
    for path in HERE.glob("*.py"):
        ast.parse(path.read_text(), filename=str(path))
    cases = {c["id"]: c for c in json.loads((HERE / "data/cases.json").read_text())}
    freeze = json.loads((HERE / "data/freeze.json").read_text())
    assert sha((HERE / "data/cases.json").read_bytes()) == freeze["case_sha256"]
    chains = {c.chain_id: c for c in load_dev()}
    # Same source/value; the wrong component must fail despite lexical overlap.
    c = cases["p2-1-buttons"]
    good = {"turn": c["turn"], "quote": c["quote"], "object_id": c["other_id"], "attribute": "outcome", "value": "rubber"}
    assert score_output(c, row([good]), registry(c, chains))["success"]
    bad = {**good, "object_id": c["target_id"]}
    assert score_output(c, row([bad]), registry(c, chains))["wrong_writes"] == 1
    # The identical component becomes untracked under the single registry.
    u = cases["p2-0-buttons"]
    assert score_output(u, row([]), registry(u, chains))["success"]
    assert score_output(u, row([{**good, "object_id": None, "unresolved": True}]), registry(u, chains))["success"]
    assert not score_output(u, row([bad]), registry(u, chains))["success"]
    # Abstaining on an adopted, tracked choice cannot be counted as a gain.
    assert not score_output(c, row([]), registry(c, chains))["success"]
    # A true-looking value on a profit quotation gets no source/gold credit.
    p = cases["n3"]
    quote = next(t["text"] for t in p["source"] if t["index"] == 43)
    fake = {"turn": 43, "quote": quote, "object_id": "case_material", "attribute": "outcome", "value": "plastic"}
    assert score_output(p, row([fake]), registry(p, chains))["wrong_writes"] == 1
    # Unrelated supported decisions in the multi-decision anchor are required.
    multi = cases["p1-1-case"]
    partial = {"turn": multi["turn"], "quote": multi["quote"], "object_id": multi["target_id"], "attribute": "outcome", "value": "rubber"}
    scored = score_output(multi, row([partial]), registry(multi, chains))
    assert scored["found"] == 1 and scored["expected"] == 3 and not scored["success"]
    result = {"round1_hashes_match": verify_round1(), "cases_frozen": len(cases),
              "checks": ["syntax", "frozen case hash", "same-value wrong-component rejection", "untracked omission/null acceptance",
                         "no abstention credit on tracked decisions", "no false credit from profit quote", "unrelated decision recall retained in scoring"]}
    write_json(HERE / "results/verification.json", result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
