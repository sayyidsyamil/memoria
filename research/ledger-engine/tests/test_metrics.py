import unittest

from memoria_engine.evaluation import baselines, metrics
from memoria_engine.evaluation.dataset import load_chains
from memoria_engine.pipeline import Candidate, Pipeline, make_policy
from test_pipeline import DATA, FixedExtractor, MINI, parse_chain


class TestStatistics(unittest.TestCase):
    def test_prf(self):
        self.assertEqual(metrics.prf(8, 2, 8), (0.8, 0.5, 2 * 0.8 * 0.5 / 1.3))
        self.assertEqual(metrics.prf(0, 0, 0), (None, None, None))
        self.assertEqual(metrics.prf(0, 3, 3)[2], 0.0)

    def test_wilson_interval_contains_the_estimate_and_narrows_with_n(self):
        low, high = metrics.wilson(9, 10)
        self.assertTrue(low < 0.9 < high)
        low2, high2 = metrics.wilson(90, 100)
        self.assertTrue(high2 - low2 < high - low)
        self.assertEqual(metrics.wilson(0, 0), (None, None))

    def test_auroc(self):
        self.assertEqual(metrics.auroc([0.9, 0.8], [0.1, 0.2]), 1.0)
        self.assertEqual(metrics.auroc([0.5], [0.5]), 0.5)
        self.assertEqual(metrics.auroc([0.1], [0.9]), 0.0)
        self.assertIsNone(metrics.auroc([], [0.1]))

    def test_ece(self):
        self.assertAlmostEqual(metrics.ece([1.0, 1.0], [1, 1]), 0.0)
        self.assertAlmostEqual(metrics.ece([1.0, 1.0], [1, 0]), 0.5)
        self.assertIsNone(metrics.ece([], []))

    def test_bootstrap_interval_brackets_the_point_estimate(self):
        per_meeting = [(3, 1, 1), (2, 0, 2), (4, 1, 0), (1, 1, 1), (5, 0, 1)]
        ci = metrics.bootstrap_prf(per_meeting, n_boot=500, seed=1)
        tp, fp, fn = (sum(x[i] for x in per_meeting) for i in range(3))
        p, r, f = metrics.prf(tp, fp, fn)
        for name, value in (("precision", p), ("recall", r), ("f1", f)):
            self.assertTrue(ci[name][0] <= value <= ci[name][1], name)


class TestScoringARun(unittest.TestCase):
    def setUp(self):
        self.chain = parse_chain(MINI)

    def score(self, by_meeting):
        p = Pipeline(self.chain.registry, FixedExtractor(by_meeting), make_policy("immediate"))
        scores = []
        for gm in self.chain.meetings:
            scores.append(metrics.score_meeting(gm, p.ingest(gm.meeting), self.chain.registry))
        return p, scores

    def test_perfect_and_error_taxonomy(self):
        m1 = [
            Candidate("vendor", "outcome", "Vendor A", "We go with Vendor A", 0, None, 0.9),  # tp
            Candidate("rollout", "owner", "ali", "Ali owns it", 1, None, 0.9),  # tp
            Candidate("rollout", "deadline", "2026-03-02", "live by 1 March", 1, None, 0.9),  # value error
            Candidate("vendor", "outcome", "Vendor B", "What if we looked at Vendor B?", 2, None, 0.6),  # distractor fp
        ]
        m2 = [Candidate("rollout", "status", "done", "switch to Vendor B", 0, None, 0.4)]  # link error + wrong_content
        _, scores = self.score({"m1": m1, "m2": m2})
        agg = metrics.aggregate_extraction(scores)
        self.assertEqual((agg["tp"], agg["fp"], agg["fn"]), (2, 3, 2))
        self.assertEqual(agg["miss_reasons"], {"value_error": 1, "link_error": 1})
        self.assertEqual(agg["fp_reasons"], {"wrong_content": 2, "distractor:question": 1})
        self.assertEqual(agg["distractor_hit_rate"], 1.0)

    def test_ungrounded_but_correct_is_reported_as_such(self):
        m1 = [Candidate("vendor", "outcome", "Vendor A", "a paraphrase that is nowhere", 0, None, 0.9)]
        _, scores = self.score({"m1": m1})
        self.assertEqual(scores[0]["miss"][0]["reason"] if scores[0]["miss"][0]["event"] == "m1.t0.0" else None, "ungrounded")

    def test_ledger_scores_against_the_oracle_run(self):
        from memoria_engine.extractors import OracleExtractor
        gold = Pipeline(self.chain.registry, OracleExtractor(self.chain), make_policy("immediate"))
        for gm in self.chain.meetings:
            gold.ingest(gm.meeting)
        perfect = Pipeline(self.chain.registry, OracleExtractor(self.chain), make_policy("immediate"))
        for gm in self.chain.meetings:
            perfect.ingest(gm.meeting)
        s = metrics.sum_ledger_scores([metrics.ledger_scores(perfect, gold, self.chain)])
        self.assertEqual((s["supersession_f1"], s["state_accuracy"], s["phantom_beliefs"]), (1.0, 1.0, 0))
        wrong, _ = self.score({"m1": [Candidate("vendor", "outcome", "Vendor A", "We go with Vendor A", 0, None, 0.9),
                                      Candidate("rollout", "status", "cancelled", "Ali owns it", 1, None, 0.5)]})
        s = metrics.sum_ledger_scores([metrics.ledger_scores(wrong, gold, self.chain)])
        self.assertEqual(s["phantom_beliefs"], 1)
        self.assertLess(s["state_accuracy"], 1.0)
        self.assertEqual(s["supersession_fn"], 1)

    def test_answer_scoring(self):
        items = [{"type": "current", "correct": True}, {"type": "current", "correct": False}, {"type": "n_changes", "correct": True}]
        out = metrics.score_answers(items)
        self.assertEqual((out["overall"]["correct"], out["overall"]["n"]), (2, 3))
        self.assertEqual(out["current"]["accuracy"], 0.5)


class TestBaselinePlumbing(unittest.TestCase):
    def setUp(self):
        self.chain = next(c for c in load_chains(str(DATA)) if c.chain_id == "crm")

    def question(self, qid):
        return next(q for q in self.chain.questions if q.qid == qid)

    def test_as_of_tx_questions_only_see_meetings_ingested_by_then(self):
        q8 = self.question("q8")  # tx = 2026-03-01
        self.assertEqual([m for m, _, _ in baselines.transcripts_before(self.chain, q8)], ["m1", "m2"])
        q7 = self.question("q7")  # tx = 2026-04-01: after m3, before the late import m2b
        self.assertEqual([m for m, _, _ in baselines.transcripts_before(self.chain, q7)], ["m1", "m2", "m3"])
        self.assertEqual(len(baselines.transcripts_before(self.chain, self.question("q1"))), 5)

    def test_answer_parsing(self):
        q1, q4, q11, q10 = (self.question(x) for x in ("q1", "q4", "q11", "q10"))
        self.assertEqual(baselines.parse_answer("Vendor B.", q1, self.chain), "Vendor B")
        self.assertEqual(baselines.parse_answer("`done`\nbecause...", q4, self.chain), "done")
        self.assertEqual(baselines.parse_answer("It changed 2 times", q11, self.chain), 2)
        self.assertIsNone(baselines.parse_answer("None", q10, self.chain))
        self.assertTrue(baselines.score_item(self.chain, q1, "vendor b")["correct"])
        self.assertFalse(baselines.score_item(self.chain, q1, "Vendor A")["correct"])

    def test_bm25_retrieves_the_relevant_turns_and_respects_the_cutoff(self):
        rag = baselines.BM25RAG(llm=None, k=3, version="v2")
        hits = rag.retrieve(self.chain, self.question("q8"))
        self.assertTrue(any("Vendor A" in text for _, text in hits))
        self.assertTrue(all("m3" not in src and "m4" not in src for src, _ in hits))
        self.assertLessEqual(len(hits), 3)

    def test_question_text_names_the_slot_and_the_format(self):
        text = baselines.question_text(self.chain, self.question("q3"))
        self.assertIn("ISO date", text)
        self.assertIn("crm_rollout.deadline", text)
        self.assertIn("integer", baselines.question_text(self.chain, self.question("q11")))


class TestBaselinePromptV3(unittest.TestCase):
    def setUp(self):
        self.chain = next(c for c in load_chains(str(DATA)) if c.chain_id == "crm")
        self.q = {q.qid: q for q in self.chain.questions}

    def prompts(self, qid, **kw):
        return (baselines.FullContext(None, **kw).prompt(self.chain, self.q[qid]),
                baselines.BM25RAG(None, k=4, **kw).prompt(self.chain, self.q[qid]))

    def test_every_question_has_natural_wording_without_slot_ids(self):
        for q in self.chain.questions:
            self.assertTrue(q.ask)
            self.assertNotIn(q.object_id, q.ask)
            self.assertNotIn("_", q.ask)

    def test_prompt_gives_today_rules_and_the_registry_but_not_the_slot_id(self):
        for text in self.prompts("q1"):
            self.assertIn("Today's date is 2026-05-01", text)
            self.assertIn("most recent decision already in effect", text)
            self.assertIn("Which CRM vendor: outcome = Vendor A | Vendor B | Vendor C", text)
            self.assertNotIn("crm_vendor", text)
            self.assertIn(self.q["q1"].ask, text)

    def test_full_context_is_ordered_by_held_date_and_tx_questions_are_filtered_and_labelled(self):
        text = baselines.FullContext(None).prompt(self.chain, self.q["q6"])  # includes the late import m2b (held 5 Mar, ingested 5 Apr)
        days = [line.split("held on ")[1].split(" ")[0] for line in text.splitlines() if line.startswith("=== Meeting")]
        self.assertEqual(days, sorted(days))
        self.assertEqual(len(days), 5)
        tx = baselines.FullContext(None).prompt(self.chain, self.q["q7"])  # recorded by 1 April: m2b is not there yet
        self.assertEqual(tx.count("=== Meeting"), 3)
        self.assertIn("only cover meetings recorded by 2026-04-01", tx)
        self.assertNotIn("recorded by", baselines.FullContext(None).prompt(self.chain, self.q["q6"]))

    def test_bm25_v3_returns_chronological_chunks_within_the_cutoff(self):
        hits = baselines.BM25RAG(None, k=5).retrieve(self.chain, self.q["q7"])
        days = [src.split("held on ")[1] for src, _ in hits]
        self.assertEqual(days, sorted(days))
        self.assertTrue(all(d < "2026-04-02" for d in days))
        self.assertLessEqual(len(hits), 5)

    def test_cot_prompt_and_answer_marker(self):
        direct, cot = (baselines.FullContext(None, cot=c).prompt(self.chain, self.q["q4"]) for c in (False, True))
        self.assertIn("Reply with the answer only", direct)
        self.assertIn("ANSWER:", cot)
        q4, q11 = self.q["q4"], self.q["q11"]
        self.assertEqual(baselines.parse_answer("m4: rollout complete.\nANSWER: done", q4, self.chain, cot=True), "done")
        self.assertEqual(baselines.parse_answer("Answer: **1**.", q11, self.chain, cot=True), 1)
        self.assertEqual(baselines.parse_answer("blah\nstill thinking\ndone", q4, self.chain, cot=True), "done")  # no marker: last line
        self.assertEqual(baselines.parse_answer("done\nbecause", q4, self.chain, cot=False), "done")  # direct: first line
        self.assertEqual(baselines.parse_answer("early ANSWER: none\nbut then ANSWER: done", q4, self.chain, cot=True), "done")

    def test_v2_and_names(self):
        self.assertEqual(baselines.FullContext(None).name, "full-context")
        self.assertEqual(baselines.FullContext(None, cot=True).name, "full-context+cot")
        self.assertEqual(baselines.BM25RAG(None, k=12, cot=True).name, "bm25-rag(k=12)+cot")
        self.assertEqual(baselines.FullContext(None, version="v2").name, "full-context(v2)")
        with self.assertRaises(ValueError):
            baselines.FullContext(None, cot=True, version="v2")
        self.assertIn("crm_rollout.deadline", baselines.FullContext(None, version="v2").prompt(self.chain, self.q["q3"]))


if __name__ == "__main__":
    unittest.main()
