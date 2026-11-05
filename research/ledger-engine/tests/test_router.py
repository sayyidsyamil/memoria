import unittest

from memoria_engine.evaluation import router
from memoria_engine.evaluation.dataset import load_chains
from memoria_engine.evaluation.oracle import ledger_answer, values_equal
from memoria_engine.evaluation.run_eval import run_pipeline
from memoria_engine.extractors import OracleExtractor
from test_pipeline import DATA


class StubLLM:
    def __init__(self, reply):
        self.reply, self.prompts = reply, []

    def complete(self, prompt, max_tokens=None):
        self.prompts.append(prompt)
        return {"text": self.reply, "seconds": 0.1, "prompt_tokens": len(prompt) // 4, "output_tokens": 20}


class TestParseRoute(unittest.TestCase):
    def setUp(self):
        self.reg = next(c for c in load_chains(str(DATA)) if c.chain_id == "crm").registry

    def parse(self, raw):
        return router.parse_route(raw, self.reg)

    def test_valid_routes_for_each_type(self):
        r = self.parse('{"type":"current","object_id":"crm_vendor","attribute":"outcome","valid_at":null,"tx_at":null}')
        self.assertTrue(r.ok)
        self.assertEqual((r.type, r.object_id, r.attribute, r.valid_at, r.tx_at), ("current", "crm_vendor", "outcome", None, None))
        r = self.parse('```json\n{"type":"as_of_tx","object_id":"crm_rollout","attribute":"deadline","valid_at":"2026-03-10","tx_at":"2026-04-01"}\n```')
        self.assertTrue(r.ok)
        self.assertEqual((r.valid_at, r.tx_at), ("2026-03-10", "2026-04-01"))
        self.assertTrue(self.parse('{"type":"n_changes","object_id":"crm_budget","attribute":"amount"}').ok)
        self.assertEqual(self.parse('Sure! {"type":"as_of_valid","object_id":"crm_budget","attribute":"amount","valid_at":"2026-01-15T00:00:00Z"}').valid_at, "2026-01-15")

    def test_irrelevant_dates_are_dropped_per_type(self):
        r = self.parse('{"type":"current","object_id":"crm_budget","attribute":"amount","valid_at":"2026-01-01","tx_at":"2026-01-02"}')
        self.assertTrue(r.ok)
        self.assertEqual((r.valid_at, r.tx_at), (None, None))
        r = self.parse('{"type":"as_of_valid","object_id":"crm_budget","attribute":"amount","valid_at":"2026-01-01","tx_at":"2026-01-02"}')
        self.assertEqual((r.valid_at, r.tx_at), ("2026-01-01", None))

    def test_everything_invalid_is_a_failed_route_with_a_reason(self):
        cases = {
            "I do not know": "no JSON",
            '{"type":"sometimes","object_id":"crm_budget","attribute":"amount"}': "unknown type",
            '{"type":"current","object_id":"nope","attribute":"amount"}': "invalid reply",
            '{"type":"current","object_id":"crm_budget","attribute":"owner"}': "invalid reply",
            '{"type":"current","object_id":null,"attribute":null}': "no tracked item",
            '{"type":"as_of_valid","object_id":"crm_budget","attribute":"amount","valid_at":"15 June"}': "invalid reply",
            '{"type":"as_of_valid","object_id":"crm_budget","attribute":"amount","valid_at":null}': "missing valid_at",
            '{"type":"as_of_tx","object_id":"crm_budget","attribute":"amount","valid_at":"2026-01-01","tx_at":null}': "missing tx_at",
            '{"type": "current", "object_id": "crm_budget"': "no JSON",
            "[1, 2]": "no JSON",
        }
        for raw, reason in cases.items():
            r = self.parse(raw)
            self.assertFalse(r.ok, raw)
            self.assertIn(reason, r.reason, raw)

    def test_a_failed_route_never_earns_credit_even_when_gold_is_none(self):
        self.assertFalse(values_equal(router.ROUTE_FAILED, None))
        chain = next(c for c in load_chains(str(DATA)) if c.chain_id == "crm")
        pipe = run_pipeline(chain, OracleExtractor(chain), "immediate")["pipeline"]
        self.assertEqual(router.routed_answer(pipe.ledger, router.Route(reason="x"), chain.now), router.ROUTE_FAILED)


class TestRoutedAnswers(unittest.TestCase):
    def test_routing_the_structured_question_reproduces_gold_on_every_chain(self):
        for chain in load_chains(str(DATA)):
            pipe = run_pipeline(chain, OracleExtractor(chain), "immediate")["pipeline"]
            for q in chain.questions:
                route = router.oracle_route(q)
                self.assertTrue(router.route_matches(route, q))
                got = router.routed_answer(pipe.ledger, route, chain.now)
                self.assertTrue(values_equal(got, q.gold), f"{chain.chain_id} {q.qid}: {got!r} != {q.gold!r}")
                self.assertEqual(got, ledger_answer(pipe.ledger, q, chain.now))

    def test_route_matches_is_strict_about_every_field(self):
        chain = next(c for c in load_chains(str(DATA)) if c.chain_id == "crm")
        q = next(x for x in chain.questions if x.type == "as_of_tx")
        good = router.oracle_route(q)
        self.assertTrue(router.route_matches(good, q))
        for field, value in (("type", "as_of_valid"), ("object_id", "crm_budget"), ("attribute", "owner"),
                             ("valid_at", "2026-01-01"), ("tx_at", "2026-01-01"), ("ok", False)):
            self.assertFalse(router.route_matches(router.Route(**{**good.as_dict(), field: value}), q), field)


class TestRouterPrompt(unittest.TestCase):
    def setUp(self):
        self.chain = next(c for c in load_chains(str(DATA)) if c.chain_id == "crm")

    def test_prompt_has_the_registry_today_and_only_the_question_text(self):
        q = self.chain.questions[6]
        text = router.build_prompt(self.chain.registry, "2026-05-01", q.ask)
        for needle in ("crm_vendor: Which CRM vendor (decision): outcome[Vendor A|Vendor B|Vendor C]", "Today's date: 2026-05-01", q.ask, "chair = Dato' Rahman"):
            self.assertIn(needle, text)
        self.assertNotIn("gold", text.casefold().replace("golden", ""))
        self.assertTrue(text.rstrip().endswith("A:"))
        self.assertNotIn(str(q.gold), text.split("Now the real question.")[1].replace(q.ask, ""))

    def test_mlx_router_uses_the_llm_and_records_stats(self):
        stub = StubLLM('{"type":"current","object_id":"crm_budget","attribute":"amount","valid_at":null,"tx_at":null}')
        r = router.MLXRouter(stub)
        route = r.route(self.chain.registry, "2026-05-01", "How much is the budget?")
        self.assertTrue(route.ok)
        self.assertEqual(len(stub.prompts), 1)
        self.assertIn("How much is the budget?", stub.prompts[0])
        self.assertEqual(r.last_stats["raw"], stub.reply)
        self.assertFalse(router.MLXRouter(StubLLM("no idea")).route(self.chain.registry, "2026-05-01", "?").ok)


if __name__ == "__main__":
    unittest.main()
