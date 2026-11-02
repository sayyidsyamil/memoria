"""Hybrid retrieval invariants and evaluation design, without downloading a model."""
import copy
import unittest
from dataclasses import replace

import numpy as np

from memoria_engine.evaluation.dataset import parse_ask, parse_chain
from scripts.hybrid_rag import HybridRAG, RetrievalConfig, bm25_scores, fused_ranking
from scripts.hybrid_experiment import cluster_difference, evidence_coverage, sensitivity_configs


def fixture():
    chain = parse_chain("""chain: example
now: 2026-04-01
people: sam=Sam
object: vendor | decision | Supplier | outcome:enum[Acme,Beta]!reverse
meeting: m1 | 2026-01-01 | ingested=2026-01-01
sam: We choose Acme. ## event vendor.outcome = Acme | INITIAL
meeting: m2 | 2026-03-01 | ingested=2026-03-01
sam: We choose Beta. ## event vendor.outcome = Beta | REVERSE
question: current | current | vendor.outcome | gold=Beta
question: recorded | as_of_tx | vendor.outcome | valid=2026-01-10 | tx=2026-02-01 | gold=Acme
""")
    return parse_ask("current | Which supplier do we use?\nrecorded | Which supplier was chosen by January?", chain)


class Encoder:
    def __init__(self):
        self.calls = []

    def encode(self, texts, query=False):
        self.calls.append((list(texts), query))
        return np.array([[1., 0.] if query or "Beta" in text else [0., 1.] for text in texts])


class HybridTests(unittest.TestCase):
    def test_weighted_rrf_matches_hand_calculation(self):
        config = RetrievalConfig(k=2, candidates=2, alpha=0.25, rrf=10)
        result = fused_ranking([3, 1], [1, 3], config)
        self.assertEqual([r["index"] for r in result], [0, 1])
        self.assertAlmostEqual(result[0]["score"], 0.75 / 11 + 0.25 / 12)

    def test_dense_and_lexical_ablation_endpoints(self):
        self.assertEqual(fused_ranking([3, 1], [1, 3], RetrievalConfig(k=1, alpha=0))[0]["index"], 0)
        self.assertEqual(fused_ranking([3, 1], [1, 3], RetrievalConfig(k=1, alpha=1))[0]["index"], 1)
        self.assertEqual(fused_ranking([0, 0], [1, 3], RetrievalConfig(k=1, alpha=0)), [])

    def test_empty_and_tied_corpora(self):
        self.assertEqual(fused_ranking([], [], RetrievalConfig()), [])
        result = fused_ranking([1, 1], [1, 1], RetrievalConfig(k=2))
        self.assertEqual([r["index"] for r in result], [0, 1])
        self.assertEqual(bm25_scores(["", ""], "anything"), [0, 0])

    def test_validation(self):
        for kwargs in ({"k": 0}, {"window": 0}, {"rrf": 0}, {"alpha": 1.1}, {"candidates": 1}):
            with self.assertRaises(ValueError):
                RetrievalConfig(**kwargs)
        for lexical, dense in (([1], []), ([float("nan")], [1])):
            with self.assertRaises(ValueError):
                fused_ranking(lexical, dense, RetrievalConfig())

    def test_bm25_relevance(self):
        scores = bm25_scores(["vendor Acme Acme", "weather rain", ""], "Acme")
        self.assertGreater(scores[0], scores[1])
        self.assertEqual(scores[1:], [0, 0])

    def test_cutoff_prevents_future_transcript_leakage(self):
        chain = fixture()
        encoder = Encoder()
        rag = HybridRAG(None, encoder, RetrievalConfig(k=1, window=1, alpha=1))
        prompt = rag.prompt(chain, chain.questions[1])
        self.assertIn("We choose Acme.", prompt)
        self.assertNotIn("We choose Beta.", prompt)
        self.assertFalse(any("We choose Beta." in text for texts, _ in encoder.calls for text in texts))

    def test_gold_and_structured_slot_do_not_affect_retrieval(self):
        chain = fixture()
        rag = HybridRAG(None, Encoder(), RetrievalConfig(k=1, window=1, alpha=1))
        original = rag.prompt(chain, chain.questions[0])
        changed = replace(chain, meetings=tuple(replace(m, events=()) for m in chain.meetings))
        q = replace(chain.questions[0], gold="Acme", object_id="not_used", attribute="not_used")
        self.assertEqual(original, rag.prompt(changed, q))
        self.assertIn("We choose Beta.", original)

    def test_chronological_presentation_after_relevance_selection(self):
        chain = fixture()
        rag = HybridRAG(None, Encoder(), RetrievalConfig(k=2, window=1, alpha=1))
        prompt = rag.prompt(chain, chain.questions[0])
        self.assertLess(prompt.index("We choose Acme."), prompt.index("We choose Beta."))
        self.assertEqual(rag.last_retrieval["selected"][0]["index"], 1)

    def test_generation_is_actual_existing_llm_interface(self):
        class LLM:
            def complete(self, prompt, max_tokens):
                self.prompt = prompt
                return {"text": "Beta", "seconds": 0.1, "prompt_tokens": 30, "output_tokens": 1}
        llm = LLM()
        rag = HybridRAG(llm, Encoder(), RetrievalConfig(k=1, alpha=1))
        result = rag.answer(fixture(), fixture().questions[0])
        self.assertEqual(result["raw"], "Beta")
        self.assertIn("We choose Beta.", llm.prompt)

    def test_coverage_is_diagnostic_and_none_for_no_eligible_events(self):
        chain = fixture()
        self.assertEqual(evidence_coverage(chain, chain.questions[0], [("", "We choose Beta.")]),
                         {"found": 1, "total": 2, "coverage": 0.5})
        q = replace(chain.questions[1], valid_at="2025-01-01")
        self.assertIsNone(evidence_coverage(chain, q, [])["coverage"])

    def test_sensitivity_design_is_unique_and_one_factor_at_a_time(self):
        from dataclasses import asdict
        configs = sensitivity_configs()
        self.assertEqual(len(configs), 12)
        self.assertEqual(len({c.name for c in configs}), len(configs))
        base = asdict(configs[0])
        for config in configs[1:]:
            self.assertEqual(sum(v != base[k] for k, v in asdict(config).items()), 1)

    def test_paired_analysis_aligns_keys_not_input_order(self):
        a = {("a", "1"): True, ("b", "1"): False}
        b = {("b", "1"): False, ("a", "1"): False}
        self.assertEqual(cluster_difference(a, b)["delta"], 0.5)
        with self.assertRaises(ValueError):
            cluster_difference(a, {("c", "1"): True})


if __name__ == "__main__":
    unittest.main()
