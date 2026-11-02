import tempfile
import json
import re
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from engine import Engine, workspace_product
from temporal_service import temporal_api
from memoria_engine.pipeline import Candidate


class TemporalIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.engine = Engine(self.root)
        self.call('registry.set', {'objects': [{'object_id': 'supplier', 'label': 'Supplier', 'kind': 'decision', 'attributes': [{'name': 'value', 'type': 'text'}]}]})

    def tearDown(self):
        self.engine.db.close()
        self.temp.cleanup()

    def call(self, method, params=None, extractor=None):
        with self.engine.locked():
            result = temporal_api(self.engine, {'method': method, 'params': params or {}}, extractor)
        self.assertTrue(result['ok'], result)
        return result['data']

    def ingest(self, value, occurred):
        identifier = str(uuid.uuid4())
        text = f'We decided to use {value} as supplier.'
        source = f'{identifier}.md'
        (self.root/source).write_text(f'[0:12] Maya: {text}')
        workspace_product(self.engine, {'action': 'save_meeting', 'record': {'id': identifier, 'title': 'Supplier review', 'created': occurred, 'status': 'transcript-reviewed', 'transcriptPath': source, 'names': {'S01': 'Maya'}, 'turns': [{'speaker': 'S01', 'start': 12.5, 'end': 15, 'text': text}]}})
        class Extractor:
            name = 'fixture'
            def extract(self, context):
                return [Candidate('supplier', 'value', value, text, 0, None, 1.0)]
        self.call('ingest_reviewed_meeting', {'meetingId': identifier}, Extractor())
        return identifier

    def test_two_meetings_require_review_and_preserve_temporal_evidence(self):
        first = self.ingest('Beta', '2026-10-01T10:00:00Z')
        overview = self.call('overview')
        self.assertEqual(overview['facts'], [])
        self.call('proposals.accept', {'proposal_id': overview['proposals'][0]['proposal_id']})
        self.ingest('Acme', '2026-10-20T10:00:00Z')
        self.assertEqual(self.call('query', {'type': 'current', 'object_id': 'supplier', 'attribute': 'value'})['answer'], 'Beta')
        self.call('proposals.accept', {'proposal_id': self.call('overview')['proposals'][0]['proposal_id']})
        self.assertEqual(self.call('query', {'type': 'current', 'object_id': 'supplier', 'attribute': 'value'})['answer'], 'Acme')
        past = self.call('query', {'type': 'as_of_valid', 'object_id': 'supplier', 'attribute': 'value', 'valid_at': '2026-10-10'})
        self.assertEqual(past['answer'], 'Beta')
        self.assertEqual(past['evidence'][0]['meeting'], first)
        self.assertEqual(past['evidence'][0]['audio_start'], 12.5)
        count = self.call('query', {'type': 'n_changes', 'object_id': 'supplier', 'attribute': 'value'})
        self.assertEqual(count['answer'], 1)
        self.assertTrue(count['evidence'])
        self.assertTrue(self.call('overview')['check']['ok'])

    def test_meetings_taken_in_together_can_be_approved_oldest_first(self):
        self.ingest('Beta', '2026-10-01T10:00:00Z')
        self.ingest('Acme', '2026-10-20T10:00:00Z')
        older, newer = sorted(self.call('overview')['proposals'], key=lambda proposal: proposal['proposal_id'])
        self.call('proposals.accept', {'proposal_id': older['proposal_id']})
        accepted = self.call('proposals.accept', {'proposal_id': newer['proposal_id']})
        self.assertIn('reproposed_as', accepted)
        self.assertEqual(self.call('query', {'type': 'current', 'object_id': 'supplier', 'attribute': 'value'})['answer'], 'Acme')
        self.assertEqual(self.call('query', {'type': 'n_changes', 'object_id': 'supplier', 'attribute': 'value'})['answer'], 1)
        self.assertEqual(self.call('overview')['proposals'], [])
        self.assertTrue(self.call('overview')['check']['ok'])

    def test_failed_extraction_does_not_consume_meeting_identifier(self):
        identifier = str(uuid.uuid4())
        text = 'We decided to use Beta as supplier.'
        (self.root/'retry.md').write_text(f'[0:12] Maya: {text}')
        workspace_product(self.engine, {'action': 'save_meeting', 'record': {'id':identifier,'title':'Retry','status':'transcript-reviewed','transcriptPath':'retry.md','created':'2026-10-01T10:00:00Z','names':{'S01':'Maya'},'turns':[{'speaker':'S01','start':12,'end':15,'text':text}]}})
        class Broken:
            name = 'broken'
            def extract(self, _context): raise TimeoutError('Model timed out')
        failed = temporal_api(self.engine, {'method':'ingest_reviewed_meeting','params':{'meetingId':identifier}}, Broken())
        self.assertFalse(failed['ok'])
        class Good:
            name = 'good'
            def extract(self, _context): return [Candidate('supplier','value','Beta',text,0,None,1)]
        self.call('ingest_reviewed_meeting', {'meetingId':identifier}, Good())
        self.assertEqual(len(self.call('overview')['proposals']), 1)

    def test_long_reviewed_meeting_windows_merge_and_preserve_grounded_quotes(self):
        from engine import clock
        self.call('registry.set', {'objects': [
            {'object_id': name, 'label': name.replace('_', ' ').capitalize(), 'kind': 'decision', 'attributes': [{'name': 'value', 'type': 'text'}]}
            for name in ('supplier', 'backup_supplier')]})
        identifier = str(uuid.uuid4())
        decisions = {12: ('Beta', 'We decided to use Beta as supplier.'),
                     38: ('Acme', 'We decided to use Acme as supplier.')}
        turns = []
        for index in range(40):
            text = decisions[index][1] if index in decisions else f'Agenda item {index}: ' + 'Background discussion without a decision. ' * 10
            turns.append({'speaker': 'S01', 'start': index * 90, 'end': index * 90 + 60, 'text': text})
        (self.root/'long.md').write_text('\n'.join(f"[{clock(t['start'])}] Maya: {t['text']}" for t in turns))
        workspace_product(self.engine, {'action': 'save_meeting', 'record': {
            'id': identifier, 'title': 'An hour of discussion', 'created': '2026-10-01T10:00:00Z',
            'status': 'transcript-reviewed', 'transcriptPath': 'long.md', 'names': {'S01': 'Maya'}, 'turns': turns}})
        requested = []
        emitted = []
        def generate(prompt):
            transcript = prompt.rsplit('Transcript:\n', 1)[1]
            indices = [int(i) for i in re.findall(r'^\[(\d+)\]', transcript, re.M)]
            requested.append(indices)
            self.assertLessEqual(len(transcript), 7100)
            events = []
            for index in indices:
                if index not in decisions: continue
                value, quote = decisions[index]
                events.append({'turn': index, 'quote': quote, 'object_id': 'supplier' if index == 12 else 'backup_supplier',
                               'attribute': 'value', 'value': value, 'confidence': 1.0})
                emitted.append(index)
            return json.dumps({'events': events})
        with patch('engine.local_generator', return_value=generate):
            self.call('ingest_reviewed_meeting', {'meetingId': identifier})
        self.assertGreater(len(requested), 1)
        self.assertEqual(set().union(*map(set, requested)), set(range(40)))
        self.assertTrue(all(len(set(left) & set(right)) == 6 for left, right in zip(requested, requested[1:])))
        self.assertGreater(emitted.count(12), 1)  # Candidate repeated in the shared context.
        overview = self.call('overview')
        self.assertEqual(len(overview['proposals']), 2)  # Window overlap was deduplicated.
        self.assertEqual(overview['facts'], [])
        for proposal in overview['proposals']:
            self.call('proposals.accept', {'proposal_id': proposal['proposal_id']})
        history = [fact for name in ('supplier', 'backup_supplier')
                   for fact in self.call('facts.history', {'object_id': name, 'attribute': 'value'})]
        self.assertEqual({fact['value'] for fact in history}, {'Beta', 'Acme'})
        evidence = [item for fact in history for item in fact['evidence']]
        self.assertEqual({item['audio_start'] for item in evidence}, {1080, 3420})
        self.assertEqual({item['quote'] for item in evidence}, {quote for _, quote in decisions.values()})
        self.assertTrue(all(item['meeting'] == identifier for item in evidence))
        self.assertTrue(self.call('overview')['check']['ok'])

    def test_later_window_failure_leaves_source_retryable(self):
        identifier = str(uuid.uuid4())
        text = 'Background words. ' * 100
        turns = [{'speaker': 'S01', 'start': i * 60, 'end': i * 60 + 50, 'text': text} for i in range(10)]
        from engine import clock
        (self.root/'retry-long.md').write_text('\n'.join(f"[{clock(t['start'])}] Maya: {t['text']}" for t in turns))
        workspace_product(self.engine, {'action': 'save_meeting', 'record': {
            'id': identifier, 'title': 'Retry long extraction', 'created': '2026-10-01T10:00:00Z',
            'status': 'transcript-reviewed', 'transcriptPath': 'retry-long.md', 'names': {'S01': 'Maya'}, 'turns': turns}})
        with patch('engine.local_generator', return_value=lambda _: '{"events":[]}') as factory:
            calls = 0
            def failing(_):
                nonlocal calls
                calls += 1
                if calls > 1: raise TimeoutError('Later window timed out')
                return '{"events":[]}'
            factory.return_value = failing
            result = temporal_api(self.engine, {'method': 'ingest_reviewed_meeting', 'params': {'meetingId': identifier}})
        self.assertFalse(result['ok'])
        self.assertGreater(calls, 1)
        self.assertEqual(self.call('meetings.list'), [])
        with patch('engine.local_generator', return_value=lambda _: '{"events":[]}'):
            self.call('ingest_reviewed_meeting', {'meetingId': identifier})
        self.assertEqual(len(self.call('meetings.list')), 1)

    def test_strict_ids_queries_and_reasons(self):
        for method, params in [('facts.correct', {'fact_id':True,'value':'Beta','reason':'Fix'}), ('query',{'object_id':'supplier','attribute':'value','type':'unknown'}), ('facts.retract', {'fact_id':1,'reason':''})]:
            self.assertFalse(temporal_api(self.engine, {'method':method,'params':params})['ok'])

    def test_unaligned_trimmed_turn_cannot_become_a_precise_fact_citation(self):
        identifier = str(uuid.uuid4())
        text = 'We decided to use Beta as supplier.'
        (self.root/'trimmed.md').write_text(f'[0:12 · original interval; text timing unresolved] Maya: {text}')
        workspace_product(self.engine, {'action': 'save_meeting', 'record': {'id': identifier, 'title': 'Trimmed', 'status': 'transcript-reviewed', 'transcriptPath': 'trimmed.md', 'created': '2026-10-01T10:00:00Z', 'names': {'S01': 'Maya'}, 'turns': [{'speaker': 'S01', 'start': 12, 'end': 15, 'text': text, 'contextTrimmed': True}]}})
        class NoInference:
            name = 'not-called'
            def extract(self, _context): raise AssertionError('Unaligned source must be rejected before inference')
        result = temporal_api(self.engine, {'method': 'ingest_reviewed_meeting', 'params': {'meetingId': identifier}}, NoInference())
        self.assertFalse(result['ok'])
        self.assertIn('no aligned audio start', result['error']['message'])
        self.assertEqual(self.call('meetings.list'), [])
        self.assertIn('text timing unresolved', (self.root/f'meetings/meeting-{identifier}.md').read_text())


class DraftRepairTests(unittest.TestCase):
    """Deterministic repairs of a small model's extraction draft (UAT demo dry run, 2 November)."""
    def setUp(self):
        from memoria_engine.service import registry_from_json
        self.registry = registry_from_json({'objects': [
            {'object_id': 'budget', 'label': 'Pilot budget (RM)', 'kind': 'decision', 'attributes': [{'name': 'amount', 'type': 'number'}]},
            {'object_id': 'golive', 'label': 'Go-live date', 'kind': 'decision', 'attributes': [{'name': 'date', 'type': 'date'}]},
            {'object_id': 'training', 'label': 'Staff training', 'kind': 'commitment', 'attributes': [{'name': 'owner', 'type': 'text'}, {'name': 'deadline', 'type': 'date'}]}]})

    def test_quoted_amounts(self):
        from temporal_service import quoted_numbers
        self.assertEqual(quoted_numbers('Okay, the pilot budget is 250,000 ringgit.'), {250000})
        self.assertEqual(quoted_numbers('RM2.5 million, not 3m'), {2500000, 3000000})
        self.assertEqual(quoted_numbers('no change to the budget'), set())

    def test_repairs_are_grounded_and_leave_ambiguity_alone(self):
        from temporal_service import repaired
        from memoria_engine.pipeline import Candidate
        fix = lambda *args: repaired(Candidate(*args), self.registry)
        self.assertEqual(fix('budget', 'amount', 2500000, 'Okay, the pilot budget is 250,000 ringgit.').value, 250000)
        self.assertEqual(fix('golive', 'value', '2026-11-09', 'The go-live date is now 9 November 2026.').attribute, 'date')
        self.assertIsNone(fix('budget', 'value', '2800000', 'Good, so no change to the budget.'))
        self.assertEqual(fix('budget', 'amount', 300000, 'Not 300,000 but 280,000.').value, 300000)  # two amounts: validation decides
        self.assertEqual(fix('training', 'value', 'Raj', 'Raj will do it.').attribute, 'value')  # two attributes: not guessed
        self.assertEqual(fix('unknown', 'value', 1, 'x').object_id, 'unknown')
