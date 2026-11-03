"""Per-question and gold-event changes from a completed immutable screen snapshot; no model."""
import json
import sys

from common import HERE, harness, load_dev, offline_lm, write_json
from memoria_engine.evaluation.oracle import ledger_answer, values_equal


def main():
    report_path = HERE / sys.argv[1]
    report = json.loads(report_path.read_text())
    snapshot = HERE / next(v["cache_snapshot"] for v in report.values())
    rows = [json.loads(line) for line in snapshot.read_text().splitlines()]
    result = {}
    for condition in sorted(report):
        replacements = {r["original_key"]: r for r in rows if r["condition"] == condition}
        changes, gold_changes, wrong_quotes = [], [], []
        for chain in load_dev():
            base = harness.run_chain(chain, offline_lm(), "app")
            records = {m: [replacements.get(r["key"], r) for r in rs] for m, rs in base["records"].items()}
            after = harness.run_chain(chain, harness._Recorded(records), "app")
            for q in chain.questions:
                before_value = ledger_answer(base["pipeline"].ledger, q, chain.now)
                after_value = ledger_answer(after["pipeline"].ledger, q, chain.now)
                if not values_equal(before_value, after_value):
                    changes.append({"series": chain.chain_id, "qid": q.qid, "type": q.type, "slot": q.object_id,
                                    "gold": q.gold, "before": before_value, "after": after_value,
                                    "before_correct": values_equal(before_value, q.gold), "after_correct": values_equal(after_value, q.gold)})
            bs, cs = harness.score_chain(chain, base), harness.score_chain(chain, after)
            old_gold = {t["event"] for m in bs["meetings"] for t in m["tp"]}
            new_gold = {t["event"] for m in cs["meetings"] for t in m["tp"]}
            gold_changes.append({"series": chain.chain_id, "gained": sorted(new_gold-old_gold), "lost": sorted(old_gold-new_gold)})
            truth = harness.gold_pipeline(chain)
            old_writes = {(r.meeting_id, d.turn, d.object_id, str(d.value)) for r in base["results"] for d in r.dispositions if d.status == "applied"}
            for gm, res in zip(chain.meetings, after["results"]):
                for d in res.dispositions:
                    if d.status != "applied" or (res.meeting_id, d.turn, d.object_id, str(d.value)) in old_writes:
                        continue
                    value = truth.ledger.as_of(d.object_id, d.attribute, valid_at=gm.meeting.occurred_at+86_400_000_000-1)
                    if value is None or not values_equal(value.value, d.value):
                        wrong_quotes.append({"meeting": res.meeting_id, "turn": d.turn, "slot": d.object_id, "value": d.value,
                                             "gold_in_force": value.value if value else None, "quote": d.candidate.quote})
        result[condition] = {"question_changes": changes, "gold_event_changes": gold_changes, "new_wrong_writes": wrong_quotes}
    write_json(HERE / f"results/audit-{report_path.stem}.json", result)
    print(json.dumps({c: {"correctness_flips": [q for q in v["question_changes"] if q["before_correct"] != q["after_correct"]],
                          "new_wrong_writes": v["new_wrong_writes"]} for c, v in result.items()}, indent=2))


if __name__ == "__main__":
    main()
