import unittest
from unittest.mock import patch
from types import SimpleNamespace
import numpy as np
from live_speech import WindowTranscript, has_speech, RATE, trim_context_repeat, trim_overlapping_context, assign_voice

class LiveSpeechTests(unittest.TestCase):
    def test_trimmed_context_preserves_raw_interval_and_marks_alignment_unresolved(self):
        with patch('live_speech.has_speech', return_value=True), patch('live_speech.emit') as emit, patch('voice_profiles.speaker_embeddings', return_value={}), patch('live_speech.decode_window', return_value=[{'start': 0, 'end': 6, 'speaker': 'S01', 'text': 'my role is the interface'}]):
            session = WindowTranscript(None)
            session.turns = [{'start': 0, 'end': 2, 'speaker': 'unassigned', 'text': 'my role is'}]
            session.feed(np.ones(RATE * 6, dtype='float32'))
            retained = session.turns[-1]
            self.assertEqual(retained['text'], 'the interface')
            self.assertEqual(retained['rawWindowText'], 'my role is the interface')
            self.assertEqual((retained['start'], retained['end']), (0, 6))
            self.assertEqual((retained['rawWindowStart'], retained['rawWindowEnd']), (0, 6))
            self.assertEqual(retained['timingStatus'], 'unresolved-context-trim')
            self.assertTrue(retained['contextTrimmed'])
            self.assertEqual(emit.call_count, 1)

    def test_empty_decode_does_not_emit_a_caption_update(self):
        with patch('live_speech.has_speech', return_value=True), patch('live_speech.emit') as emit, patch('voice_profiles.speaker_embeddings', return_value={}), patch('live_speech.decode_window', return_value=[]):
            session = WindowTranscript(None)
            session.feed(np.ones(RATE * 6, dtype='float32'))
            self.assertEqual(session.committed, RATE * 4)
            emit.assert_not_called()

    def test_variant_spelling_context_is_trimmed_without_rewriting_remaining_words(self):
        self.assertEqual(trim_overlapping_context('pasal jerebu sejak episode ke 21 dan dalam episode lepas',
            'pasal jerbu sejak episod ke 21 dan dalam episode lepas kami suruh korang'), 'kami suruh korang')
        self.assertEqual(trim_overlapping_context('launch is Thursday', 'launch moved to Friday'), 'launch moved to Friday')
    def test_failed_context_can_recover_on_core_without_a_gap(self):
        class Model:
            def __init__(self):self.calls=0
            def generate(self,*args,**kwargs):
                self.calls+=1
                return SimpleNamespace(generation_tokens=384 if self.calls==1 else 10,
                    segments=[{'start':0,'end':1,'speaker_id':'S01','text':'recovered passage'}])
        with patch('live_speech.has_speech',return_value=True),patch('live_speech.emit'),patch('voice_profiles.speaker_embeddings',return_value={}):
            session=WindowTranscript(Model());session.feed(np.ones(RATE*4,dtype='float32'),final=True)
            self.assertEqual(session.gaps,[])
            self.assertEqual(session.text(),'recovered passage')
    def test_ambiguous_matches_do_not_create_unbounded_speaker_slots(self):
        voices={'S01':[1.,0.], 'S02':[1.,0.]}
        self.assertEqual(assign_voice(voices,[1.,0.]),'unassigned')
        self.assertEqual(len(voices),2)
        voices={f'S{i:02d}':[1.,0.] for i in range(8)}
        self.assertEqual(assign_voice(voices,[0.,1.]),'unassigned')
        self.assertEqual(len(voices),8)
    def test_bad_window_records_gap_and_keeps_processing(self):
        class Model:
            def generate(self,*args,**kwargs): return SimpleNamespace(generation_tokens=384,segments=[])
        with patch('live_speech.has_speech',return_value=True),patch('live_speech.emit'):
            session=WindowTranscript(Model());session.feed(np.ones(RATE*12,dtype='float32'),final=True)
            self.assertEqual(session.committed,RATE*12)
            self.assertEqual(len(session.gaps),3)
            self.assertEqual(session.turns,[])
    def test_context_repeat_is_removed_without_fuzzy_rewriting(self):
        self.assertEqual(trim_context_repeat('Americans, ask not what your', 'Ask not what your country can do'), 'country can do')
        self.assertEqual(trim_context_repeat('ask what you can do for your country.', '...country can do for you'), '...country can do for you')
    def test_silence_never_invokes_model(self):
        class Model:
            def generate(self,*args,**kwargs): raise AssertionError('Silence must not invoke ASR')
        session=WindowTranscript(Model())
        session.feed(np.zeros(RATE*8,dtype='float32'),final=True)
        self.assertEqual(session.turns,[])
        self.assertFalse(has_speech(np.zeros(RATE*4,dtype='float32')))

    def test_boundary_context_is_owned_once_and_end_flushes_tail(self):
        class Model:
            def generate(self,audio,**kwargs):
                return SimpleNamespace(generation_tokens=10,segments=[{'start':0,'end':1,'speaker_id':'S01','text':'hello'}])
        with patch('live_speech.has_speech',return_value=True), patch('voice_profiles.speaker_embeddings',return_value={}), patch('live_speech.emit'):
            session=WindowTranscript(Model())
            session.feed(np.ones(RATE*7,dtype='float32'),final=True)
            self.assertEqual(session.committed,RATE*7)
            self.assertEqual(len(session.turns),1)
            self.assertLessEqual(len(session.buffer),RATE*2)

if __name__=='__main__':unittest.main()
