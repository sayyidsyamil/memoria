import tempfile
import unittest
import uuid
from pathlib import Path
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

    def test_strict_ids_queries_and_reasons(self):
        for method, params in [('facts.correct', {'fact_id':True,'value':'Beta','reason':'Fix'}), ('query',{'object_id':'supplier','attribute':'value','type':'unknown'}), ('facts.retract', {'fact_id':1,'reason':''})]:
            self.assertFalse(temporal_api(self.engine, {'method':method,'params':params})['ok'])
