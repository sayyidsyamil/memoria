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
