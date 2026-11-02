import unittest
from types import SimpleNamespace
from transcribe import validate_segments, text_segments, complete_segments

OBSERVED = '[0.00]This is a fictional project meeting for a recording test.[3.96][9.86][S01] We decided to use Acme as supplier.[12.42]'

class TranscriptTests(unittest.TestCase):
    def test_untagged_opening_passage_is_kept(self):
        # Observed natively: the parser dropped the untagged first sentence of a recovered recording.
        output = SimpleNamespace(text=OBSERVED, segments=[{'start': 9.86, 'end': 12.42, 'speaker_id': 'S01', 'text': 'We decided to use Acme as supplier.'}])
        result = validate_segments(complete_segments(output), 15.96)
        self.assertEqual([(turn['start'], turn['speaker'], turn['text']) for turn in result],
                         [(0.0, 'unassigned', 'This is a fictional project meeting for a recording test.'),
                          (9.86, 'S01', 'We decided to use Acme as supplier.')])
    def test_parsed_segments_are_not_duplicated(self):
        tagged = [{'start': 0.0, 'end': 3.96, 'speaker_id': 'S01', 'text': '[S01] This is a fictional project meeting for a recording test.'},
                  {'start': 9.86, 'end': 12.42, 'speaker_id': 'S01', 'text': 'We decided to use Acme as supplier.'}]
        self.assertEqual(len(complete_segments(SimpleNamespace(text=OBSERVED, segments=tagged))), 2)
    def test_timestamped_text_parsing(self):
        self.assertEqual(text_segments('[0.00][S01][0.72]'), [])
        self.assertEqual(text_segments('[0.00][1.20][S02] late start [2.50]'), [{'start': 1.2, 'end': 2.5, 'speaker_id': 'S02', 'text': 'late start'}])
        self.assertEqual(text_segments(''), [])
        self.assertEqual(complete_segments(SimpleNamespace(segments=[])), [])
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
