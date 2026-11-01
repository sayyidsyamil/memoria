import tempfile
import unittest
import uuid
from unittest.mock import patch
from pathlib import Path
from engine import Engine
from meetings_service import meeting_api, MeetingRepository


class MeetingApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.engine = Engine(self.directory.name)

    def tearDown(self):
        self.engine.db.close()
        self.directory.cleanup()

    def test_crud_contract_and_restart(self):
        identifier = str(uuid.uuid4())
        with self.engine.locked():
            saved = meeting_api(self.engine, {'operation': 'save', 'record': {'id': identifier, 'title': 'Pilot', 'status': 'needs-review'}})
        self.assertTrue(saved['ok'])
        self.engine.db.close()
        self.engine = Engine(self.directory.name)
        self.assertEqual(meeting_api(self.engine, {'operation': 'get', 'id': identifier})['data']['title'], 'Pilot')
        self.assertEqual(len(meeting_api(self.engine, {'operation': 'list'})['data']), 1)
        self.assertTrue(meeting_api(self.engine, {'operation': 'delete', 'id': identifier})['data']['deleted'])
        self.assertEqual(meeting_api(self.engine, {'operation': 'get', 'id': identifier})['error']['code'], 'MEETING_NOT_FOUND')

    def test_invalid_inputs_have_stable_errors(self):
        self.assertEqual(meeting_api(self.engine, {'operation': 'delete', 'id': '../outside'})['error']['code'], 'INVALID_REQUEST')
        result = meeting_api(self.engine, {'operation': 'save', 'record': {'id': str(uuid.uuid4()), 'status': 'needs-review', 'turns': [{'start': float('nan'), 'end': 2, 'text': 'Text', 'speaker': 'one'}]}})
        self.assertEqual(result['error']['code'], 'INVALID_REQUEST')

    def test_failed_database_save_restores_the_previous_document(self):
        identifier = str(uuid.uuid4())
        request = {'operation': 'save', 'record': {'id': identifier, 'title': 'Original', 'status': 'needs-review'}}
        saved = meeting_api(self.engine, request)['data']
        document = Path(self.directory.name) / saved['pagePath']
        original = document.read_text()
        with patch.object(MeetingRepository, 'save', side_effect=RuntimeError('Database unavailable')):
            failed = meeting_api(self.engine, {'operation': 'save', 'record': {**request['record'], 'title': 'Changed'}})
        self.assertEqual(failed['error']['code'], 'PERSISTENCE_FAILED')
        self.assertEqual(document.read_text(), original)
        self.assertEqual(meeting_api(self.engine, {'operation': 'get', 'id': identifier})['data']['title'], 'Original')

    def test_external_edits_have_a_conflict_code(self):
        identifier = str(uuid.uuid4())
        saved = meeting_api(self.engine, {'operation': 'save', 'record': {'id': identifier, 'title': 'Original', 'status': 'needs-review'}})['data']
        document = Path(self.directory.name) / saved['pagePath']
        document.write_text(document.read_text() + '\nExternal annotation\n')
        self.assertEqual(meeting_api(self.engine, {'operation': 'delete', 'id': identifier})['error']['code'], 'MEETING_EXTERNALLY_MODIFIED')
