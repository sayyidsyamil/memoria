import unittest
from transcribe import validate_segments
class TranscriptTests(unittest.TestCase):
    def test_keeps_overlapping_segments_and_strips_duplicate_label(self):
        result = validate_segments([{'start':0,'end':2,'speaker_id':'S01','text':'[S01] hello'},
                                    {'start':1,'end':3,'speaker_id':'S02','text':'reply'}],3)
        self.assertEqual(result[0]['text'],'hello')
        self.assertEqual(result[1]['start'],1)
    def test_invalid_model_timestamps_are_not_published(self):
        with self.assertRaises(ValueError):validate_segments([{'start':-1,'end':2}],3)
        with self.assertRaises(ValueError):validate_segments([{'start':1,'end':7}],3)
    def test_timestamp_only_silence_output_is_not_speech(self):
        self.assertEqual(validate_segments([{'start':0,'end':.7,'text':'[0.00][S01][0.72]'}],1),[])
if __name__ == '__main__':unittest.main()
