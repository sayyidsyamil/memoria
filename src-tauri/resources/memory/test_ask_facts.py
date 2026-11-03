import tempfile
import unittest
import uuid
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

from engine import Engine, workspace_product
from temporal_service import temporal_api
from memoria_engine.pipeline import Candidate
from memoria_engine.service import registry_from_json
from ask_facts import brief_items, route_question, tracked_answer


def forbidden(prompt):
    raise AssertionError('Tracked-fact answers must not call the language model')


class AskTrackedFactsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.engine = Engine(self.root)
        self.call('registry.set', {'objects': [
            {'object_id': 'pilot', 'label': 'Pilot', 'kind': 'decision', 'attributes': [{'name': 'supplier', 'type': 'text'}]},
            {'object_id': 'launch', 'label': 'Launch', 'kind': 'decision', 'attributes': [{'name': 'date', 'type': 'text'}]}]})

    def tearDown(self):
        self.engine.db.close()
        self.temp.cleanup()

    def call(self, method, params=None, extractor=None):
        with self.engine.locked():
            result = temporal_api(self.engine, {'method': method, 'params': params or {}}, extractor)
        self.assertTrue(result['ok'], result)
        return result['data']

    def meeting(self, value, occurred, title):
        identifier = str(uuid.uuid4())
        text = f'We decided to use {value} as supplier.'
        source = f'source-{identifier}.md'
        (self.root / source).write_text(f'---\ntype: Source\ntitle: "{title} — reviewed transcript"\n---\n# {title} — reviewed transcript\n\n[0:17] Alex Tan: {text}\n')
        workspace_product(self.engine, {'action': 'save_meeting', 'record': {'id': identifier, 'title': title, 'created': occurred,
            'status': 'transcript-reviewed', 'transcriptPath': source, 'names': {'S01': 'Alex Tan'},
            'turns': [{'start': 17.29, 'end': 19.77, 'speaker': 'S01', 'text': text}]}})
        class Extractor:
            name = 'fixture'
            def extract(self, context):
                return [Candidate('pilot', 'supplier', value, text, 0, None, 1.0)]
        self.call('ingest_reviewed_meeting', {'meetingId': identifier}, Extractor())
        self.call('proposals.accept', {'proposal_id': self.call('overview')['proposals'][0]['proposal_id']})
        return identifier

    def two_meetings(self):
        first = self.meeting('Acme', '2026-10-01T05:15:00Z', 'Pilot kickoff')
        second = self.meeting('Beta', '2026-10-20T05:42:00Z', 'Supplier review')
        return first, second

    def ask(self, question):
        with self.engine.locked():
            return self.engine.answer(question, generator=forbidden)

    def test_now_question_without_the_item_name_is_answered_from_the_ledger(self):
        # Observed natively: the wiki answer said "does not answer" although tracked facts held Beta.
        _, second = self.two_meetings()
        result = self.ask('Which supplier do we use now?')
        self.assertEqual(result['source'], 'tracked-facts')
        item = result['sections'][0]['items'][0]
        self.assertTrue(item['text'].startswith('Pilot supplier is Beta (decided '), item['text'])
        evidence = {citation['id']: citation for citation in result['citations']}[item['citations'][0]]
        self.assertEqual(evidence['quote'], 'We decided to use Beta as supplier.')
        self.assertEqual((evidence['moment']['meetingId'], evidence['moment']['meetingTitle']), (second, 'Supplier review'))
        self.assertEqual(evidence['sourceTitle'], 'Supplier review — reviewed transcript')

    def test_change_question_lists_each_value_with_its_evidence(self):
        self.two_meetings()
        items = self.ask('What changed about the supplier?')['sections'][0]['items']
        self.assertEqual(items[0]['text'], 'Pilot supplier changed once: Acme → Beta.')
        self.assertEqual(len(items[0]['citations']), 2)
        self.assertEqual([item['text'].split(' — ')[0] for item in items[1:]], ['Acme', 'Beta'])

    def test_count_and_past_date_questions_use_the_evaluated_router(self):
        self.two_meetings()
        self.assertTrue(self.ask('How many times did the pilot supplier change?')['sections'][0]['items'][0]['text'].endswith('changed once: Acme → Beta.'))
        past = self.ask('What was the pilot supplier on 10 October 2026?')['sections'][0]['items'][0]
        self.assertTrue(past['text'].startswith('On 10 Oct 2026, Pilot supplier was Acme'), past['text'])
        before = self.ask('What was the pilot supplier on 20 September 2026?')['sections'][0]['items'][0]
        self.assertEqual((before['text'], before['citations'], before['noEvidence']), ('Pilot supplier had no recorded value on 20 Sep 2026.', [], True))

    def test_other_questions_stay_with_the_wiki(self):
        self.two_meetings()
        registry = registry_from_json({'objects': [{'object_id': 'pilot', 'label': 'Pilot', 'kind': 'decision', 'attributes': [{'name': 'supplier', 'type': 'text'}]}]})
        today = date(2026, 11, 2)
        self.assertIsNone(route_question(registry, 'Which supplier did we decide to use?', today))  # attribute only, no time
        self.assertIsNone(route_question(registry, 'What did we discuss about the pilot?', today))  # topic question
        self.assertEqual(route_question(registry, 'What is the pilot supplier?', today)['type'], 'current')
        self.assertIsNone(route_question(registry, 'What is the weather now?', today))
        self.assertIsNone(tracked_answer(self.engine, 'When is the launch date now?'))  # tracked slot without approved facts
        self.assertEqual(self.ask('Which supplier did we decide to use?')['message'],
                         'No reviewed evidence yet. Build knowledge from a source and save its changes first.')
        with self.engine.locked():  # one meeting's questions and saved briefs cite its approved claims only
            scoped = self.engine.answer('Which supplier do we use now?', generator=forbidden, scope=['source.md'])
            brief = self.engine.answer('Which supplier do we use now?', brief=True, generator=forbidden)
        self.assertNotEqual(scoped.get('source'), 'tracked-facts')
        self.assertNotEqual(brief.get('source'), 'tracked-facts')

    def test_unreadable_tracked_facts_fall_back_with_a_warning(self):
        (self.root / '.memoria-memory' / 'temporal' / 'registry.json').write_text('{broken')
        result = self.ask('Which supplier do we use now?')
        self.assertIn('Tracked facts were not consulted', ' '.join(result['warnings']))


class BriefTrackedFactsTests(AskTrackedFactsTests):
    """Open commitments and recent changes in a meeting brief come from approved tracked facts."""
    def setUp(self):
        super().setUp()
        self.call('registry.set', {'objects': [
            {'object_id': 'pilot', 'label': 'Pilot', 'kind': 'decision', 'attributes': [{'name': 'supplier', 'type': 'text'}]},
            {'object_id': 'launch', 'label': 'Launch', 'kind': 'decision', 'attributes': [{'name': 'date', 'type': 'text'}]},
            {'object_id': 'training', 'label': 'Staff training', 'kind': 'commitment', 'attributes': [
                {'name': 'owner', 'type': 'text'}, {'name': 'deadline', 'type': 'date'}, {'name': 'status', 'type': 'enum', 'values': ['done', 'cancelled']}]},
            {'object_id': 'security', 'label': 'Security review', 'kind': 'commitment', 'attributes': [
                {'name': 'owner', 'type': 'text'}, {'name': 'status', 'type': 'enum', 'values': ['done', 'cancelled']}]}]})

    def facts_meeting(self, title, occurred, facts):
        identifier = str(uuid.uuid4())
        source = f'source-{identifier}.md'
        turns = [{'start': 5.0 * index, 'end': 5.0 * index + 4, 'speaker': 'S01', 'text': sentence} for index, (_, _, _, sentence) in enumerate(facts)]
        body = '\n\n'.join(f"[0:{5 * index:02d}] Aisha: {turn['text']}" for index, turn in enumerate(turns))
        (self.root / source).write_text(f'---\ntype: Source\ntitle: "{title} — reviewed transcript"\n---\n# {title} — reviewed transcript\n\n{body}\n')
        workspace_product(self.engine, {'action': 'save_meeting', 'record': {'id': identifier, 'title': title, 'created': occurred,
            'status': 'transcript-reviewed', 'transcriptPath': source, 'names': {'S01': 'Aisha'}, 'turns': turns}})
        class Extractor:
            name = 'fixture'
            def extract(self, context):
                return [Candidate(obj, attribute, value, sentence, index, None, 1.0) for index, (obj, attribute, value, sentence) in enumerate(facts)]
        self.call('ingest_reviewed_meeting', {'meetingId': identifier}, Extractor())
        for proposal in self.call('overview')['proposals']:
            self.call('proposals.accept', {'proposal_id': proposal['proposal_id']})

    def test_a_brief_lists_open_commitments_and_recent_changes_with_their_quotes(self):
        self.two_meetings()
        self.facts_meeting('Training plan', '2026-10-21T02:00:00Z', [
            ('training', 'owner', 'Aisha', 'I will coordinate training myself.'),
            ('training', 'deadline', '2026-11-03', 'Training is finished by 3 November.'),
            ('security', 'owner', 'Wei Ling', 'Wei Ling owns the security review.'),
            ('security', 'status', 'done', 'The security review is done.')])
        with self.engine.locked():
            brief = self.engine.answer('Next steering committee', brief=True, generator=forbidden)
        sections = {section['heading']: section['items'] for section in brief['sections']}
        self.assertEqual([item['text'] for item in sections['Open commitments']], ['Staff training: owner Aisha; due 3 Nov 2026.'])
        self.assertEqual([item['text'].split(' (decided')[0] for item in sections['Recent updates']], ['Pilot supplier changed from Acme to Beta'])
        cited = {citation['id']: citation for citation in brief['citations']}
        quotes = [cited[ref]['quote'] for ref in sections['Recent updates'][0]['citations']]
        self.assertEqual(quotes, ['We decided to use Acme as supplier.', 'We decided to use Beta as supplier.'])
        self.assertTrue(all(cited[ref]['kind'] == 'tracked-fact' for item in sections['Open commitments'] for ref in item['citations']))

    def test_a_saved_brief_keeps_tracked_quotes_and_refuses_a_retracted_fact(self):
        self.two_meetings()
        with self.engine.locked():
            brief = self.engine.answer('Pilot', brief=True, generator=forbidden)
            saved = workspace_product(self.engine, {'action': 'save_brief', 'id': str(uuid.uuid4()), 'topic': 'Pilot', 'result': brief})
        page = (self.root / saved['pagePath']).read_text()
        self.assertIn('Pilot supplier changed from Acme to Beta', page)
        self.assertIn('> We decided to use Beta as supplier.', page)
        beta = next(fact for fact in self.call('facts.history', {'object_id': 'pilot', 'attribute': 'supplier'}) if fact['value'] == 'Beta')
        self.call('facts.retract', {'fact_id': beta['fact_id'], 'reason': 'Recorded in error'})
        with self.engine.locked(), self.assertRaisesRegex(ValueError, 'no longer approved'):
            workspace_product(self.engine, {'action': 'save_brief', 'id': str(uuid.uuid4()), 'topic': 'Pilot', 'result': brief})

    def test_nothing_tracked_means_no_tracked_sections(self):
        self.assertIsNone(brief_items(self.engine))

    reason = 'The chair confirmed the recorded owner should be Raj.'
    deadline_quote = 'I will move training to 3 November. I stay the owner.'

    def corrected_training(self, all_manual=False):
        self.facts_meeting('Training plan', '2026-10-21T02:00:00Z', [
            ('training', 'owner', 'Aisha', 'I will coordinate training myself.'),
            ('training', 'deadline', '2026-11-03', self.deadline_quote)])
        original = self.call('facts.history', {'object_id': 'training', 'attribute': 'owner'})[0]
        corrected = self.call('facts.correct', {'fact_id': original['fact_id'], 'value': 'Raj', 'reason': self.reason})
        if all_manual:
            deadline = self.call('facts.history', {'object_id': 'training', 'attribute': 'deadline'})[0]
            self.call('facts.correct', {'fact_id': deadline['fact_id'], 'value': '2026-11-05', 'reason': 'The chair corrected the due date to 5 November.'})
        return original, corrected['fact_id']

    def brief(self):
        with self.engine.locked():
            return self.engine.answer('Next steering committee', brief=True, generator=forbidden)

    def save_brief(self, result):
        with self.engine.locked():
            return workspace_product(self.engine, {'action': 'save_brief', 'id': str(uuid.uuid4()), 'topic': 'Training', 'result': result})

    def test_corrected_current_answer_uses_the_reviewers_reason_not_wiki_or_an_inherited_quote(self):
        original, corrected = self.corrected_training()
        result = self.ask('Who owns staff training now?')
        self.assertEqual(result['source'], 'tracked-facts')
        text = result['sections'][0]['items'][0]['text']
        self.assertIn('Staff training owner is Raj (corrected by you; correction recorded ', text)
        self.assertNotIn('decided', text)
        self.assertEqual(len(result['citations']), 1)
        manual = result['citations'][0]
        self.assertEqual((manual['kind'], manual['factId']), ('manual-correction', corrected))
        self.assertEqual(manual['correction'], {'reviewer': 'user', 'reason': self.reason, 'replaced_fact_id': original['fact_id']})
        self.assertEqual((manual['decidedAt'], manual['claimFrom']), (original['decided_at'], original['claim_from']))
        self.assertGreater(manual['recordedAt'], manual['decidedAt'])
        self.assertNotIn('quote', manual)
        self.assertNotIn('moment', manual)
        self.assertNotIn('sourcePath', manual)
        self.assertEqual(len(manual['originalContext']), 1)
        self.assertTrue((self.root / manual['originalContext'][0]['sourcePath']).is_file())
        from live_ask import live_ask
        live = live_ask(self.engine, {'question': 'Who owns staff training now?'}, generator=forbidden)
        self.assertEqual(live['sections'], result['sections'])
        self.assertEqual(live['citations'], result['citations'])

    def test_mixed_brief_discloses_each_field_and_saves_all_fact_dependencies(self):
        _, corrected = self.corrected_training()
        result = self.brief()
        commitment = next(section for section in result['sections'] if section['heading'] == 'Open commitments')['items'][0]
        self.assertEqual(commitment['text'], 'Staff training: owner Raj; due 3 Nov 2026.')
        by_id = {citation['id']: citation for citation in result['citations']}
        sources = [by_id[ref] for ref in commitment['citations']]
        self.assertEqual([source['kind'] for source in sources], ['manual-correction', 'tracked-fact'])
        self.assertEqual([source['attribute'] for source in sources], ['owner', 'deadline'])
        self.assertEqual(sources[0]['correction']['reason'], self.reason)
        self.assertEqual(sources[1]['quote'], self.deadline_quote)
        updates = next(section for section in result['sections'] if section['heading'] == 'Recent updates')['items']
        self.assertEqual(len(updates), 1)
        self.assertIn('Staff training owner was corrected to Raj', updates[0]['text'])
        self.assertNotIn('decided', updates[0]['text'])
        self.assertTrue(all(by_id[ref]['kind'] == 'manual-correction' for ref in updates[0]['citations']))

        saved = self.save_brief(result)
        self.assertEqual({dep['factId'] for dep in saved['factDependencies']}, {source['factId'] for source in sources})
        self.assertTrue(all(dep['requiresCurrent'] for dep in saved['factDependencies']))
        page = (self.root / saved['pagePath']).read_text()
        self.assertIn('Manual correction by you', page)
        self.assertIn(f'Reason: {self.reason}', page)
        self.assertIn('Correction recorded:', page)
        self.assertIn('Original claim date:', page)
        self.assertIn('Original context only (not evidence for the corrected value):', page)
        self.assertIn(f'> {self.deadline_quote}', page)
        self.assertNotIn('> I will coordinate training myself.', page)
        self.assertNotIn(f'> {self.reason}', page)
        self.call('facts.retract', {'fact_id': corrected, 'reason': 'Recorded in error'})
        with self.assertRaisesRegex(ValueError, 'no longer approved'):
            self.save_brief(result)

    def test_all_manual_commitment_is_answerable_and_saveable_without_a_transcript_quote(self):
        self.corrected_training(all_manual=True)
        result = self.brief()
        commitment = next(section for section in result['sections'] if section['heading'] == 'Open commitments')['items'][0]
        self.assertEqual(commitment['text'], 'Staff training: owner Raj; due 5 Nov 2026.')
        self.assertEqual(len(commitment['citations']), 2)
        self.assertTrue(all(citation['kind'] == 'manual-correction' and 'quote' not in citation for citation in result['citations']))
        saved = self.save_brief(result)
        self.assertEqual({dep['attribute'] for dep in saved['factDependencies']}, {'owner', 'deadline'})
        self.assertNotIn('\n> ', (self.root / saved['pagePath']).read_text())

    def test_manual_provenance_cannot_be_forged_and_quoted_dependencies_still_require_their_source(self):
        self.corrected_training()
        result = self.brief()
        forged = deepcopy(result)
        manual = next(citation for citation in forged['citations'] if citation['kind'] == 'manual-correction')
        manual['correction']['reason'] = 'A model invented this reason.'
        with self.assertRaisesRegex(ValueError, 'no longer approved'):
            self.save_brief(forged)
        forged = deepcopy(result)
        quote = next(citation for citation in forged['citations'] if citation['kind'] == 'tracked-fact')
        quote.update(kind='manual-correction')  # A type tag is not permission to skip the transcript check.
        with self.assertRaisesRegex(ValueError, 'no longer approved'):
            self.save_brief(forged)
        source = self.root / next(citation for citation in result['citations'] if citation['kind'] == 'tracked-fact')['sourcePath']
        source.write_text(source.read_text().replace(self.deadline_quote, 'An edited transcript.'))
        with self.assertRaisesRegex(ValueError, 'evidence changed'):
            self.save_brief(result)

    def test_a_current_brief_dependency_must_still_be_current_even_without_retraction(self):
        self.corrected_training()
        result = self.brief()
        old = next(citation for citation in result['citations'] if citation['kind'] == 'tracked-fact')
        self.facts_meeting('Later plan', '2026-10-25T02:00:00Z', [
            ('training', 'deadline', '2026-11-06', 'Training is finished by 6 November.')])
        history = self.call('facts.history', {'object_id': 'training', 'attribute': 'deadline'})
        self.assertFalse(next(fact for fact in history if fact['fact_id'] == old['factId'])['retracted'])
        with self.assertRaisesRegex(ValueError, 'no longer approved'):
            self.save_brief(result)

    def recorded_answer(self, object_id, attribute, valid_at, tx):
        seconds, micros = divmod(tx, 1_000_000)
        cutoff = datetime.fromtimestamp(seconds, timezone.utc).replace(microsecond=micros).isoformat()
        # The production router accepts ISO dates. A precise cutoff tests the ledger boundary without sleeps.
        route = {'type': 'as_of_tx', 'object_id': object_id, 'attribute': attribute, 'valid_at': valid_at, 'tx_at': cutoff}
        with patch('ask_facts.route_question', return_value=route):
            return self.ask('What did the records say at this cutoff?')

    def test_corrected_history_and_asof_keep_original_beliefs_at_transaction_cutoffs(self):
        self.two_meetings()
        beta = self.call('facts.history', {'object_id': 'pilot', 'attribute': 'supplier'})[-1]
        corrected = self.call('facts.correct', {'fact_id': beta['fact_id'], 'value': 'Gamma', 'reason': 'The chair corrected the supplier.', 'reviewer': 'Maya'})
        history = self.call('facts.history', {'object_id': 'pilot', 'attribute': 'supplier'})
        correction_tx = next(fact for fact in history if fact['fact_id'] == beta['fact_id'])['retracted']['tx']

        early = self.ask('What was the pilot supplier on 10 October 2026?')
        self.assertIn('was Acme (decided ', early['sections'][0]['items'][0]['text'])
        latest = self.ask('What was the pilot supplier on 25 October 2026?')
        self.assertIn('was Gamma (corrected by Maya;', latest['sections'][0]['items'][0]['text'])
        self.assertEqual(latest['citations'][0]['kind'], 'manual-correction')
        recorded_before = self.recorded_answer('pilot', 'supplier', '2026-10-25', correction_tx - 1)
        self.assertIn('was Beta (decided ', recorded_before['sections'][0]['items'][0]['text'])
        self.assertEqual(recorded_before['citations'][0]['quote'], 'We decided to use Beta as supplier.')
        recorded_after = self.recorded_answer('pilot', 'supplier', '2026-10-25', correction_tx)
        self.assertEqual(recorded_after['citations'][0]['factId'], corrected['fact_id'])
        self.assertEqual(recorded_after['citations'][0]['kind'], 'manual-correction')

        result = self.ask('What changed about the supplier?')
        items = result['sections'][0]['items']
        self.assertEqual(items[0]['text'], 'In the corrected record, Pilot supplier changed once: Acme → Gamma.')
        self.assertIn('Gamma — corrected by Maya;', items[-1]['text'])
        self.assertNotIn('decided', items[-1]['text'])
        self.assertEqual([citation.get('quote') for citation in result['citations']], ['We decided to use Acme as supplier.', None])
        # Even if no belief survives today, an as-recorded question must still find its earlier source.
        for fact in history:
            if not fact['retracted']:
                self.call('facts.retract', {'fact_id': fact['fact_id'], 'reason': 'Withdrawn after review'})
        self.assertEqual(self.recorded_answer('pilot', 'supplier', '2026-10-25', correction_tx - 1)['citations'][0]['factId'], beta['fact_id'])

    def test_as_recorded_between_two_corrections_keeps_that_reviewers_reason(self):
        original, raj = self.corrected_training()
        first_history = self.call('facts.history', {'object_id': 'training', 'attribute': 'owner'})
        first_tx = next(fact for fact in first_history if fact['fact_id'] == original['fact_id'])['retracted']['tx']
        self.call('facts.correct', {'fact_id': raj, 'value': 'Wei Ling', 'reason': 'A second correction.', 'reviewer': 'Maya'})
        old = self.recorded_answer('training', 'owner', '2026-10-25', first_tx)
        self.assertIn('was Raj (corrected by you;', old['sections'][0]['items'][0]['text'])
        self.assertEqual(old['citations'][0]['correction']['reason'], self.reason)
        current = self.ask('Who owns staff training now?')
        self.assertIn('is Wei Ling (corrected by Maya;', current['sections'][0]['items'][0]['text'])
        self.assertEqual(current['citations'][0]['correction']['reason'], 'A second correction.')

    def test_a_manual_history_citation_cannot_also_source_an_unavailable_earlier_value(self):
        first, _ = self.two_meetings()
        beta = self.call('facts.history', {'object_id': 'pilot', 'attribute': 'supplier'})[-1]
        self.call('facts.correct', {'fact_id': beta['fact_id'], 'value': 'Gamma', 'reason': 'Supplier correction.'})
        (self.root / f'source-{first}.md').unlink()
        result = self.ask('What changed about the supplier?')
        self.assertEqual(len(result['sections'][0]['items']), 1)
        self.assertTrue(result['sections'][0]['items'][0]['text'].startswith('Gamma — corrected by you;'))
        self.assertEqual(result['warnings'], ['Some historical sources are unavailable; only cited values are shown.'])


class RouteQuestionTests(unittest.TestCase):
    def test_an_item_named_in_full_wins_a_tie_against_a_longer_shared_word(self):
        # Ties in named label words went to the longest word, so the subject a question mentions in passing
        # ("project") sent "What is the project budget now?" to the project timeline.
        registry = registry_from_json({'objects': [
            {'object_id': 'timeline', 'label': 'Project timeline', 'kind': 'decision', 'attributes': [{'name': 'end', 'type': 'date'}]},
            {'object_id': 'budget', 'label': 'Budget', 'kind': 'decision', 'attributes': [{'name': 'amount', 'type': 'number'}]},
            {'object_id': 'vendor', 'label': 'Vendor', 'kind': 'decision', 'attributes': [{'name': 'outcome', 'type': 'text'}]},
            {'object_id': 'vendor_contract', 'label': 'Vendor contract', 'kind': 'decision', 'attributes': [{'name': 'term', 'type': 'text'}]}]})
        today = date(2026, 11, 2)
        now = route_question(registry, 'What is the project budget now?', today)
        self.assertEqual((now['object_id'], now['attribute'], now['type']), ('budget', 'amount', 'current'))
        self.assertEqual(route_question(registry, 'How many times has the project budget changed?', today)['type'], 'n_changes')
        self.assertEqual(route_question(registry, 'How many times has the project budget changed?', today)['object_id'], 'budget')
        self.assertEqual(route_question(registry, 'What is the project timeline now?', today)['object_id'], 'timeline')
        # Only a tie is broken: more named label words still win over a short label named in full.
        self.assertEqual(route_question(registry, 'Which vendor contract do we use now?', today)['object_id'], 'vendor_contract')




class ModelRouterTests(unittest.TestCase):
    """The app routes typed questions with the evaluated language-model router when its worker is available."""

    def registry(self):
        from memoria_engine.service import registry_from_json
        return registry_from_json({'objects': [
            {'object_id': 'budget', 'label': 'Pilot budget (RM)', 'kind': 'decision', 'attributes': [{'name': 'amount', 'type': 'number'}]},
            {'object_id': 'training', 'label': 'Staff training', 'kind': 'commitment', 'attributes': [{'name': 'owner', 'type': 'text'}]}],
            'people': {}})

    def test_the_model_route_is_used_when_valid(self):
        from datetime import date
        reply = '{"type":"as_of_valid","object_id":"budget","attribute":"amount","valid_at":"2026-09-27","tx_at":null}'
        route = route_question(self.registry(), 'How much money did the pilot have on 27 September?', date(2026, 11, 2), lambda prompt: reply)
        self.assertEqual((route['type'], route['object_id'], route['valid_at']), ('as_of_valid', 'budget', '2026-09-27'))

    def test_no_tracked_item_goes_to_knowledge_and_a_bad_reply_falls_back_to_rules(self):
        from datetime import date
        today = date(2026, 11, 2)
        none = '{"type":"current","object_id":null,"attribute":null,"valid_at":null,"tx_at":null}'
        self.assertIsNone(route_question(self.registry(), 'What did we discuss about catering?', today, lambda prompt: none))
        route = route_question(self.registry(), 'Who owns staff training now?', today, lambda prompt: 'no json here')
        self.assertEqual((route['object_id'], route['attribute']), ('training', 'owner'))

    def test_questions_about_what_was_said_go_to_knowledge_even_if_an_item_is_named(self):
        from datetime import date
        reply = '{"type":"current","object_id":"budget","attribute":"amount","valid_at":null,"tx_at":null}'
        today = date(2026, 11, 2)
        self.assertIsNone(route_question(self.registry(), 'What did we discuss about the pilot budget?', today, lambda prompt: reply))
        self.assertEqual(route_question(self.registry(), 'What is the pilot budget now?', today, lambda prompt: reply)['type'], 'current')

    def test_an_item_with_one_attribute_needs_no_attribute_in_the_reply(self):
        from datetime import date
        reply = '{"type":"n_changes","object_id":"budget","attribute":null,"valid_at":null,"tx_at":null}'
        route = route_question(self.registry(), 'How often has the budget moved?', date(2026, 11, 2), lambda prompt: reply)
        self.assertEqual((route['type'], route['object_id'], route['attribute']), ('n_changes', 'budget', 'amount'))

    def test_who_and_when_pick_the_owner_and_the_only_date(self):
        from datetime import date
        from memoria_engine.service import registry_from_json
        registry = registry_from_json({'objects': [{'object_id': 'training', 'label': 'Staff training', 'kind': 'commitment',
            'attributes': [{'name': 'owner', 'type': 'text'}, {'name': 'deadline', 'type': 'date'}, {'name': 'status', 'type': 'enum', 'values': ['done', 'cancelled']}]}], 'people': {}})
        reply = '{"type":"current","object_id":"training","attribute":null,"valid_at":null,"tx_at":null}'
        today = date(2026, 11, 2)
        self.assertEqual(route_question(registry, 'Who is doing the staff training?', today, lambda prompt: reply)['attribute'], 'owner')
        self.assertEqual(route_question(registry, 'When will the staff training happen?', today, lambda prompt: reply)['attribute'], 'deadline')

    def test_answers_name_the_slot_plainly_and_show_the_unit(self):
        from ask_facts import shown_in, subject
        self.assertEqual(subject('Pilot budget (RM)', 'amount'), 'Pilot budget')
        self.assertEqual(subject('Staff training', 'owner'), 'Staff training owner')
        self.assertEqual(shown_in(280000, 'Pilot budget (RM)'), 'RM 280,000')
        self.assertEqual(shown_in('Beta Cloud', 'Vendor'), 'Beta Cloud')
        self.assertEqual((subject('Selling price (euro)', 'value'), shown_in(25, 'Selling price (euro)')), ('Selling price', 'euro 25'))

if __name__ == '__main__':
    unittest.main()


class DirectRouteTests(unittest.TestCase):
    """Live Ask's instant fallback for a question naming one tracked item in full."""

    def registry(self):
        from types import SimpleNamespace as N
        attribute = lambda name, kind='text': N(name=name, type=kind)
        return N(objects={
            'pilot_budget': N(object_id='pilot_budget', label='Pilot budget (RM)', attributes=[attribute('amount', 'number')]),
            'data_migration': N(object_id='data_migration', label='Data migration',
                                attributes=[attribute('owner', 'person'), attribute('deadline', 'date')]),
            'vendor': N(object_id='vendor', label='Vendor', attributes=[attribute('choice')])})

    def test_the_item_named_in_full_gives_its_fitting_attribute(self):
        from ask_facts import direct_route
        registry = self.registry()
        self.assertEqual(direct_route(registry, 'What is the pilot budget?')['object_id'], 'pilot_budget')
        self.assertEqual(direct_route(registry, 'Who owns the data migration?')['attribute'], 'owner')
        self.assertEqual(direct_route(registry, 'When is the data migration due?')['attribute'], 'deadline')
        self.assertEqual(direct_route(registry, 'Which vendor?')['type'], 'current')

    def test_topics_histories_and_unclear_questions_are_left_alone(self):
        from ask_facts import direct_route
        registry = self.registry()
        for question in ('What did we discuss about the vendor?', 'How has the pilot budget changed?',
                         'What about the data migration?', 'What is the weather?'):
            self.assertIsNone(direct_route(registry, question), question)
