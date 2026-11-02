import hashlib
import os
import unittest
from unittest.mock import Mock, patch

import live_guard
from live_assistance import live_check, _tokens
import test_live_assistance as fixtures


class GuardUnitTests(unittest.TestCase):
    def test_question_hash_matches_frozen_research(self):
        messages = live_guard.question("We're still using standard batteries.",
            'Power source is Kinetic charging (replaces Standard battery).')
        digest = hashlib.sha256((messages[0]['content'] + '\n' + messages[1]['content']).encode()).hexdigest()
        self.assertEqual(digest, '1c08afee455734b819652f7472625445aa3365cbb28291d4b32376ac512a587a')

    def test_candidates_idf_stable_and_three_max(self):
        facts = [{'label': label, 'attribute': 'choice', 'fact_id': i}
                 for i, label in enumerate(('Budget travel', 'Budget catering', 'Venue harbour', 'Budget hotel'))]
        ranked = live_guard.candidates('Budget harbour choice', facts, _tokens)
        self.assertEqual([f['fact_id'] for f in ranked], [2, 0, 1])


class LiveGuardTests(unittest.TestCase):
    # Reuse the temporary approved-ledger fixture, without rerunning its tests.
    tearDown = fixtures.LiveAssistanceTests.tearDown
    approve = fixtures.LiveAssistanceTests.approve
    conflict = staticmethod(fixtures.LiveAssistanceTests.conflict)
    no_conflict = staticmethod(fixtures.LiveAssistanceTests.no_conflict)

    def setUp(self):
        fixtures.LiveAssistanceTests.setUp(self)
        environment = patch.dict(os.environ, {'MEMORIA_GUARD': 'on'})
        environment.start()
        self.addCleanup(environment.stop)
    def guarded(self, statement, scores, verifier=None):
        scorer = Mock(side_effect=scores)
        with patch.dict(os.environ, {'MEMORIA_GUARD': 'on'}):
            reply = live_check(self.engine, {'statement': statement}, verifier or self.conflict, scorer=scorer)
        self.assertTrue(reply['ok'], reply)
        return reply['data'], scorer

    def test_confirm_at_threshold_and_drop_below(self):
        self.approve(value='Acme', label='Supplier', attribute='choice')
        data, scorer = self.guarded('Supplier choice is Beta.', [1.0])
        self.assertEqual(data['status'], 'attention')
        self.assertEqual(scorer.call_count, 1)
        data, _ = self.guarded('Supplier choice is Beta.', [0.999])
        self.assertEqual(data['cues'], [])
        self.assertTrue(any('Guard dropped' in w for w in data['warnings']))

    def test_best_alternative_recites_current_fact_and_replaces_wrong_reason(self):
        self.approve(value='Acme', label='Supplier1', attribute='choice')
        self.approve(value='March', label='Supplier2', attribute='choice')
        self.approve(value='Europe', label='Supplier3', attribute='choice')
        data, scorer = self.guarded('Supplier1 Supplier2 Supplier3 choice is wrong.', [-1, 2, 4])
        self.assertEqual(data['cues'][0]['label'], 'Supplier3')
        self.assertNotEqual(data['cues'][0]['reason'], self.conflict('', [{'factId': 1}])['reason'])
        self.assertEqual(scorer.call_count, 3)
        self.assertTrue(any('Guard moved' in w for w in data['warnings']))

    def test_numeric_and_no_conflict_never_score(self):
        self.approve()
        data, scorer = self.guarded('Snack budget is MYR 300.', AssertionError('no model'))
        self.assertEqual(data['status'], 'attention')
        scorer.assert_not_called()
        data, scorer = self.guarded('Snack budget may be MYR 300.', AssertionError('no model'), self.no_conflict)
        self.assertEqual(data['status'], 'quiet')
        scorer.assert_not_called()

    def test_guard_off_never_scores(self):
        self.approve(value='Acme', label='Supplier', attribute='choice')
        scorer = Mock(side_effect=AssertionError('off'))
        for value in ('off', '0', 'false', 'NO'):
            with patch.dict(os.environ, {'MEMORIA_GUARD': value}):
                result = live_check(self.engine, {'statement': 'Supplier choice is Beta.'}, self.conflict, scorer)
            self.assertEqual(result['data']['status'], 'attention')
        scorer.assert_not_called()

    def test_guard_errors_nonfinite_and_time_budget_fail_closed(self):
        self.approve(value='Acme', label='Supplier', attribute='choice')
        for scores in (TimeoutError('offline'), [float('nan')], [float('inf')], [True], ['YES']):
            with self.subTest(scores=scores):
                data, _ = self.guarded('Supplier choice is Beta.', scores)
                self.assertEqual(data['status'], 'uncertain')
                self.assertEqual(data['cues'], [])
        def late(messages):
            clock[0] += 121
            return 5.0
        clock = [0]
        with patch('live_assistance.time.perf_counter', side_effect=lambda: clock[0]):
            result = live_check(self.engine, {'statement': 'Supplier choice is Beta.'}, self.conflict, late)
        self.assertEqual(result['data']['status'], 'uncertain')
        self.assertEqual(result['data']['cues'], [])

    def test_default_scoring_is_lazy_and_gets_remaining_budget(self):
        self.approve(value='Acme', label='Supplier', attribute='choice')
        with patch('qwen_scoring.score', return_value=1) as score:
            result = live_check(self.engine, {'statement': 'Supplier choice is Beta.'}, self.conflict)
        self.assertEqual(result['data']['status'], 'attention')
        self.assertLessEqual(score.call_args.kwargs['timeout'], 110)
        self.assertIn('Acme', score.call_args.args[0][1]['content'])

    def test_attribution_recovers_wrong_unnamed_subject_without_exposing_it(self):
        self.approve(value='Acme', label='Hotel', attribute='choice')
        self.approve(value='Beta', label='Supplier', attribute='choice')
        def verify(statement, facts):
            cited = next(f for f in facts if f['label'] == 'Hotel')
            return self.conflict(statement, [cited])
        data, scorer = self.guarded('Supplier choice is Globex.', [3], verify)
        self.assertEqual(data['cues'][0]['label'], 'Supplier')
        self.assertEqual(scorer.call_count, 1)  # the unnamed cited subject is never asked about
        self.assertFalse(any('cue suppressed' in w for w in data['warnings']))

    def test_attribution_can_recover_sixth_fact_but_checks_at_most_three(self):
        for index in range(6):
            self.approve(value='Acme', label=f'Supplier{index}',
                         attribute='rare' if index == 5 else 'budget choice')
        statement = 'Supplier0 Supplier1 Supplier2 Supplier3 Supplier4 Supplier5 choice budget rare.'
        def verify(statement, facts):
            self.assertEqual(len(facts), 5)
            return self.conflict(statement, facts)
        # Rare lexical overlap makes the sixth slot best among attribution
        # candidates without changing the app's original five-fact selection.
        with patch('live_guard.candidates', wraps=live_guard.candidates) as candidates:
            data, scorer = self.guarded(statement, [-1, 4, 2], verify)
        self.assertEqual(data['cues'][0]['label'], 'Supplier5')
        self.assertLessEqual(scorer.call_count, 4)
        self.assertEqual(len(candidates.call_args.args[1]), 6)


if __name__ == '__main__':
    unittest.main()
