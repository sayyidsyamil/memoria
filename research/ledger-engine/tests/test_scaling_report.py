import unittest
import xml.etree.ElementTree as ET

from memoria_engine.evaluation import baselines, run_scaling, scaling_report
from memoria_engine.evaluation.dataset import load_chains
from test_pipeline import DATA
from test_scaling import QUIET, StubLLM

DEV = [c for c in load_chains(str(DATA)) if c.chain_id in ("crm", "datacentre")]
CONFIG = {"split": "dev", "chains": ["crm", "datacentre"], "questions": 27, "model": "stub", "extractor": "oracle", "extractor_prompt": "v2",
          "extractor_prompt_sha256_12": "x", "router_prompt": "r1", "generator": "g1", "padding_seed": 0, "data_sha256_12": "d", "ask_sha256_12": "a", "date": "now"}


def fake_reports():
    memoria = {"config": CONFIG, "levels": {str(k): run_scaling.memoria_level(DEV, k, "oracle", None, None, log=QUIET) for k in (0, 8)}}
    llm = StubLLM("none")
    base = {"config": CONFIG, "levels": {str(k): run_scaling.baseline_level(DEV, k, [baselines.FullContext(llm), baselines.BM25RAG(llm, k=6)], log=QUIET) for k in (0, 8)}}
    return memoria, base


class TestScalingReport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.memoria, cls.base = fake_reports()

    def test_render_has_every_section_and_the_right_numbers(self):
        text = scaling_report.render(self.memoria, [self.base], ["full-context"])
        for heading in ("Question answering accuracy as the history grows", "Paired comparison", "By question type", "Router", "What the ledger holds", "Cost"):
            self.assertIn(heading, text)
        self.assertIn("| Memoria (LLM extractor + LLM router) | 100% [88-100] (27/27) | 100% [88-100] (27/27) |", text)
        self.assertIn("| full-context * |", text)
        self.assertIn("| bm25-rag(k=6) |", text)
        self.assertIn("K=0 | K=8", text)
        self.assertIn("Not shown by this experiment", text)

    def test_paired_table_counts_discordant_questions(self):
        none_gold = sum(1 for c in DEV for q in c.questions if q.gold is None)
        text = scaling_report.render(self.memoria, [self.base], ["full-context"])
        self.assertIn(f"| 0 | full-context * | {27 - none_gold} | 0 | {none_gold} | 0 | <0.001 |", text)

    def test_chart_is_valid_svg_with_one_series_per_system(self):
        svg = scaling_report.chart(self.memoria, [self.base], ["full-context", "bm25-rag(k=6)"], "title")
        root = ET.fromstring(svg)
        self.assertTrue(root.tag.endswith("svg"))
        self.assertEqual(svg.count("<polyline"), 3)
        self.assertIn("title", svg)

    def test_a_misrouting_run_shows_up_in_the_misses_list(self):
        from test_scaling import FailingRouter
        bad = {"config": CONFIG, "levels": {"0": run_scaling.memoria_level(DEV, 0, "oracle", None, FailingRouter(), log=QUIET)}}
        base = {"config": CONFIG, "levels": {"0": self.base["levels"]["0"]}}
        text = scaling_report.render(bad, [base], ["full-context"])
        self.assertIn("Routing misses:", text)
        self.assertIn("garbage", text)

    def test_a_single_level_report_lists_each_system_once_in_the_by_type_table(self):
        one = {"config": CONFIG, "levels": {"0": self.memoria["levels"]["0"]}}
        base = {"config": CONFIG, "levels": {"0": self.base["levels"]["0"]}}
        text = scaling_report.render(one, [base], ["full-context"])
        section = text.split("### By question type")[1].split("###")[0]
        self.assertEqual(section.count("| Memoria (LLM + router) |"), 1)
        self.assertEqual(section.count("| full-context | 0 |"), 1)

    def test_cot_budget_section_counts_capped_answers_and_is_absent_without_cot(self):
        self.assertNotIn("token budget", scaling_report.render(self.memoria, [self.base], ["full-context"]))
        llm = StubLLM("thinking\nANSWER: none")
        cot = {"config": dict(CONFIG, cot_max_tokens=3), "levels": {str(k): run_scaling.baseline_level(DEV, k, [baselines.FullContext(llm, cot=True)], log=QUIET) for k in (0, 8)}}
        text = scaling_report.render(self.memoria, [cot], ["full-context+cot"])
        row = next(ln for ln in text.split("token budget")[1].splitlines() if ln.startswith("| full-context+cot |"))
        self.assertEqual(row.count("27/27"), 2)

    def test_phrasing_section_compares_both_wordings_and_lists_misses(self):
        from test_scaling import FailingRouter
        alt = {"config": dict(CONFIG, ask_sha256_12="other"), "levels": {"0": run_scaling.memoria_level(DEV, 0, "oracle", None, FailingRouter(), log=QUIET)}}
        text = scaling_report.render_phrasing(self.memoria, alt)
        self.assertIn("27/27 / 0/27", text)
        self.assertIn("Questions the router missed under the second phrasing, at any K (27):", text)
        self.assertIn("first missed at K=0", text)


if __name__ == "__main__":
    unittest.main()
