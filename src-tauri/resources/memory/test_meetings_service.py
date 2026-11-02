import json
import signal
import subprocess
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch
from pathlib import Path
from engine import Engine, digest
from meetings_service import meeting_api, MeetingRepository


class MeetingApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.engine = Engine(self.directory.name)

    def tearDown(self):
        self.engine.db.close()
        self.directory.cleanup()

    def call(self, operation, identifier=None, **record):
        """The meeting API as the app calls it: save takes record fields; get and delete take an id."""
        request = {'operation': operation, 'id': identifier}
        if operation == 'save': request = {'operation': 'save', 'record': {'id': identifier, 'status': 'needs-review', **record}}
        return meeting_api(self.engine, request)

    def page(self, identifier):
        return Path(self.directory.name) / f'meetings/meeting-{identifier}.md'

    def intents(self):
        return self.engine.db.execute('SELECT id FROM meeting_intents').fetchall()

    def restart(self):
        self.engine.db.close()
        self.engine = Engine(self.directory.name)

    def kill(self, after, operation, identifier, **record):
        """Run an operation in a process that dies right after `after`, then reopen the vault as a new process would.
        'intent': the intent is committed, the page untouched. 'page': the page changed, the record did not.
        SystemExit, unlike an Exception, skips the in-process rollback, as a kill does."""
        step = 'intend' if after == 'intent' else operation
        real = getattr(MeetingRepository, step)
        def killed(*args, **kwargs):
            if after == 'intent': real(*args, **kwargs)
            raise SystemExit
        with patch.object(MeetingRepository, step, killed), self.assertRaises(SystemExit):
            self.call(operation, identifier, **record)
        self.restart()

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

    def test_normal_writes_leave_no_pending_intent(self):
        identifier = str(uuid.uuid4())
        self.call('save', identifier, title='One')
        self.call('save', identifier, title='Two')
        self.assertEqual(self.intents(), [])
        self.assertTrue(self.call('delete', identifier)['data']['deleted'])
        self.assertEqual(self.intents(), [])

    def test_save_killed_after_the_page_write_completes_on_next_access(self):
        identifier = str(uuid.uuid4())
        self.call('save', identifier, title='Original')
        self.kill('page', 'save', identifier, title='Changed')
        # The window: the page is ahead of its record, which still carries the old hash.
        stale = json.loads(self.engine.db.execute('SELECT record FROM meetings WHERE id=?', (identifier,)).fetchone()[0])
        self.assertEqual((stale['title'], len(self.intents())), ('Original', 1))
        self.assertIn('Changed', self.page(identifier).read_text())
        self.assertNotEqual(stale['pageHash'], digest(self.page(identifier).read_text()))
        record = self.call('get', identifier)['data']
        self.assertEqual((record['title'], record['pageHash'], self.intents()), ('Changed', digest(self.page(identifier).read_text()), []))
        later = self.call('save', identifier, title='Later')
        self.assertTrue(later['ok'], later)
        self.assertIn('Later', self.page(identifier).read_text())

    def test_first_save_killed_after_the_page_write_is_completed_by_list(self):
        identifier = str(uuid.uuid4())
        self.kill('page', 'save', identifier, title='Fresh')
        self.assertEqual(self.engine.db.execute('SELECT COUNT(*) FROM meetings').fetchone()[0], 0)
        self.assertTrue(self.page(identifier).exists())
        self.assertEqual([item['title'] for item in self.call('list')['data']], ['Fresh'])
        self.assertEqual(self.intents(), [])

    def test_search_and_ask_record_reads_settle_an_interrupted_save(self):
        from engine import meeting_records
        identifier = str(uuid.uuid4())
        self.call('save', identifier, title='Original')
        self.kill('page', 'save', identifier, title='Changed')
        self.assertEqual([record['title'] for record in meeting_records(self.engine)], ['Changed'])
        self.assertEqual(self.intents(), [])

    def test_save_that_leaves_the_page_unchanged_is_still_completed(self):
        identifier = str(uuid.uuid4())
        self.call('save', identifier, title='Pilot')
        self.kill('page', 'save', identifier, title='Pilot', names={'S01': 'Maya'})  # names are not rendered without turns
        self.assertEqual(self.call('get', identifier)['data']['names'], {'S01': 'Maya'})

    def test_save_killed_before_the_page_write_is_discarded(self):
        identifier, fresh = str(uuid.uuid4()), str(uuid.uuid4())
        self.call('save', identifier, title='Original')
        original = self.page(identifier).read_text()
        self.kill('intent', 'save', identifier, title='Changed')
        self.assertEqual((len(self.intents()), self.page(identifier).read_text()), (1, original))
        self.assertEqual(self.call('get', identifier)['data']['title'], 'Original')
        self.assertEqual((self.intents(), self.page(identifier).read_text()), ([], original))
        self.assertTrue(self.call('save', identifier, title='Later')['ok'])
        self.kill('intent', 'save', fresh, title='Never written')
        self.assertEqual([item['title'] for item in self.call('list')['data']], ['Later'])
        self.assertEqual((self.page(fresh).exists(), self.intents()), (False, []))
        self.assertTrue(self.call('save', fresh, title='Written')['ok'])

    def test_external_edit_with_a_pending_intent_is_preserved_and_still_protected(self):
        for after, operation, record in (('intent', 'save', {'title': 'Changed'}), ('page', 'save', {'title': 'Changed'}), ('page', 'delete', {})):
            with self.subTest(after=after, operation=operation):
                identifier = str(uuid.uuid4())
                self.call('save', identifier, title='Original')
                self.kill(after, operation, identifier, **record)
                self.assertEqual(len(self.intents()), 1)
                self.page(identifier).write_text('External annotation\n')  # matches neither the before nor the after state
                self.assertEqual(self.call('get', identifier)['data']['title'], 'Original')
                self.assertEqual(self.intents(), [])
                for guarded in (self.call('save', identifier, title='Again'), self.call('delete', identifier)):
                    self.assertEqual(guarded['error']['code'], 'MEETING_EXTERNALLY_MODIFIED')
                self.assertEqual(self.page(identifier).read_text(), 'External annotation\n')

    def test_a_page_that_is_not_text_is_left_alone_when_an_intent_is_pending(self):
        identifier = str(uuid.uuid4())
        self.call('save', identifier, title='Original')
        self.kill('page', 'save', identifier, title='Changed')
        self.page(identifier).write_bytes(b'\xff\xfe external')
        self.assertEqual(self.call('get', identifier)['data']['title'], 'Original')
        self.assertEqual(self.intents(), [])
        self.assertFalse(self.call('save', identifier, title='Again')['ok'])
        self.assertEqual(self.page(identifier).read_bytes(), b'\xff\xfe external')

    def test_delete_killed_after_the_unlink_completes_on_next_access(self):
        identifier = str(uuid.uuid4())
        self.call('save', identifier, title='Doomed')
        self.kill('page', 'delete', identifier)
        self.assertFalse(self.page(identifier).exists())
        self.assertEqual((self.engine.db.execute('SELECT COUNT(*) FROM meetings').fetchone()[0], len(self.intents())), (1, 1))
        self.assertEqual(self.call('get', identifier)['error']['code'], 'MEETING_NOT_FOUND')
        self.assertEqual((self.call('list')['data'], self.intents()), ([], []))
        self.assertFalse(self.call('delete', identifier)['data']['deleted'])

    def test_delete_killed_before_the_unlink_is_discarded(self):
        identifier = str(uuid.uuid4())
        self.call('save', identifier, title='Kept')
        self.kill('intent', 'delete', identifier)
        self.assertEqual(len(self.intents()), 1)
        self.assertEqual([item['title'] for item in self.call('list')['data']], ['Kept'])
        self.assertEqual((self.page(identifier).exists(), self.intents()), (True, []))
        self.assertTrue(self.call('delete', identifier)['data']['deleted'])

    def test_a_real_process_kill_between_the_page_and_the_record_is_recovered(self):
        child = ("import json, os, signal, sys\n"
                 "from engine import Engine\n"
                 "from meetings_service import MeetingRepository, meeting_api\n"
                 "request = json.loads(sys.argv[2])\n"
                 "setattr(MeetingRepository, request['operation'], lambda *args: os.kill(os.getpid(), signal.SIGKILL))\n"
                 "meeting_api(Engine(sys.argv[1]), request)\n")
        identifier = str(uuid.uuid4())
        self.call('save', identifier, title='Original')
        saving = {'operation': 'save', 'record': {'id': identifier, 'title': 'Changed', 'status': 'needs-review'}}
        for request in (saving, {'operation': 'delete', 'id': identifier}):
            with self.subTest(operation=request['operation']):
                killed = subprocess.run([sys.executable, '-c', child, self.directory.name, json.dumps(request)], cwd=Path(__file__).parent)
                self.assertEqual(killed.returncode, -signal.SIGKILL)
                self.restart()
                self.assertEqual(len(self.intents()), 1)
                if request['operation'] == 'save':
                    self.assertEqual(self.call('get', identifier)['data']['title'], 'Changed')
                    self.assertTrue(self.call('save', identifier, title='Later')['ok'])
                    self.assertIn('Later', self.page(identifier).read_text())
                else:
                    self.assertEqual(self.call('get', identifier)['error']['code'], 'MEETING_NOT_FOUND')
                    self.assertFalse(self.page(identifier).exists())
                self.assertEqual(self.intents(), [])

    def test_in_process_failures_restore_the_page_and_leave_no_intent(self):
        identifier = str(uuid.uuid4())
        self.call('save', identifier, title='Original')
        original = self.page(identifier).read_text()
        for operation, record in (('save', {'title': 'Changed'}), ('delete', {})):
            with self.subTest(operation=operation), patch.object(MeetingRepository, operation, side_effect=RuntimeError('Database unavailable')):
                self.assertEqual(self.call(operation, identifier, **record)['error']['code'], 'PERSISTENCE_FAILED')
                self.assertEqual((self.page(identifier).read_text(), self.intents()), (original, []))
        self.assertEqual(self.call('get', identifier)['data']['title'], 'Original')

    def test_an_intent_that_cannot_be_inspected_waits_and_never_blocks_access(self):
        repository, identifier = MeetingRepository(self.engine), str(uuid.uuid4())
        self.engine.db.execute('INSERT INTO meeting_intents VALUES (?,?,?,?,?)', (identifier, '../outside.md', 'absent', 'absent', None))
        self.engine.db.commit()
        self.assertEqual(repository.list(), [])
        self.assertEqual(self.intents(), [(identifier,)])  # an unsafe path is never read, so the intent is neither completed nor dropped
