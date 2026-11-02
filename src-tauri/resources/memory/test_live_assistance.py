import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from live_assistance import live_check, _tokens, _ReadOnlyService
from memoria_engine.pipeline import Candidate
from memoria_engine.service import Service
from memoria_engine.ledger import ts
from temporal_support import contained_path, temporal_home, valid_current, supporting_evidence


class LiveFixture(unittest.TestCase):
    mode = 'verifier'  # the written-verdict path; GuardFirstTests covers the default

    def setUp(self):
        clock = patch('temporal_support.now_us', return_value=ts('2026-11-02T12:00:00Z'))
        clock.start()
        self.addCleanup(clock.stop)
        environment = patch.dict('os.environ', {'MEMORIA_LIVE_CHECK': getattr(self, 'mode', 'verifier')})
        environment.start()
        self.addCleanup(environment.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.engine = SimpleNamespace(root=self.root)
        self.home = self.root / '.memoria-memory' / 'temporal'
        self.counter = 0

    def tearDown(self):
        self.temp.cleanup()

    def approve(self, value='MYR 200', label='Snack', attribute='budget', quote=None,
                occurred='2026-01-01T10:00:00Z', approve=True):
        self.counter += 1
        service = Service(str(self.home), extractor='none')
        try:
            service.registry_set([{'object_id': label.casefold(), 'label': label,
                                   'attributes': [{'name': attribute, 'type': 'text'}]}])
            text = quote or f'{label} {attribute} is {value}.'

            class Extractor:
                name = 'fixture'

                def extract(self, context):
                    return [Candidate(label.casefold(), attribute, value, text, 0, None, 1.0)]

            service.extractor = lambda kind: Extractor()
            meeting = f'meeting-{self.counter}'
            service.meetings_ingest(meeting, [{'speaker': 'Maya', 'start': 12.5, 'text': text}],
                                    occurred_at=occurred, extractor='keyword', policy='confirm_all')
            if approve:
                service.proposals_accept(service.proposals_list()[-1]['proposal_id'])
            return service.facts_current()
        finally:
            service.pipe.ledger.close()

    def check(self, statement, verifier=None, **params):
        # A mock default guarantees a test cannot accidentally start a model.
        if verifier is None:
            verifier = Mock(side_effect=AssertionError('Unexpected verification'))
        reply = live_check(self.engine, {'statement': statement, **params}, verifier,
                           scorer=lambda messages: 2.0)
        self.assertTrue(reply['ok'], reply)
        data = reply['data']
        self.assertEqual(set(data), {'status', 'statement', 'cues', 'warnings', 'seconds'})
        self.assertEqual(data['statement'], statement)
        self.assertGreaterEqual(data['seconds'], 0)
        return data

    @staticmethod
    def no_conflict(statement, facts):
        return {'contradiction': False, 'reason': 'No comparable current conflict.', 'factId': facts[0]['factId']}

    @staticmethod
    def conflict(statement, facts):
        return {'contradiction': True, 'reason': 'Same subject has an incompatible current choice.', 'factId': facts[0]['factId']}


class LiveAssistanceTests(LiveFixture):

    def test_missing_registry_is_quiet_without_creating_memory(self):
        verifier = Mock()
        data = self.check('Snack budget is MYR 300.', verifier)
        self.assertEqual(data['status'], 'quiet')
        self.assertEqual(data['warnings'], ['No approved tracked facts'])
        self.assertFalse(self.home.exists())
        verifier.assert_not_called()

    def test_empty_registry_and_registry_only_do_not_create_ledger(self):
        self.home.mkdir(parents=True)
        registry = self.home / 'registry.json'
        for objects in ([], [{'object_id': 'snack', 'label': 'Snack', 'attributes': [{'name': 'budget'}]}]):
            registry.write_text(json.dumps({'objects': objects}))
            self.assertEqual(self.check('Snack budget is MYR 300.')['status'], 'quiet')
            self.assertEqual(set(p.name for p in self.home.iterdir()), {'registry.json'})

    def test_pending_proposals_are_not_facts(self):
        self.approve(approve=False)
        data = self.check('Snack budget is MYR 300.')
        self.assertEqual(data['status'], 'quiet')
        self.assertEqual(data['warnings'], ['No approved tracked facts'])

    def test_exact_numeric_conflict_has_inspectable_current_citation(self):
        current = self.approve()[0]
        verifier = Mock()
        data = self.check('Snack budget is MYR 300.', verifier, meetingId='live-meeting')
        self.assertEqual(data['status'], 'attention')
        self.assertEqual(len(data['cues']), 1)
        cue = data['cues'][0]
        self.assertEqual(set(cue), {'factId', 'label', 'attribute', 'currentValue', 'quote', 'speaker', 'meeting', 'at', 'reason'})
        self.assertEqual(cue['factId'], current['fact_id'])
        self.assertEqual(cue['currentValue'], 'MYR 200')
        self.assertEqual(cue['quote'], 'Snack budget is MYR 200.')
        self.assertEqual((cue['speaker'], cue['meeting'], cue['at']), ('Maya', 'meeting-1', 12.5))
        verifier.assert_not_called()

    def test_numeric_equivalence_and_qualifiers(self):
        self.approve(value='MYR 1,200.00')
        verifier = Mock()
        self.assertEqual(self.check('Snack budget is RM 1200.', verifier)['status'], 'quiet')
        verifier.assert_not_called()
        self.assertNotEqual(_tokens('USD 200'), _tokens('EUR 300'))
        self.assertIn('200', _tokens('USD 200'))

    def test_unrelated_speech_does_not_call_verifier(self):
        self.approve()
        verifier = Mock()
        data = self.check('My phone cost MYR 300.', verifier)
        self.assertEqual(data['status'], 'quiet')
        verifier.assert_not_called()
        self.assertIn('aliases', data['warnings'][0])

    def test_shared_attribute_without_its_subject_is_left_to_the_guard(self):
        self.approve()
        # Without the guard, a sentence must name the tracked item.
        with patch.dict('os.environ', {'MEMORIA_GUARD': 'off'}):
            data = self.check('The hotel budget is MYR 300.', self.conflict)
        self.assertEqual(data['status'], 'uncertain')
        self.assertEqual(data['cues'], [])
        self.assertTrue(any('subject' in warning for warning in data['warnings']))
        # With it, its narrow question decides whether the sentence is about the snack budget at all.
        with patch.dict('os.environ', {'MEMORIA_GUARD': 'on'}):
            reply = live_check(self.engine, {'statement': 'The hotel budget is MYR 300.'}, self.conflict, scorer=lambda messages: -2.0)
        self.assertEqual((reply['data']['status'], reply['data']['cues']), ('quiet', []))
        self.assertTrue(any('Guard dropped' in warning for warning in reply['data']['warnings']))

    def test_incompatible_units_and_ambiguous_numbers_use_verifier(self):
        self.approve()
        for statement in ('Snack budget is USD 300.', 'Snack budget is 300.',
                          'Snack budget is $300.', 'Snack budget is MYR 300 per day.',
                          'Should Snack budget be MYR 300?', 'Snack budget is about MYR 300.',
                          'Snack budget is MYR 300 and Hotel budget is MYR 200.'):
            with self.subTest(statement=statement):
                verifier = Mock(side_effect=self.no_conflict)
                self.assertEqual(self.check(statement, verifier)['status'], 'quiet')
                verifier.assert_called_once()
        self.approve(value='5 kg', label='Cargo', attribute='weight')
        verifier = Mock(side_effect=self.no_conflict)
        self.assertEqual(self.check('Cargo weight is 7 km.', verifier)['status'], 'quiet')
        verifier.assert_called_once()

    def test_unqualified_current_value_is_not_compared_as_currency(self):
        self.approve(value='200')
        verifier = Mock(side_effect=self.no_conflict)
        self.assertEqual(self.check('Snack budget is MYR 300.', verifier)['status'], 'quiet')
        verifier.assert_called_once()

    def test_quote_cap_or_period_is_not_an_exact_current_equality(self):
        for value, quote in (('MYR 200', 'Snack budget is capped at MYR 200.'),
                             ('MYR 250', 'Snack budget is MYR 250 per day.')):
            self.approve(value=value, quote=quote, occurred=f'2026-0{self.counter + 1}-01T10:00:00Z')
            verifier = Mock(side_effect=self.no_conflict)
            self.assertEqual(self.check('Snack budget is MYR 150.', verifier)['status'], 'quiet')
            verifier.assert_called_once()

    def test_false_verdict_drops_alert_and_true_verdict_is_grounded(self):
        self.approve(value='Acme', label='Supplier', attribute='choice')
        self.assertEqual(self.check('Supplier choice is Beta.', self.no_conflict)['cues'], [])
        data = self.check('Supplier choice is Beta.', self.conflict)
        self.assertEqual(data['status'], 'attention')
        self.assertEqual(data['cues'][0]['currentValue'], 'Acme')

    def test_missing_quotes_prevent_numeric_and_semantic_cues(self):
        current = self.approve()
        current[0]['evidence'] = [{'quote': '  '}]
        verifier = Mock(side_effect=self.conflict)
        with patch('live_assistance.valid_current', return_value=current):
            data = self.check('Snack budget is MYR 300.', verifier)
        self.assertEqual(data['status'], 'uncertain')
        self.assertEqual(data['cues'], [])
        verifier.assert_not_called()

    def test_supersession_never_supplies_old_values_as_current(self):
        old = self.approve(value='MYR 100')[0]
        current = self.approve(value='MYR 200', occurred='2026-02-01T10:00:00Z',
                               quote='Snack budget is MYR 200, replacing the earlier MYR 100.')[0]
        verifier = Mock()
        self.assertEqual(self.check('Snack budget was MYR 100 last month.', verifier)['status'], 'quiet')
        verifier.assert_not_called()
        data = self.check('Snack budget is MYR 100.', verifier)
        self.assertEqual(data['status'], 'attention')
        self.assertEqual(data['cues'][0]['factId'], current['fact_id'])
        self.assertNotEqual(data['cues'][0]['factId'], old['fact_id'])
        self.assertEqual(data['cues'][0]['currentValue'], 'MYR 200')
        verifier = Mock(side_effect=self.no_conflict)
        data = self.check('Snack budget was MYR 100, and now is MYR 200.', verifier)
        self.assertEqual(data['status'], 'quiet')
        payload = verifier.call_args.args[1]
        self.assertEqual([f['factId'] for f in payload], [current['fact_id']])
        self.assertEqual(payload[0]['value'], 'MYR 200')
        self.assertNotIn('history', payload[0])

    def test_future_2099_fact_is_not_current(self):
        future = self.approve(occurred='2099-01-01T10:00:00Z')
        self.assertEqual(future[0]['value'], 'MYR 200')  # vendor open-ended view
        verifier = Mock()
        data = self.check('Snack budget is MYR 300.', verifier)
        self.assertEqual(data['status'], 'quiet')
        self.assertEqual(data['cues'], [])
        self.assertEqual(data['warnings'], ['No approved tracked facts'])
        verifier.assert_not_called()

    def test_future_supersession_keeps_present_value_via_as_of(self):
        old = self.approve(value='MYR 100')[0]
        self.approve(value='MYR 200', occurred='2099-01-01T10:00:00Z')
        reader = _ReadOnlyService(self.home, json.loads((self.home / 'registry.json').read_text()))
        try:
            present = valid_current(reader)
            future = valid_current(reader, valid_at=ts('2099-02-01T00:00:00Z'))
        finally:
            reader.pipe.ledger.close()
        self.assertEqual(present[0]['fact_id'], old['fact_id'])
        self.assertEqual(present[0]['value'], 'MYR 100')
        self.assertEqual(future[0]['value'], 'MYR 200')
        data = self.check('Snack budget is MYR 200.')
        self.assertEqual(data['cues'][0]['currentValue'], 'MYR 100')

    def test_corrected_value_with_inherited_contradictory_quote_suppresses_all_cues(self):
        for value, corrected, label, attribute, statement in (
                ('MYR 200', 'MYR 250', 'Snack', 'budget', 'Snack budget is MYR 200.'),
                ('Acme', 'Beta', 'Supplier', 'choice', 'Supplier choice is Acme.')):
            with self.subTest(value=value):
                current = next(f for f in self.approve(value=value, label=label, attribute=attribute)
                               if f['label'] == label)
                writer = Service(str(self.home), extractor='none')
                try:
                    writer.facts_correct(current['fact_id'], corrected, reason='Reviewed correction')
                finally:
                    writer.pipe.ledger.close()
                verifier = Mock(side_effect=self.conflict)
                data = self.check(statement, verifier)
                self.assertEqual(data['status'], 'uncertain')
                self.assertEqual(data['cues'], [])
                self.assertTrue(any('inherited correction' in w for w in data['warnings']))
                verifier.assert_not_called()

    def test_corrected_support_helper_requires_same_explicit_value(self):
        fact = {'corrects': 1, 'label': 'Snack', 'attribute': 'budget', 'value': 'MYR 250',
                'evidence': [{'quote': 'Snack budget is MYR 200.'},
                             {'quote': 'Snack budget is MYR 250.'}]}
        self.assertEqual(supporting_evidence(fact), [fact['evidence'][1]])
        fact['evidence'] = [{'quote': 'Snack budget is MYR 200, replacing MYR 250.'}]
        self.assertEqual(supporting_evidence(fact), [])

    def test_symlink_directories_and_storage_files_are_rejected_before_open(self):
        names = ('.memoria-memory', '.memoria-memory/temporal',
                 *('.memoria-memory/temporal/' + name for name in (
                     'registry.json', 'registry.json.tmp', 'ledger.sqlite', 'ledger.jsonl',
                     'ledger.sqlite-wal', 'ledger.sqlite-shm', 'ledger.sqlite-journal')))
        with tempfile.TemporaryDirectory() as outside:
            external = Path(outside)
            (external / 'secret').write_text('unchanged external storage')
            for name in names:
                with self.subTest(name=name), tempfile.TemporaryDirectory() as workspace:
                    root = Path(workspace)
                    link = root / name
                    link.parent.mkdir(parents=True, exist_ok=True)
                    target = external if name in names[:2] else external / 'secret'
                    link.symlink_to(target, target_is_directory=target.is_dir())
                    with patch('live_assistance.sqlite3.connect') as connect:
                        reply = live_check(SimpleNamespace(root=root), {'statement': 'Snack budget is MYR 300.'}, Mock())
                    self.assertFalse(reply['ok'], reply)
                    self.assertEqual(reply['error']['code'], 'LIVE_CHECK_FAILED')
                    self.assertIn('symlink', reply['error']['message'])
                    connect.assert_not_called()
                    with self.assertRaisesRegex(ValueError, 'symlink'):
                        temporal_home(root)
                    self.assertEqual((external / 'secret').read_text(), 'unchanged external storage')
            self.assertEqual({p.name for p in external.iterdir()}, {'secret'})

    def test_dangling_and_internal_symlinks_and_outside_paths_are_rejected(self):
        self.home.mkdir(parents=True)
        registry = self.home / 'registry.json'
        for target in (self.home / 'missing', self.root / 'inside.json'):
            with self.subTest(target=target):
                registry.symlink_to(target)
                with self.assertRaisesRegex(ValueError, 'symlink'):
                    temporal_home(self.root)
                with self.assertRaisesRegex(ValueError, 'symlink'):
                    _ReadOnlyService(self.home, {'objects': []})
                registry.unlink()
        with self.assertRaisesRegex(ValueError, 'escapes'):
            contained_path(self.root, '../outside')
        with self.assertRaisesRegex(ValueError, 'escapes'):
            contained_path(self.root, self.root.parent / 'outside')

    def test_verifier_schema_and_citation_are_strict(self):
        self.approve(value='Acme', label='Supplier', attribute='choice')
        malformed = [None, 'not JSON', {'contradiction': True, 'reason': 'bad', 'factId': 999},
                     {'contradiction': 'true', 'reason': 'bad', 'factId': 1},
                     {'contradiction': True, 'reason': '', 'factId': 1},
                     {'contradiction': True, 'reason': 'bad', 'factId': True},
                     {'contradiction': True, 'reason': 'bad', 'factId': 1, 'extra': 'x'}]
        for raw in malformed:
            with self.subTest(raw=raw):
                data = self.check('Supplier choice is Beta.', lambda statement, facts: raw)
                self.assertEqual(data['status'], 'uncertain')
                self.assertEqual(data['cues'], [])

    def test_verifier_failures_and_late_results_are_uncertain(self):
        self.approve(value='Acme', label='Supplier', attribute='choice')
        data = self.check('Supplier choice is Beta.', Mock(side_effect=TimeoutError('offline')))
        self.assertEqual(data['status'], 'uncertain')
        with patch('live_assistance.CHECK_SECONDS', -1):
            self.assertEqual(self.check('Supplier choice is Beta.', self.conflict)['status'], 'uncertain')

    def test_five_fact_limit_and_context_limit(self):
        for index in range(6):
            self.approve(value='Acme', label=f'Supplier {index}', attribute='choice')
        verifier = Mock(side_effect=self.no_conflict)
        self.check('Supplier choice discussion.', verifier)
        self.assertEqual(len(verifier.call_args.args[1]), 5)
        with patch('live_assistance.MAX_CONTEXT', 1):
            verifier.reset_mock()
            self.assertEqual(self.check('Supplier choice discussion.', verifier)['status'], 'uncertain')
            verifier.assert_not_called()

    def test_default_generator_is_lazy_and_uses_narrow_json(self):
        self.approve(value='Acme', label='Supplier', attribute='choice')
        generator = Mock(return_value=json.dumps({'contradiction': False, 'reason': 'Agrees.', 'factId': 1}))
        with patch('engine.local_generator', return_value=generator) as factory:
            reply = live_check(self.engine, {'statement': 'Supplier choice is Acme.'})
        self.assertEqual(reply['data']['status'], 'quiet')
        factory.assert_called_once_with()
        prompt = generator.call_args.args[0]
        self.assertIn('HISTORY only', prompt)
        self.assertIn('factId', prompt)
        self.assertIn('Acme', prompt)

    def test_import_does_not_import_engine_or_model_libraries(self):
        code = ('import sys; import live_assistance; '
                'assert "engine" not in sys.modules; '
                'assert not any(n == "mlx" or n.startswith("mlx.") or n == "mlx_lm" '
                'for n in sys.modules)')
        subprocess.run([sys.executable, '-B', '-c', code], cwd=Path(__file__).parent, check=True)

    def test_read_checks_do_not_write_database_log_or_registry(self):
        self.approve()
        # SQLite WAL readers may create shared-memory coordination sidecars;
        # the durable ledger, append-only log and registry must stay byte-identical.
        names = ('ledger.sqlite', 'ledger.jsonl', 'registry.json')
        before = {name: (self.home / name).read_bytes() for name in names}
        self.check('Snack budget is MYR 300.')
        self.check('Snack budget was MYR 100.')
        self.assertEqual(before, {name: (self.home / name).read_bytes() for name in names})

    def test_read_connection_rejects_writes_and_observes_live_wal(self):
        self.approve()
        writer = Service(str(self.home), extractor='none')
        try:
            # Keep the writer open so the latest accepted change lives in WAL.
            writer.facts_correct(1, 'MYR 250', reason='Reviewed correction')
            reader = _ReadOnlyService(self.home, json.loads((self.home / 'registry.json').read_text()))
            try:
                self.assertEqual(reader.facts_current()[0]['value'], 'MYR 250')
                with self.assertRaises(Exception) as caught:
                    reader.pipe.ledger._db.execute("UPDATE meta SET value = 0")
                self.assertIn('readonly', str(caught.exception))
            finally:
                reader.pipe.ledger.close()
        finally:
            writer.pipe.ledger.close()

    def test_invalid_requests_and_corrupt_ledger_have_structured_errors(self):
        for request in (None, [], {}, {'statement': ''}, {'statement': 3}, {'statement': 'a' * 2001},
                        {'statement': 'hi', 'meetingId': None}):
            reply = live_check(self.engine, request)
            self.assertFalse(reply['ok'])
            self.assertEqual(reply['error']['code'], 'INVALID_LIVE_REQUEST')
        self.home.mkdir(parents=True)
        (self.home / 'registry.json').write_text('{')
        self.assertEqual(live_check(self.engine, {'statement': 'hi'})['error']['code'], 'LIVE_CHECK_FAILED')



class GuardFirstTests(LiveFixture):
    """The default live check: the YES/NO question alone, asked about each candidate decision."""
    mode = 'guard'

    def guard(self, statement, scores):
        asked = []

        def scorer(messages):
            decision = messages[-1]['content'].split('DECISION: ', 1)[1].split('\n', 1)[0]
            asked.append(decision)
            return next((value for key, value in scores.items() if key in decision), -5.0)
        reply = live_check(self.engine, {'statement': statement}, Mock(side_effect=AssertionError('no written verdict')), scorer=scorer)
        self.assertTrue(reply['ok'], reply)
        return reply['data'], asked

    def test_the_strongest_confirmed_decision_is_cued_without_a_written_verdict(self):
        self.approve('Beta Cloud', label='Vendor', attribute='choice')
        self.approve('MYR 280000', label='Pilot', attribute='budget')
        data, asked = self.guard('The vendor choice is now Gamma Solutions.', {'Vendor': 7.0, 'Pilot': -3.0})
        self.assertEqual(data['status'], 'attention')
        self.assertEqual([cue['label'] for cue in data['cues']], ['Vendor'])
        self.assertIn('log-odds 7.0', data['cues'][0]['reason'])
        self.assertTrue(asked)

    def test_a_weak_yes_is_not_enough_on_its_own(self):
        self.approve('Beta Cloud', label='Vendor', attribute='choice')
        data, _ = self.guard('The vendor choice is still Beta Cloud.', {'Vendor': 1.5})
        self.assertEqual((data['status'], data['cues']), ('quiet', []))

    def test_a_sentence_sharing_no_word_with_any_decision_asks_nothing(self):
        self.approve('Beta Cloud', label='Vendor', attribute='choice')
        data, asked = self.guard('Lunch was lovely today.', {'Vendor': 9.0})
        self.assertEqual((data['status'], asked), ('quiet', []))

    def test_a_failing_question_leaves_the_sentence_unverified(self):
        self.approve('Beta Cloud', label='Vendor', attribute='choice')
        reply = live_check(self.engine, {'statement': 'The vendor choice is Gamma.'}, None,
                           scorer=Mock(side_effect=TimeoutError('busy')))
        self.assertEqual(reply['data']['status'], 'uncertain')
        self.assertTrue(any('busy' in warning for warning in reply['data']['warnings']))

if __name__ == '__main__':
    unittest.main()


class SpokenAmountTests(unittest.TestCase):
    fact = {'label': 'Pilot budget (RM)', 'attribute': 'amount', 'value': 280000}

    def test_another_figure_in_the_same_currency_contradicts_and_the_same_figure_agrees(self):
        from live_assistance import _spoken_amount
        self.assertIs(_spoken_amount('And the pilot budget is now 300,000 ringgit.', self.fact), True)
        self.assertIs(_spoken_amount('The pilot budget is now RM 300k.', self.fact), True)
        self.assertIs(_spoken_amount('The pilot budget is still 280,000 ringgit.', self.fact), False)
        self.assertIs(_spoken_amount('The pilot budget is now 280 thousand ringgit.', self.fact), False)

    def test_questions_history_other_currencies_and_unnamed_items_are_left_to_the_model(self):
        from live_assistance import _spoken_amount
        for statement in ('Is the pilot budget 300,000?', 'The pilot budget was 250,000 ringgit last month.',
                          'The pilot budget is now 300,000 dollars.', 'We need 300,000 ringgit.', 'That is more than we agreed.',
                          'The pilot budget is 300,000 or 320,000 ringgit.'):
            self.assertIsNone(_spoken_amount(statement, self.fact), statement)
        self.assertIsNone(_spoken_amount('The vendor is now Gamma.', {'label': 'Vendor', 'attribute': 'choice', 'value': 'Beta Cloud'}))


class SpokenDateTests(unittest.TestCase):
    fact = {'label': 'Go-live', 'attribute': 'date', 'value': '2026-11-09'}

    def test_another_day_contradicts_and_the_approved_day_agrees(self):
        from live_assistance import _spoken_date
        self.assertIs(_spoken_date('The Go Live date is still the 9th of November.', self.fact), False)
        self.assertIs(_spoken_date('The go-live date is now the 16th of November.', self.fact), True)
        self.assertIs(_spoken_date('Go live moves to November 16, 2026.', self.fact), True)
        self.assertIs(_spoken_date('Go live is the 9th of November 2027.', self.fact), True)

    def test_history_questions_and_relative_days_are_left_to_the_model(self):
        from live_assistance import _spoken_date
        for statement in ('The go-live date was the 2nd of November.', 'Is go-live still the 9th of November?',
                          'The go live date is next Friday.', 'Training is on the 9th of November.'):
            self.assertIsNone(_spoken_date(statement, self.fact), statement)
