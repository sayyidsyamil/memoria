import unittest
from pathlib import Path

from memoria_engine.evaluation.dataset import DatasetError, load_chains, parse_chain
from memoria_engine.evaluation.oracle import OracleReviewer, ledger_answer, values_equal
from memoria_engine.extractors import KeywordExtractor, OracleExtractor, parse_events
from memoria_engine.pipeline import Candidate, Pipeline, ground, make_policy

DATA = Path(__file__).resolve().parent.parent / "data" / "pilot_v0"

MINI = """chain: mini
now: 2026-05-01T00:00:00Z
people: chair=Chair, ali=Ali
object: vendor | decision | Which vendor | outcome:enum[Vendor A,Vendor B]!reverse
object: rollout | commitment | Rollout | deadline:date, owner:person, status:enum[done,cancelled]

meeting: m1 | 2026-01-10T09:00:00Z | ingested=2026-01-10T12:00:00Z
chair: We go with Vendor A.  ## event vendor.outcome = Vendor A | INITIAL | quote="We go with Vendor A"
chair: Ali owns it, live by 1 March.  ## event rollout.owner = ali | INITIAL | quote="Ali owns it" ;; event rollout.deadline = 2026-03-01 | INITIAL | quote="live by 1 March"
ali: What if we looked at Vendor B?  ## distractor question

meeting: m2 | 2026-03-20T09:00:00Z | ingested=2026-03-20T12:00:00Z
chair: No, switch to Vendor B. That's decided.  ## event vendor.outcome = Vendor B | REVERSE | quote="switch to Vendor B"

question: q1 | current | vendor.outcome | gold=Vendor B
question: q2 | as_of_tx | vendor.outcome | valid=2026-03-25 | tx=2026-03-01T00:00:00Z | gold=Vendor A
question: q3 | n_changes | vendor.outcome | gold=1
"""


class FixedExtractor:
    name = "fixed"

    def __init__(self, by_meeting):
        self.by_meeting = by_meeting

    def extract(self, ctx):
        return self.by_meeting.get(ctx.meeting.meeting_id, [])


class TestDatasetParser(unittest.TestCase):
    def test_parses_and_orders_by_ingestion(self):
        chain = parse_chain(MINI)
        self.assertEqual([m.meeting.meeting_id for m in chain.meetings], ["m1", "m2"])
        self.assertEqual(len(chain.events), 4)
        self.assertEqual(chain.meetings[0].distractors, {2: "question"})

    def test_rejects_bad_files(self):
        bad = {
            "quote not in its turn": MINI.replace('quote="We go with Vendor A"', 'quote="something else entirely"'),
            "unknown speaker": MINI.replace("ali: What if", "bob: What if"),
            "bad kind": MINI.replace("| INITIAL | quote=\"We go", "| WHATEVER | quote=\"We go"),
            "value outside enum": MINI.replace("= Vendor A | INITIAL", "= Vendor Z | INITIAL"),
            "bad distractor": MINI.replace("distractor question", "distractor nonsense"),
            "question without gold": MINI.replace("| gold=1", "| nothing=1"),
            "as_of_tx without tx": MINI.replace("| tx=2026-03-01T00:00:00Z", ""),
            "no meeting": "chain: x\nnow: 2026-01-01T00:00:00Z\nchair: hi",
        }
        for name, text in bad.items():
            with self.subTest(name), self.assertRaises(DatasetError):
                parse_chain(text)

    def test_every_shipped_chain_loads(self):
        chains = load_chains(str(DATA))
        self.assertEqual({c.chain_id for c in chains}, {"crm", "datacentre", "tender", "hiring", "portfolio"})


class TestOracleReproducesTheGold(unittest.TestCase):
    """The hand-written answers and annotated kinds are an independent check on the engine."""

    def test_every_shipped_chain(self):
        for chain in load_chains(str(DATA)):
            with self.subTest(chain.chain_id):
                p = Pipeline(chain.registry, OracleExtractor(chain), make_policy("immediate"))
                for gm in chain.meetings:
                    result = p.ingest(gm.meeting)
                    self.assertEqual({d.status for d in result.dispositions}, {"applied"})
                self.assertEqual(p.ledger.check_invariants(), [])
                for q in chain.questions:
                    self.assertTrue(values_equal(ledger_answer(p.ledger, q, chain.now), q.gold), f"{q.qid}: gold {q.gold}")
                kinds = {}
                for obj, attr in chain.registry.slots():
                    for h in p.ledger.history(obj, attr):
                        kinds[(p.meeting_of_source[h["evidence"][0]["source_id"]], obj, attr, str(h["value"]))] = h["change_type"]
                for e in chain.events:
                    self.assertEqual(kinds[(e.meeting_id, e.object_id, e.attribute, str(e.value))], e.kind, e.event_id)


class TestGrounding(unittest.TestCase):
    def setUp(self):
        self.chain = parse_chain(MINI)
        self.meeting = self.chain.meetings[0].meeting

    def test_exact_quote_is_located_ignoring_case_and_spacing(self):
        turn, start, end, exact = ground(self.meeting, "we  GO with vendor a")
        self.assertEqual((turn, exact), (0, True))
        self.assertEqual(self.meeting.text[start:end].casefold(), "we go with vendor a")

    def test_hint_turn_breaks_ties(self):
        self.assertEqual(ground(self.meeting, "Vendor", hint_turn=2)[0], 2)

    def test_paraphrase_is_grounded_fuzzily_to_the_turn_or_not_at_all(self):
        fuzzy = ground(self.meeting, "we do go with Vendor A")
        self.assertEqual((fuzzy[0], fuzzy[3]), (0, False))
        self.assertIsNone(ground(self.meeting, "the board approved a new logo"))
        self.assertIsNone(ground(self.meeting, "  "))


class TestPipelineRules(unittest.TestCase):
    def run_candidates(self, candidates, policy="immediate", meeting="m1"):
        chain = parse_chain(MINI)
        p = Pipeline(chain.registry, FixedExtractor({meeting: candidates}), make_policy(policy), OracleReviewer(chain))
        gm = next(m for m in chain.meetings if m.meeting.meeting_id == meeting)
        return p, p.ingest(gm.meeting)

    def test_no_evidence_no_memory(self):
        p, r = self.run_candidates([Candidate("vendor", "outcome", "Vendor A", "a quote that is nowhere", 0, None, 0.9)])
        self.assertEqual([d.status for d in r.dispositions], ["ungrounded"])
        self.assertIsNone(p.ledger.current("vendor", "outcome"))

    def test_closed_set_linking_and_value_checks(self):
        cases = [
            Candidate("nope", "outcome", "Vendor A", "We go with Vendor A", 0),
            Candidate("vendor", "colour", "Vendor A", "We go with Vendor A", 0),
            Candidate("vendor", "outcome", "Vendor Z", "We go with Vendor A", 0),
            Candidate("rollout", "deadline", "next Friday", "live by 1 March", 1),
            Candidate("rollout", "owner", "nobody", "Ali owns it", 1),
        ]
        _, r = self.run_candidates(cases)
        self.assertEqual([d.status for d in r.dispositions], ["invalid"] * 5)

    def test_unresolved_candidates_never_reach_the_ledger(self):
        _, r = self.run_candidates([Candidate(None, "outcome", None, "We go with Vendor A", 0, unresolved=True)])
        self.assertEqual(r.dispositions[0].status, "unresolved")

    def test_evidence_is_the_located_span_not_the_models_paraphrase(self):
        p, r = self.run_candidates([Candidate("vendor", "outcome", "Vendor A", "we go with vendor a", 0, None, 0.8)])
        fact = p.ledger.history("vendor", "outcome")[0]
        self.assertEqual(fact["evidence"][0]["span_text"], "We go with Vendor A")
        self.assertEqual((fact["evidence"][0]["speaker_id"], fact["evidence"][0]["confidence"]), ("chair", 0.8))

    def test_candidates_are_applied_in_transcript_order(self):
        a = Candidate("rollout", "deadline", "2026-04-01", "live by 1 March", 1)
        b = Candidate("rollout", "owner", "ali", "Ali owns it", 1)
        p, r = self.run_candidates([b, a])
        self.assertEqual(p.ledger.current("rollout", "deadline").value, "2026-04-01")

    def test_policies_gate_only_belief_changing_candidates(self):
        first = Candidate("vendor", "outcome", "Vendor A", "We go with Vendor A", 0, None, 0.9)
        for policy, expected in (("immediate", "applied"), ("confirm_conflicts", "applied"), ("confirm_all", "proposed")):
            with self.subTest(policy):
                _, r = self.run_candidates([first], policy)
                self.assertEqual(r.dispositions[0].status, expected)
        chain = parse_chain(MINI)
        for policy, expected in (("immediate", "applied"), ("confirm_conflicts", "proposed"), ("confirm_all", "proposed")):
            with self.subTest(case="conflict", policy=policy):
                extractor = FixedExtractor({"m1": [first], "m2": [Candidate("vendor", "outcome", "Vendor B", "switch to Vendor B", 0, None, 0.9)]})
                p = Pipeline(chain.registry, extractor, make_policy(policy), OracleReviewer(chain))
                for gm in chain.meetings:
                    result = p.ingest(gm.meeting)
                self.assertEqual(result.dispositions[0].status, expected)

    def test_threshold_policy_gates_on_confidence(self):
        policy = make_policy("threshold:0.8")
        self.assertTrue(policy.needs_review(conflict=False, changes_belief=True, confidence=0.5))
        self.assertTrue(policy.needs_review(conflict=False, changes_belief=True, confidence=None))
        self.assertFalse(policy.needs_review(conflict=True, changes_belief=True, confidence=0.9))
        self.assertFalse(policy.needs_review(conflict=False, changes_belief=False, confidence=0.1))
        with self.assertRaises(ValueError):
            make_policy("whenever")

    def test_oracle_reviewer_accepts_edits_and_rejects(self):
        good = Candidate("vendor", "outcome", "Vendor A", "We go with Vendor A", 0, None, 0.9)
        wrong_value = Candidate("rollout", "deadline", "2026-03-02", "live by 1 March", 1, None, 0.9)
        invented = Candidate("rollout", "status", "done", "What if we looked at Vendor B?", 2, None, 0.9)
        p, r = self.run_candidates([good, wrong_value, invented], "confirm_all")
        self.assertEqual([d.review for d in r.dispositions], ["accepted", "accepted_edited", "rejected"])
        self.assertEqual(p.ledger.current("rollout", "deadline").value, "2026-03-01")
        self.assertIsNone(p.ledger.current("rollout", "status"))
        self.assertEqual(r.dispositions[1].value, "2026-03-02")  # the extractor's own output is preserved for scoring

    def test_a_late_import_does_not_override_a_newer_decision(self):
        chain = parse_chain(MINI.replace("meeting: m1 | 2026-01-10T09:00:00Z | ingested=2026-01-10T12:00:00Z",
                                         "meeting: m1 | 2026-01-10T09:00:00Z | ingested=2026-04-01T12:00:00Z"))
        p = Pipeline(chain.registry, OracleExtractor(chain), make_policy("immediate"))
        for gm in chain.meetings:
            p.ingest(gm.meeting)
        self.assertEqual(p.ledger.current("vendor", "outcome").value, "Vendor B")
        self.assertEqual(p.ledger.check_invariants(), [])


class TestExtractorParsing(unittest.TestCase):
    def test_clean_json_with_code_fence(self):
        text = '```json\n{"events":[{"turn":2,"quote":"q","object_id":"a","attribute":"b","value":1,"confidence":0.7}]}\n```'
        events, clean = parse_events(text)
        self.assertTrue(clean)
        self.assertEqual((events[0].turn, events[0].confidence, events[0].valid_from), (2, 0.7, None))

    def test_salvages_events_from_broken_json(self):
        text = 'Sure! {"events":[{"turn":1,"quote":"one","object_id":"a","attribute":"b","value":1}, {"turn":2,"quote":"two","object_id":"a","attribute":"b","value":2},'
        events, clean = parse_events(text)
        self.assertFalse(clean)
        self.assertEqual([e.quote for e in events], ["one", "two"])

    def test_garbage_yields_nothing(self):
        self.assertEqual(parse_events("no json here"), ([], False))

    def test_bad_field_types_are_tolerated(self):
        events, clean = parse_events('{"events":[{"turn":"x","quote":null,"object_id":null,"attribute":"b","value":1,"confidence":"high"}]}')
        self.assertTrue(clean)
        self.assertEqual((events[0].turn, events[0].quote, events[0].confidence), (None, "", None))


class TestKeywordBaseline(unittest.TestCase):
    def test_finds_a_plain_decision_and_skips_a_question(self):
        chain = parse_chain(MINI)
        p = Pipeline(chain.registry, KeywordExtractor(), make_policy("immediate"))
        result = p.ingest(chain.meetings[0].meeting)
        found = {(d.object_id, d.attribute, d.value) for d in result.dispositions if d.status == "applied"}
        self.assertIn(("vendor", "outcome", "Vendor A"), found)
        self.assertFalse(any(d.turn == 2 for d in result.dispositions))


if __name__ == "__main__":
    unittest.main()
