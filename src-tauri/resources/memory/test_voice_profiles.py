import json
import tempfile
import unittest
import uuid
from pathlib import Path
from voice_profiles import database, save_profiles, match_profiles, ENCODER

class VoiceProfileTests(unittest.TestCase):
    def test_saved_name_matches_next_session_without_reenrollment(self):
        with tempfile.TemporaryDirectory() as root:
            identifier = str(uuid.uuid4())
            directory = Path(root) / '.memoria-recordings' / identifier
            directory.mkdir(parents=True)
            vector = [1.0, 0.0, 0.0]
            (directory / 'transcript-draft.json').write_text(json.dumps({'speakerEmbeddings': {'S01': vector}}))
            receipt = save_profiles(root, identifier, [{'speaker': 'S01', 'name': 'Maya'}])
            match = match_profiles(root, {'S07': vector})
            self.assertEqual(match['S07']['name'], 'Maya')
            self.assertEqual(match['S07']['id'], receipt['saved'][0])
            self.assertEqual(match_profiles(root, {'S07': [0.0,1.0,0.0]}), {})

    def test_ambiguous_and_colliding_voices_remain_unknown(self):
        with tempfile.TemporaryDirectory() as root:
            with database(root) as connection:
                for name in ['Maya','Alex']:
                    connection.execute('INSERT INTO voices VALUES (?,?,?,?)', (str(uuid.uuid4()),name,ENCODER,json.dumps([1.0,0.0])))
            self.assertEqual(match_profiles(root, {'S01': [1.0,0.0]}), {})

if __name__ == '__main__': unittest.main()


class ForgetVoicesTests(unittest.TestCase):
    def test_forgetting_removes_every_template(self):
        import json, sqlite3, tempfile
        from pathlib import Path
        from voice_profiles import database, forget_profiles, list_profiles
        with tempfile.TemporaryDirectory() as folder:
            with database(folder) as connection:
                connection.execute('INSERT INTO voices VALUES (?,?,?,?)', ('a', 'Maya', 'enc', json.dumps([0.1, 0.2])))
                connection.execute('INSERT INTO voices VALUES (?,?,?,?)', ('b', 'Raj', 'enc', json.dumps([0.3, 0.4])))
            self.assertEqual(forget_profiles(folder), {'forgotten': 2})
            self.assertEqual(list_profiles(folder), [])
            data = (Path(folder) / '.memoria-memory' / 'voices.sqlite').read_bytes()
            self.assertNotIn(b'Maya', data)  # vacuumed, not only unlinked rows


class DropDraftEmbeddingsTests(unittest.TestCase):
    def test_a_saved_review_keeps_no_voice_embeddings_in_its_draft(self):
        from voice_profiles import drop_draft_embeddings
        with tempfile.TemporaryDirectory() as folder:
            session = str(uuid.uuid4())
            directory = Path(folder) / '.memoria-recordings' / session
            directory.mkdir(parents=True)
            (directory / 'transcript-draft.json').write_text(json.dumps({'segments': [{'text': 'Hi'}], 'speakerEmbeddings': {'S01': [0.1, 0.2]}}))
            self.assertEqual(drop_draft_embeddings(folder, session), {'dropped': True})
            self.assertEqual(json.loads((directory / 'transcript-draft.json').read_text()), {'segments': [{'text': 'Hi'}]})
            self.assertEqual(drop_draft_embeddings(folder, session), {'dropped': False})
            with self.assertRaises(ValueError):
                drop_draft_embeddings(folder, '../outside')
