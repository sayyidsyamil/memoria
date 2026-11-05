import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from live_assistance import _semantic


class SemanticCandidatesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        environment = patch.dict('os.environ', {'MEMORIA_EMBED_SOCKET': '/test/not-opened.sock'})
        environment.start()
        self.addCleanup(environment.stop)

    @staticmethod
    def fact(label, value):
        return {'label': label, 'attribute': 'choice', 'value': value}

    def candidates(self, facts, similarities):
        vectors = np.array([[1.0, 0.0]] + [[score, np.sqrt(1 - score ** 2)] for score in similarities], dtype='float32')
        with patch('live_assistance._embed', return_value=vectors):
            return _semantic('We picked Gamma.', facts, self.home)

    def test_a_sole_relevant_decision_can_be_checked_even_without_a_shared_label_word(self):
        vendor = self.fact('Vendor', 'Beta Cloud')
        self.assertEqual(self.candidates([vendor], [.9]), [vendor])

    def test_a_sole_weak_match_stays_out(self):
        vendor = self.fact('Vendor', 'Beta Cloud')
        self.assertEqual(self.candidates([vendor], [.4]), [])

    def test_a_generic_remark_equally_close_to_several_decisions_stays_out(self):
        facts = [self.fact('Vendor', 'Beta Cloud'), self.fact('Budget', '280000'), self.fact('Launch', '9 November')]
        self.assertEqual(self.candidates(facts, [.7, .7, .7]), [])

    def test_a_distinct_match_still_wins_over_the_other_decisions(self):
        facts = [self.fact('Vendor', 'Beta Cloud'), self.fact('Budget', '280000'), self.fact('Launch', '9 November')]
        self.assertEqual(self.candidates(facts, [.95, .5, .6]), [facts[0]])

    def test_a_cached_sole_decision_only_needs_the_new_statement_embedded(self):
        vendor = self.fact('Vendor', 'Beta Cloud')
        self.candidates([vendor], [.9])
        with patch('live_assistance._embed', return_value=np.array([[1., 0.]], dtype='float32')) as embed:
            self.assertEqual(_semantic('We selected Gamma.', [vendor], self.home), [vendor])
        embed.assert_called_once_with(['task: fact checking | query: We selected Gamma.'])


if __name__ == '__main__':
    unittest.main()
