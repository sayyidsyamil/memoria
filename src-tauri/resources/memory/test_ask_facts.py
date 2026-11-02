import tempfile
import unittest
import uuid
from datetime import date
from pathlib import Path

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
