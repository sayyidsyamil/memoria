"""Read existing support/lexical filters on the independently labelled cases; no model."""
import json

from common import HERE, harness, load_dev, offline_lm, write_json
from experiment import summarize
from memoria_engine.pipeline import Candidate
import support


def main():
    lm = offline_lm()
    cases = json.loads((HERE / "data/cases.json").read_text())
    chains = {c.chain_id: c for c in load_dev()}
    rows = []
    for case in cases:
        chain = chains[case["series"]]
        meeting = next(m.meeting for m in chain.meetings if m.meeting.meeting_id == case["meeting"])
        candidate = Candidate(**case["candidate"])
        valid = support.valid(meeting, chain.registry, candidate)
        margin = support.score(meeting, chain.registry, valid, lm)
        rows.append({"id": case["id"], "margin": margin, "seconds": 0,
                     "lexical_support": harness.lexical_support(chain, meeting, candidate),
                     "source_grounded": valid.status == "valid", "gold_value_agrees": case["value_class"] == "agrees"})
    lex = [{**r, "margin": 1 if r["lexical_support"] else -1} for r in rows]
    source = [{**r, "margin": 1 if r["source_grounded"] else -1} for r in rows]
    result = {"rows": rows, "summary": {"existing_support_tau0": summarize(rows, cases),
                                         "lexical_support": summarize(lex, cases), "verbatim_grounding_only": summarize(source, cases)}}
    write_json(HERE / "results/source-controls.json", result)
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    main()
