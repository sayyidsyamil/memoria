import json
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
import review_challenge as challenge


def test_audio(texts, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as out:
        out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        out.writeframes(b'\0\0' * 16000 * len(texts))
    return [(float(index), float(index + 1)) for index in range(len(texts))]


class ReviewChallengeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.vault, self.receipt = self.home / 'participant', self.home / 'facilitator.json'
        with patch('engine.local_generator', side_effect=AssertionError('No model is allowed in fixture preparation')):
            challenge.build(self.vault, self.receipt, test_audio)
        self.spec = json.loads(self.receipt.read_text())

    def tearDown(self):
        self.temp.cleanup()

    def review(self, accept_supported, accept_unsupported):
        engine = challenge.Engine(self.vault)
        try:
            for case in self.spec['cases']:
                accept = accept_supported if case['case'] == 'supported-deadline' else accept_unsupported
                challenge.call(engine, 'proposals.accept' if accept else 'proposals.reject',
                               {'proposal_id': case['proposal_id'], 'reviewer': 'Test participant'})
        finally:
            engine.db.close()

    def test_starts_with_two_pending_proposals_and_unchanged_approved_values(self):
        result = challenge.grade(self.vault, self.receipt)
        self.assertFalse(result['passed'])
        self.assertEqual(result['current'], {'budget.amount': 280000, 'training.owner': 'Raj', 'training.deadline': '2026-11-03'})
        self.assertTrue(all(not case['handled'] for case in result['cases']))
        self.assertFalse(self.receipt.is_relative_to(self.vault))
        self.assertTrue(all((self.vault / path).is_file() for path in self.spec['sources']))

    def test_correct_review_passes_and_grading_preserves_ledger_bytes(self):
        self.review(True, False)
        ledger = challenge.temporal_home(self.vault)
        before = {name: challenge.digest(ledger / name) for name in ('ledger.sqlite', 'ledger.jsonl')}
        result = challenge.grade(self.vault, self.receipt)
        self.assertTrue(result['passed'])
        self.assertTrue(all(case['passed'] for case in result['cases']))
        self.assertEqual(result['current'], self.spec['expected_current'])
        self.assertEqual(before, {name: challenge.digest(ledger / name) for name in before})

    def test_rejecting_everything_does_not_pass(self):
        self.review(False, False)
        result = challenge.grade(self.vault, self.receipt)
        self.assertFalse(result['passed'])
        self.assertFalse(result['current_values_correct'])
        supported = next(case for case in result['cases'] if case['case'] == 'supported-deadline')
        self.assertFalse(supported['passed'])

    def test_accepting_everything_does_not_pass_even_if_bad_value_is_later_corrected(self):
        self.review(True, True)
        result = challenge.grade(self.vault, self.receipt)
        self.assertFalse(result['passed'])
        self.assertEqual(result['current']['budget.amount'], 12000)
        engine = challenge.Engine(self.vault)
        try:
            fact = next(f for f in challenge.call(engine, 'overview')['facts'] if f['object_id'] == 'budget')
            challenge.call(engine, 'facts.correct', {'fact_id': fact['fact_id'], 'value': 280000,
                                                   'reason': 'The quote was about the workshop, not the pilot.'})
        finally:
            engine.db.close()
        result = challenge.grade(self.vault, self.receipt)
        self.assertTrue(result['current_values_correct'])
        self.assertFalse(result['passed'])
        unsupported = next(case for case in result['cases'] if case['case'] == 'unsupported-budget')
        self.assertTrue(unsupported['ever_accepted'])

    def test_changed_sources_are_not_silently_scored(self):
        source = next(name for name in self.spec['sources'] if name.endswith('.md'))
        with (self.vault / source).open('a') as out:
            out.write('\nChanged after the fixture freeze.\n')
        with self.assertRaisesRegex(ValueError, 'sources or registry changed'):
            challenge.grade(self.vault, self.receipt)

    def test_damaged_receipt_cannot_remove_the_positive_control(self):
        self.review(True, False)
        self.spec['cases'] = [case for case in self.spec['cases'] if case['case'] == 'unsupported-budget']
        self.receipt.write_text(json.dumps(self.spec))
        with self.assertRaisesRegex(ValueError, 'both fixed challenge cases'):
            challenge.grade(self.vault, self.receipt)

    def test_build_refuses_existing_work_and_a_receipt_in_the_participant_vault(self):
        sentinel = self.home / 'personal' / 'keep.txt'
        sentinel.parent.mkdir()
        sentinel.write_text('user work')
        with self.assertRaisesRegex(ValueError, 'fresh, empty'):
            challenge.build(sentinel.parent, self.home / 'other.json', test_audio)
        self.assertEqual(sentinel.read_text(), 'user work')
        empty = self.home / 'new'
        with self.assertRaisesRegex(ValueError, 'outside'):
            challenge.build(empty, empty / 'answers.json', test_audio)
        self.assertFalse(empty.exists())


if __name__ == '__main__':
    unittest.main()
