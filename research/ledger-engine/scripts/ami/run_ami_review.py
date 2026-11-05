"""Same as run_ami.py --part memoria, but belief-changing conflicts go to a reviewer (policy confirm_conflicts) instead of being applied at once.

The reviewer is an oracle: it accepts a proposal only if it matches a gold event (same turn window the scoring uses), fixes a nearly
right one and rejects everything else, i.e. a perfectly careful human. The result is an UPPER BOUND on what the review inbox can add,
not a measurement of real reviewers.

    python3.11 scripts/ami/run_ami_review.py --split test --part memoria --cache results/cache/ami_test_memoria_review.jsonl --out results/ami/memoria_test_review.json
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))

import run_ami  # noqa: E402
from memoria_engine.evaluation import run_eval  # noqa: E402
from memoria_engine.evaluation.metrics import _near  # noqa: E402
from memoria_engine.evaluation.oracle import OracleReviewer, values_equal  # noqa: E402
from memoria_engine.extractors import OracleExtractor  # noqa: E402
from memoria_engine.ledger import ts  # noqa: E402


class WindowOracleReviewer(OracleReviewer):
    """The oracle reviewer with the same turn tolerance as the extraction scoring (windows from the human summary links)."""

    def review(self, pipeline, meeting, d):
        near = [g for g in self.events[meeting.meeting_id] if g.object_id == d.object_id and g.attribute == d.attribute and _near(d.turn, g)]
        exact = next((g for g in near if values_equal(g.value, d.value) and (g.valid_from is None or g.valid_from == d.valid_from)), None)
        target = exact or (near[0] if near else None)
        if target is None:
            pipeline.ledger.reject(d.proposal_id, self.name, note="no supporting decision in the transcript")
            d.review = "rejected"
            return
        edits = {}
        if exact is None:
            edits["value"] = target.value
            if target.valid_from:
                edits["valid_from"] = ts(f"{target.valid_from}T00:00:00Z")
        out = pipeline.ledger.accept(d.proposal_id, self.name, edits=edits)
        d.review = "accepted_edited" if exact is None else "accepted"
        d.fact_id, d.outcome = out.fact_id, out.status


run_eval.OracleReviewer = WindowOracleReviewer
_original = run_ami.run_pipeline


def run_pipeline_with_review(chain, extractor, policy_name):
    if isinstance(extractor, OracleExtractor):
        return _original(chain, extractor, policy_name)
    return _original(chain, extractor, "confirm_conflicts")


run_ami.run_pipeline = run_pipeline_with_review

if __name__ == "__main__":
    run_ami.main()
