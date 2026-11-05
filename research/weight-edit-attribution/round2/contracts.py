"""Round-2 evidence-first procedure through the real chronology engine contracts."""
import importlib.util
import json
import resource
import signal
import time

from r2_common import HERE, R1, harness, sha, verify_round1, write_json
from experiment import Runtime, preflight, timeout
from generation import request
from memoria_engine.pipeline import Candidate, Pipeline, make_policy


def main():
    verify_round1()
    path = R1 / "data/chronology-fixtures.py"
    spec = importlib.util.spec_from_file_location("r2_chronology_source", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    fixtures = [("two_changes", mod.PRIOR_BUDGET, mod.TwoRealChangesInOneMeeting, ("budget", "amount")),
                ("recaps_then_switch", mod.PRIOR_VENDOR, mod.RecapsThenOneFinalDecision, ("vendor", "outcome")),
                ("unchanged_recaps", mod.PRIOR_VENDOR, mod.RepeatedUnchangedValue, ("vendor", "outcome"))]
    check = preflight()
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(450)
    rt = Runtime()
    rows = []
    try:
        for condition in ("base", "subject-first"):
            for name, prior, fixture, slot in fixtures:
                records = []

                class FixtureLM:
                    def app_generate(self, prompt, max_tokens=1800, system=None, tag=None):
                        row = request(rt, prompt, system, condition, name)
                        records.append(row)
                        return row

                inner = harness.AppExtractor(FixtureLM())

                class Extractor:
                    name, last_stats = "round2-contract", {}

                    def extract(self, ctx):
                        if ctx.meeting.meeting_id == "m0":
                            return [Candidate(*x) for x in fixture.candidates["m0"]]
                        return inner.extract(ctx)

                pipe = Pipeline(mod.REGISTRY, Extractor(), make_policy("immediate"))
                pipe.ingest(prior)
                pipe.ingest(fixture.m1)
                actual = mod.outcome(pipe, slot)
                passed = all(actual[k] == v for k, v in fixture.expected.items())
                times = []
                if name == "two_changes":
                    for seconds, wanted in ((500, 280000), (2000, 300000)):
                        belief = pipe.ledger.as_of(*slot, valid_at=fixture.m1.occurred_at + seconds*1_000_000)
                        got = belief.value if belief else None
                        times.append({"seconds": seconds, "expected": wanted, "actual": got})
                        passed = passed and got == wanted
                rows.append({"condition": condition, "fixture": name, "expected": fixture.expected,
                             "actual": actual, "claim_times": times, "passed": passed, "records": records})
                print(json.dumps({k: rows[-1][k] for k in ("condition", "fixture", "passed", "actual")}), flush=True)
        write_json(HERE / "results/contracts.json", {"source_sha256": sha(path.read_bytes()), "preflight": check,
                                                    "rows": rows, "peak_process_rss_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e9})
    finally:
        rt.close()
        signal.alarm(0)
        print(json.dumps({"closed": True, "seconds": time.perf_counter()-rt.started}), flush=True)


if __name__ == "__main__":
    main()
