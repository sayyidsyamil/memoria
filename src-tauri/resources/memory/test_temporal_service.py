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

    def test_amounts_said_in_words_reach_review_with_their_exact_evidence(self):
        from engine import clock
        self.call('registry.set', {'objects': [
            {'object_id': 'prod_cost', 'label': 'Production cost per remote (euro)', 'kind': 'decision', 'attributes': [{'name': 'amount', 'type': 'number'}]},
            {'object_id': 'price', 'label': 'Selling price (euro)', 'kind': 'decision', 'attributes': [{'name': 'amount', 'type': 'number'}]}]})
        identifier = str(uuid.uuid4())
        turns = [{'speaker': speaker, 'start': start, 'end': start + 20, 'text': text} for speaker, start, text in AMI_ES2003A_FINANCE]
        names = {'S01': 'Adam', 'S02': 'Ebenezer'}
        (self.root/'finance.md').write_text('\n'.join(f"[{clock(t['start'])}] {names[t['speaker']]}: {t['text']}" for t in turns))
        workspace_product(self.engine, {'action': 'save_meeting', 'record': {
            'id': identifier, 'title': 'Project finance', 'created': '2026-02-02T09:00:00Z',
            'status': 'transcript-reviewed', 'transcriptPath': 'finance.md', 'names': names, 'turns': turns}})
        with patch('engine.local_generator', return_value=lambda _prompt: AMI_ES2003A_REPLY):
            self.call('ingest_reviewed_meeting', {'meetingId': identifier})
        proposals = self.call('overview')['proposals']
        self.assertEqual(sorted((p['object_id'], p['attribute'], p['value'], p['quote'], p['speaker'], p['meeting']) for p in proposals), [
            ('price', 'amount', 25, 'sell them for twenty five', 'Adam', identifier),
            ('prod_cost', 'amount', 12.5, 'twelve point five Euros per unit', 'Adam', identifier)])
        for proposal in proposals:
            self.call('proposals.accept', {'proposal_id': proposal['proposal_id']})
        evidence = self.call('query', {'type': 'current', 'object_id': 'prod_cost', 'attribute': 'amount'})
        self.assertEqual(evidence['answer'], 12.5)
        self.assertEqual([(item['quote'], item['audio_start']) for item in evidence['evidence']], [('twelve point five Euros per unit', 641.5)])
        self.assertTrue(self.call('overview')['check']['ok'])


# AMI ES2003a (CC BY 4.0), as in research/ledger-engine/data/ami_v0/ES2003.chain, and the 4B model's reply to that window,
# which reads both amounts correctly: production cost 12.5 and selling price 25 (gold events of the chain).
AMI_ES2003A_FINANCE = [
    ('S01', 641.5, "Right. I think we've all managed to master the whiteboard there by looks of it, so, on to it. Project finance. "
                   "As you can see, twelve point five Euros per unit. That's not a terrible lot as far as I'm aware, and we're hoping to "
                   "sell them for twenty five. If we're aiming for fifty million Euros we're gonna have to be selling an awful lot of them."),
    ('S02', 668.0, "Oh, that was profiting, that was an amount, so that's the amount made, okay."),
    ('S01', 671.25, "Yep. Well, fifty million, and if you're making twelve point five Euros on each one, then, awful lot need to be sold.")]
AMI_ES2003A_REPLY = ('{"events":[{"turn":45,"quote":"twelve point five Euros per unit","object_id":"prod_cost","attribute":"amount",'
                     '"value":12.5,"valid_from":null,"confidence":0.9,"unresolved":false},{"turn":45,"quote":"sell them for twenty five",'
                     '"object_id":"price","attribute":"amount","value":25,"valid_from":null,"confidence":0.9,"unresolved":false}]}')


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


class SpokenAmountTests(unittest.TestCase):
    """Amounts said in words (AMI manual transcripts spell them out) confirm the model's own value; they never supply one."""
    def setUp(self):
        from memoria_engine.service import registry_from_json
        self.registry = registry_from_json({'objects': [
            {'object_id': 'prod_cost', 'label': 'Production cost per remote (euro)', 'kind': 'decision', 'attributes': [{'name': 'amount', 'type': 'number'}]},
            {'object_id': 'price', 'label': 'Selling price (euro)', 'kind': 'decision', 'attributes': [{'name': 'amount', 'type': 'number'}]}]})

    def fix(self, value, quote, object_id='price', attribute='amount'):
        from temporal_service import repaired
        return repaired(Candidate(object_id, attribute, value, quote, 45, None, 0.9), self.registry)

    def value(self, value, quote):
        fixed = self.fix(value, quote)
        return None if fixed is None else fixed.value

    def test_amounts_read_correctly_from_words_are_kept_unchanged(self):
        turn = AMI_ES2003A_FINANCE[0][2]
        for object_id, value, quote in [('prod_cost', 12.5, 'twelve point five Euros per unit'), ('price', 25, 'sell them for twenty five'),
                                        ('price', 25, turn), ('price', '25', turn), ('prod_cost', 12.5, turn), ('price', 50000000, turn)]:
            self.assertEqual(self.fix(value, quote, object_id), Candidate(object_id, 'amount', value, quote, 45, None, 0.9))
        renamed = self.fix(25, 'sell them for twenty five', 'price', 'value')
        self.assertEqual((renamed.attribute, renamed.value, renamed.quote), ('amount', 25, 'sell them for twenty five'))

    def test_words_never_supply_or_rescale_a_value(self):
        turn = AMI_ES2003A_FINANCE[0][2]
        for value, quote in [(125, 'twelve point five Euros per unit'), (12.5, 'a hundred and twenty five'), (25000, 'sell them for twenty-five'),
                             (25, 'twenty-five thousand'), (2.5, 'two point five million ringgit'), (30, "we're hoping to sell them for twenty five"),
                             (25, "we're hoping to sell them for thirty"), (37.5, turn), (30, turn), (5, 'twenty five')]:
            self.assertIsNone(self.fix(value, quote), (value, quote))
        for value, quote in [(125, 'a hundred and twenty five'), (25000, 'twenty-five thousand'), (2500000, 'two point five million ringgit'),
                             (150000, 'a hundred and fifty thousand'), (0.05, 'zero point zero five'), (1250, 'one thousand two hundred and fifty')]:
            self.assertEqual(self.value(value, quote), value, quote)

    def test_two_amounts_negation_and_sign(self):
        quote = 'Not three hundred thousand but two hundred and eighty thousand.'
        self.assertEqual(self.value(300000, quote), 300000)  # both are said: validation decides, as for 'Not 300,000 but 280,000.'
        self.assertEqual(self.value(280000, quote), 280000)
        self.assertIsNone(self.fix(2800000, quote))
        self.assertEqual(self.value(-5, 'a change of minus five'), -5)
        self.assertEqual(self.value(-12.5, 'negative twelve point five'), -12.5)
        self.assertIsNone(self.fix(5, 'a change of minus five'))
        self.assertIsNone(self.fix(-5, 'five'))

    def test_ambiguous_phrases_confirm_nothing(self):
        for value, quote in [(25, 'between the age of uh fifteen and twenty five'), (15, 'fifteen and twenty five'),
                             (20, 'twenty to thirty euros'), (30, 'twenty-thirty euros'), (12, 'twelve or thirteen'), (12, 'it costs twelve fifty'),
                             (50, 'it costs twelve fifty'), (1250, 'it costs twelve fifty'), (12.3, 'Uh twelve point three point three.'),
                             (12.33, 'Uh twelve point three point three.'), (25, 'twenty five percent of the market'), (25, 'twenty-five per cent'),
                             (20, 'on the twenty fifth'), (25, 'on the twenty fifth'), (2, 'two and a half million'), (2500000, 'two and a half million'),
                             (2, 'two thirds of it'), (20, 'twenty grand'), (50, 'fifty uh million Euros'), (25, 'twenty twenty five'),
                             (2025, 'twenty twenty five'), (1, "that's the one"), (5, 'five point plan'), (12, 'twelve point fifty'),
                             (1000000, 'half a million'), (1000000, 'three quarters of a million'), (5, 'five by five')]:
            self.assertIsNone(self.fix(value, quote), (value, quote))

    def test_no_amount_or_an_unusable_value_is_dropped(self):
        self.assertIsNone(self.fix(25, 'Good, so no change to the price.'))
        self.assertIsNone(self.fix(25, 'half of the selling price'))
        for value in (float('nan'), float('inf'), -float('inf'), 10 ** 400, None, True, 'twenty five', '', '25-30', [25]):
            self.assertIsNone(self.fix(value, 'sell them for twenty five'), value)

    def test_digit_quotes_behave_as_before(self):
        self.assertEqual(self.value(2500000, 'The pilot price is 250,000 ringgit for two branches.'), 250000)
        self.assertEqual(self.value(300000, 'Not 300,000 but 280,000.'), 300000)
        self.assertEqual(self.value(280000, 'Not 300,000 but two hundred and eighty thousand.'), 280000)  # said in words: not replaced
        self.assertEqual(self.value(2800000, 'Not 300,000 but two hundred and eighty thousand.'), 300000)  # digit rule unchanged
        self.assertIsNone(self.fix(2800000, 'Good, so no change to the price.'))

    def test_spoken_numbers(self):
        from temporal_service import spoken_numbers
        self.assertEqual(spoken_numbers(AMI_ES2003A_FINANCE[0][2]), {12.5, 25, 50000000})
        self.assertEqual(spoken_numbers(AMI_ES2003A_FINANCE[2][2]), {50000000, 12.5})
        self.assertEqual(spoken_numbers("Twenty-five percent of the market to get to two million units. At two million units, we have to have "
                                        "a profit of twenty-five Euro per unit to get to the fifty million unit Eu Euro profit."),
                         {2000000, 25, 50000000})
        self.assertEqual(spoken_numbers('Maybe even slight well oh yeah, pretty much point two Euros, I\'d say.'), {0.2})
        self.assertEqual(spoken_numbers('twenty five, twenty-five Euros'), {25})  # a repeated amount is one amount
        self.assertEqual(spoken_numbers('250,000 ringgit'), set())
