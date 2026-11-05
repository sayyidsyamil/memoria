import unittest

from memoria_engine.evaluation import baselines, router, run_scaling
from memoria_engine.evaluation.dataset import load_chains
from test_pipeline import DATA

DEV = [c for c in load_chains(str(DATA)) if c.chain_id in ("crm", "datacentre")]
QUIET = lambda *a, **k: None


class StubLLM:
    def __init__(self, reply="none"):
        self.reply, self.calls = reply, 0

    def complete(self, prompt, max_tokens=None):
        self.calls += 1
        return {"text": self.reply, "seconds": 0.5, "prompt_tokens": len(prompt) // 4, "output_tokens": 3}


class FailingRouter:
    last_stats = {"seconds": 1.0, "prompt_tokens": 100, "raw": "garbage"}

    def route(self, registry, today, text):
        return router.Route(reason="garbage")


class TestMemoriaLevel(unittest.TestCase):
    def test_oracle_extractor_and_oracle_router_are_perfect_at_every_level(self):
        for k in (0, 8):
            out = run_scaling.memoria_level(DEV, k, "oracle", None, None, log=QUIET)
            for combo in run_scaling.COMBOS:
                self.assertEqual(out["qa"][combo]["overall"]["accuracy"], 1.0, (k, combo))
            self.assertEqual(out["router"]["exact"], out["router"]["n"])
            self.assertEqual(out["extraction_base"]["f1"], 1.0)
            self.assertEqual(out["ledger_all"]["state_accuracy"], 1.0)
            self.assertEqual(out["ledger_base"]["state_accuracy"], 1.0)
            self.assertEqual(out["k"], k)
            self.assertEqual(len(out["rows"]), 27)
        self.assertIsNone(run_scaling.memoria_level(DEV, 0, "oracle", None, None, log=QUIET)["extraction_filler"])

    def test_shape_grows_with_k_and_filler_is_scored_separately(self):
        small = run_scaling.memoria_level(DEV, 8, "oracle", None, None, log=QUIET)
        big = run_scaling.memoria_level(DEV, 24, "oracle", None, None, log=QUIET)
        for cid in ("crm", "datacentre"):
            self.assertLess(small["shape"][cid]["meetings"], big["shape"][cid]["meetings"])
            self.assertLess(small["shape"][cid]["objects"], big["shape"][cid]["objects"])
        self.assertGreater(big["extraction_filler"]["gold_events"], small["extraction_filler"]["gold_events"])
        self.assertEqual(big["extraction_base"]["gold_events"], small["extraction_base"]["gold_events"])

    def test_a_weak_extractor_hurts_extraction_but_not_the_oracle_ablations(self):
        out = run_scaling.memoria_level(DEV, 8, "keyword", None, None, log=QUIET)
        self.assertLess(out["qa"]["ext+oracle_route"]["overall"]["accuracy"], 1.0)
        self.assertEqual(out["qa"]["oracle_ext+oracle_route"]["overall"]["accuracy"], 1.0)
        self.assertLess(out["extraction_base"]["f1"], 1.0)

    def test_failed_routes_are_always_wrong_even_when_the_gold_is_none(self):
        out = run_scaling.memoria_level(DEV, 0, "oracle", None, FailingRouter(), log=QUIET)
        self.assertTrue(any(r["gold"] is None for r in out["rows"]))
        self.assertEqual(out["qa"]["ext+router"]["overall"]["correct"], 0)
        self.assertEqual(out["qa"]["oracle_ext+router"]["overall"]["correct"], 0)
        self.assertEqual(out["qa"]["ext+oracle_route"]["overall"]["accuracy"], 1.0)
        self.assertEqual(out["router"]["failed"], 27)
        self.assertEqual(out["router"]["exact"], 0)
        self.assertEqual(out["router"]["mean_prompt_tokens"], 100)


class TestBaselineLevel(unittest.TestCase):
    def test_structure_and_accounting(self):
        llm = StubLLM("none")
        systems = [baselines.FullContext(llm), baselines.BM25RAG(llm, k=4), baselines.FullContext(llm, cot=True)]
        out = run_scaling.baseline_level(DEV, 8, systems, log=QUIET)
        self.assertEqual(llm.calls, 27 * 3)
        self.assertEqual(set(out["systems"]), {"full-context", "bm25-rag(k=4)", "full-context+cot"})
        for name, s in out["systems"].items():
            self.assertEqual(len(s["items"]), 27)
            self.assertEqual(s["qa"]["overall"]["n"], 27)
            self.assertGreater(s["mean_prompt_tokens"], 100)
        correct = {i["qid"] + i["chain"] for i in out["systems"]["full-context"]["items"] if i["correct"]}
        self.assertEqual(len(correct), sum(1 for c in DEV for q in c.questions if q.gold is None))
        self.assertIsNone(out["systems"]["full-context"]["answer_marker_rate"])
        self.assertEqual(out["systems"]["full-context+cot"]["answer_marker_rate"], 0.0)

    def test_longer_histories_mean_longer_prompts_for_full_context_but_not_much_for_rag(self):
        llm = StubLLM("none")
        sizes = {}
        for k in (0, 24):
            level = run_scaling.baseline_level(DEV, k, [baselines.FullContext(llm), baselines.BM25RAG(llm, k=6)], log=QUIET)
            sizes[k] = {n: s["mean_prompt_tokens"] for n, s in level["systems"].items()}
        self.assertGreater(sizes[24]["full-context"], 2.5 * sizes[0]["full-context"])
        self.assertLess(sizes[24]["bm25-rag(k=6)"], 1.8 * sizes[0]["bm25-rag(k=6)"])

    def test_cot_answers_are_read_from_the_marker(self):
        llm = StubLLM("thinking...\nANSWER: none")
        out = run_scaling.baseline_level(DEV[:1], 0, [baselines.FullContext(llm, cot=True)], log=QUIET)
        s = out["systems"]["full-context+cot"]
        self.assertEqual(s["answer_marker_rate"], 1.0)
        self.assertEqual(s["qa"]["overall"]["correct"], sum(1 for q in DEV[0].questions if q.gold is None))


if __name__ == "__main__":
    unittest.main()
