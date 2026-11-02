import unittest

from memoria_engine.evaluation import select_baselines


def system(correct, out_tokens, prompt_tokens=4000):
    return {"qa": {"overall": {"correct": correct, "n": 27}}, "mean_output_tokens": out_tokens, "mean_prompt_tokens": prompt_tokens}


def report(systems, level="24"):
    return {"levels": {level: {"systems": systems}}}


class TestSelectBaselines(unittest.TestCase):
    def test_best_configuration_wins_in_each_family(self):
        r = report({"full-context": system(17, 5), "full-context+cot": system(20, 200), "bm25-rag(k=6)": system(15, 5),
                    "bm25-rag(k=12)": system(18, 5), "bm25-rag(k=6)+cot": system(16, 190), "bm25-rag(k=12)+cot": system(17, 210)})
        got = {c["family"]: c["key"] for c in select_baselines.choose(r)}
        self.assertEqual(got, {"full-context": "fc+cot", "bm25-rag": "bm25-12"})

    def test_ties_go_to_the_cheaper_configuration(self):
        r = report({"full-context": system(19, 5), "full-context+cot": system(19, 200), "bm25-rag(k=6)": system(14, 5, 900),
                    "bm25-rag(k=12)": system(14, 5, 1700)})
        got = {c["family"]: c["key"] for c in select_baselines.choose(r)}
        self.assertEqual(got, {"full-context": "fc", "bm25-rag": "bm25-6"})

    def test_uses_the_largest_level_unless_told_otherwise(self):
        r = {"levels": {"8": {"systems": {"full-context": system(27, 5)}}, "24": {"systems": {"full-context": system(10, 5)}}}}
        self.assertEqual(select_baselines.choose(r)[0]["level"], 24)
        self.assertEqual(select_baselines.choose(r, "8")[0]["correct"], 27)

    def test_a_family_with_no_system_is_skipped(self):
        got = select_baselines.choose(report({"full-context": system(12, 5)}))
        self.assertEqual([c["family"] for c in got], ["full-context"])


if __name__ == "__main__":
    unittest.main()
