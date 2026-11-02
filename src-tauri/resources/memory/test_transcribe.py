import unittest
import hashlib
import json
import shutil
import sys
import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import soundfile as sf
from transcribe import validate_segments, text_segments, complete_segments, run
from transcript_chunks import plan_chunks, transcribe_chunks, MAX_RECORDING_SECONDS, MAX_TOKENS

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
    def test_one_glued_segment_is_split_into_the_models_timed_passages(self):
        # Observed natively: untagged output parsed as one 0-14.97 s segment reading "...test.We decided...".
        text = '[0.00]This is a fictional project meeting for a recording test.[3.96][9.86]We decided to use Acme as supplier.[12.40]'
        glued = [{'start': 0.0, 'end': 14.97, 'text': 'This is a fictional project meeting for a recording test.We decided to use Acme as supplier.'}]
        result = validate_segments(complete_segments(SimpleNamespace(text=text, segments=glued)), 14.97)
        self.assertEqual([(turn['start'], turn['end'], turn['text']) for turn in result],
                         [(0.0, 3.96, 'This is a fictional project meeting for a recording test.'), (9.86, 12.4, 'We decided to use Acme as supplier.')])
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

def output(*segments, tokens=10, text=None):
    return SimpleNamespace(segments=[{'start': start, 'end': end, 'speaker_id': speaker, 'text': words}
                                     for start, end, speaker, words in segments],
                           generation_tokens=tokens, text=text or '')


class ChunkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.wav = Path(cls.temp.name) / 'recording.wav'
        sf.write(cls.wav, np.zeros(601 * 16000, dtype='float32'), 16000, subtype='PCM_16')

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def decode(self, outputs, embeddings=None, duration=601):
        from unittest.mock import Mock
        model = Mock()
        model.generate.side_effect = outputs
        events = []
        with patch('voice_profiles.speaker_embeddings', side_effect=embeddings or (lambda *_: {})), \
             patch('live_speech.narrow_window_segments', side_effect=lambda segments, _: segments):
            result = transcribe_chunks(model, self.wav, duration, events.append)
        return result, model, events

    def test_planning_boundaries_overlap_and_last_short_chunk(self):
        windows = plan_chunks(601)
        self.assertEqual([(w['start'], w['end'], w['coreStart'], w['coreEnd']) for w in windows],
                         [(0, 300, 0, 290), (280, 580, 290, 570), (560, 601, 570, 601)])
        self.assertEqual(len(plan_chunks(300)), 1)
        self.assertEqual(plan_chunks(299)[0]['coreEnd'], 299)
        self.assertEqual(plan_chunks(0), [])
        hour = plan_chunks(3600)
        self.assertEqual(hour[-1]['coreEnd'], 3600)
        self.assertTrue(all(left['coreEnd'] == right['coreStart'] for left, right in zip(hour, hour[1:])))
        self.assertTrue(all(w['end'] - w['start'] <= 300 for w in hour))

    def test_offsets_and_half_open_midpoint_ownership_do_not_duplicate_turns(self):
        result, model, events = self.decode([
            output((287, 289, 'S01', 'before boundary'), (289, 291, 'S01', 'on boundary')),
            output((7, 9, 'S02', 'before boundary'), (9, 11, 'S02', 'on boundary'),
                   (289, 291, 'S02', 'second boundary')),
            output((9, 11, 'S01', 'second boundary'), (35, 40, 'S01', 'last words'))])
        self.assertEqual([(s['start'], s['end'], s['text']) for s in result['segments']],
                         [(287, 289, 'before boundary'), (289, 291, 'on boundary'),
                          (569, 571, 'second boundary'), (595, 600, 'last words')])
        self.assertEqual(model.generate.call_count, 3)
        self.assertEqual(events, [f'Transcribing part {i} of 3' for i in range(1, 4)])
        self.assertEqual(result['gaps'], [])

    def test_voice_ids_are_reconciled_unknown_and_ambiguous_stay_unassigned(self):
        result, _, _ = self.decode([
            output((1, 5, 'S01', 'first voice')),
            output((20, 24, 'S02', 'same voice'), (30, 34, 'S01', 'new voice')),
            output((12, 16, 'S01', 'ambiguous'), (18, 22, 'S03', 'no embedding'),
                   (24, 28, 'S02', 'same again'))],
            embeddings=[{'S01': [1, 0]}, {'S02': [1, 0], 'S01': [.6, .8]},
                        {'S01': [.89442719, .4472136], 'S02': [1, 0]}])
        self.assertEqual([s['speaker'] for s in result['segments']],
                         ['S01', 'S01', 'S02', 'unassigned', 'unassigned', 'S01'])
        self.assertEqual(len(result['speakerEmbeddings']), 2)

    def test_limit_retries_in_halves_and_retains_later_chunks(self):
        result, model, events = self.decode([
            output(tokens=MAX_TOKENS),
            output((1, 4, 'S01', 'recovered first half')),
            output((15, 20, 'S01', 'recovered second half')),
            output((20, 24, 'S01', 'next part')), output()], duration=601)
        self.assertEqual(model.generate.call_count, 5)
        self.assertEqual([s['start'] for s in result['segments']], [1, 150, 300])
        self.assertEqual(result['gaps'], [])
        self.assertEqual([c['status'] for c in result['chunks']], ['split', 'complete', 'complete', 'complete', 'complete'])
        self.assertIn('Retrying transcript part in two halves', events)

    def test_failed_retry_records_exact_core_gap_not_truncated_words(self):
        result, model, events = self.decode([
            output((0, 2, 'S01', 'discard me'), tokens=MAX_TOKENS),
            output((0, 2, 'S01', 'also discard'), tokens=MAX_TOKENS),
            output((15, 20, 'S01', 'surviving half')), output(), output()])
        self.assertEqual(model.generate.call_count, 5)
        self.assertEqual([(g['start'], g['end']) for g in result['gaps']], [(0, 145)])
        self.assertIn('output limit', result['gaps'][0]['reason'])
        self.assertEqual([s['text'] for s in result['segments']], ['surviving half'])
        self.assertIn('A transcript passage needs review', events)

    def test_invalid_timestamps_also_become_a_gap_after_one_retry(self):
        result, _, _ = self.decode([output((-1, 2, 'S01', 'bad')),
                                   output((-1, 2, 'S01', 'bad')), output(), output(), output()])
        self.assertEqual(len(result['gaps']), 1)
        self.assertIn('invalid timestamps', result['gaps'][0]['reason'])

    def test_embedding_failure_preserves_words_without_guessing_local_labels(self):
        def broken(*_): raise RuntimeError('unavailable')
        result, _, _ = self.decode([output((1, 5, 'S01', 'kept')), output(), output()], embeddings=broken)
        self.assertEqual(result['segments'][0]['speaker'], 'unassigned')
        self.assertIn('Voice matching unavailable', result['warnings'][0])


class TranscriptRunTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.audio = self.root / 'original.wav'
        sf.write(self.audio, np.zeros(16000 * 10, dtype='float32'), 16000, subtype='PCM_16')
        self.original = self.audio.read_bytes()
        self.request = {'action': 'transcribe', 'vaultPath': str(self.root), 'audioPath': str(self.audio),
                        'sessionId': str(uuid.uuid4())}

    def tearDown(self):
        self.temp.cleanup()

    def invoke(self, model, info=None):
        def convert(command, **kwargs):
            self.command, self.conversion_options = command, kwargs
            shutil.copyfile(self.audio, command[-1])
        from contextlib import ExitStack
        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, {'huggingface_hub': SimpleNamespace(snapshot_download=lambda *_, **__: 'fake-model')}))
            stack.enter_context(patch('transcribe.subprocess.run', side_effect=convert))
            stack.enter_context(patch('live_speech.has_speech', return_value=True))
            stack.enter_context(patch('voice_profiles.speaker_embeddings', return_value={'S01': [1, 0]}))
            stack.enter_context(patch('voice_profiles.match_profiles', return_value={}))
            self.events = stack.enter_context(patch('transcribe.progress'))
            if info is not None: stack.enter_context(patch('soundfile.info', return_value=SimpleNamespace(duration=info)))
            return run(self.request, model=model)

    def test_short_recording_keeps_single_generate_call_output_and_saved_fields(self):
        from unittest.mock import Mock
        raw = '[1.00][S01]hello[5.00]'
        model = Mock()
        model.generate.return_value = output((1, 5, 'S01', 'hello'), text=raw)
        result = self.invoke(model)
        model.generate.assert_called_once()
        self.assertEqual(model.generate.call_args.kwargs, {'max_tokens': 16384, 'temperature': 0.0})
        self.assertEqual(result['text'], raw)
        self.assertEqual(result['segments'], [{'start': 1, 'end': 5, 'speaker': 'S01', 'text': 'hello'}])
        self.assertEqual(result['audioSha256'], hashlib.sha256(self.original).hexdigest())
        self.assertNotIn('speakerEmbeddings', result)
        saved = json.loads((self.root / '.memoria-recordings' / self.request['sessionId'] / 'transcript-draft.json').read_text())
        self.assertEqual(saved['speakerEmbeddings'], {'S01': [1, 0]})
        self.assertTrue({'speakerMatches', 'profiles', 'processingSeconds', 'warnings'} <= saved.keys())
        self.events.assert_any_call('Transcribing part 1 of 1')

    def test_short_saturated_chunk_splits_without_repeating_initial_call(self):
        from unittest.mock import Mock
        model = Mock()
        model.generate.side_effect = [output(tokens=MAX_TOKENS), output(tokens=MAX_TOKENS),
                                      output((6, 9, 'S01', 'recovered'))]
        result = self.invoke(model)
        self.assertEqual(model.generate.call_count, 3)
        self.assertEqual(result['gaps'][0]['start'], 0)
        self.assertEqual(result['gaps'][0]['end'], 5)
        self.assertTrue(any('marked gaps' in warning for warning in result['warnings']))
        saved = json.loads((self.root / '.memoria-recordings' / self.request['sessionId'] / 'transcript-draft.json').read_text())
        self.assertEqual(saved['gaps'], result['gaps'])

    def test_above_three_hours_is_explicitly_rejected_and_original_untouched(self):
        from unittest.mock import Mock
        model = Mock()
        with self.assertRaisesRegex(ValueError, 'up to 3 hours.*original audio is untouched'):
            self.invoke(model, info=MAX_RECORDING_SECONDS + .01)
        model.generate.assert_not_called()
        self.assertEqual(self.audio.read_bytes(), self.original)
        self.assertEqual(self.command[self.command.index('-t') + 1], str(MAX_RECORDING_SECONDS + 1))
        self.assertEqual(self.conversion_options['timeout'], 1800)
        self.assertFalse((self.root / '.memoria-recordings').exists())

    def test_hour_recording_runs_every_chunk_and_saves_the_last_words(self):
        from unittest.mock import Mock
        block = np.zeros(30 * 16000, dtype='float32')
        with sf.SoundFile(self.audio, 'w', samplerate=16000, channels=1, subtype='PCM_16') as audio:
            for _ in range(120): audio.write(block)
        with self.audio.open('rb') as audio:
            original_hash = hashlib.file_digest(audio, 'sha256').hexdigest()
        model = Mock()
        def generate(path, **_):
            duration = sf.info(path).duration
            self.assertLessEqual(duration, 300)
            return output((20, 24, 'S01', 'part opening'),
                          (duration - 4, duration - 1, 'S01', 'ending words'))
        model.generate.side_effect = generate
        with patch('live_speech.narrow_window_segments', side_effect=lambda segments, _: segments):
            result = self.invoke(model)
        self.assertEqual(result['duration'], 3600)
        self.assertEqual(model.generate.call_count, len(plan_chunks(3600)))
        self.assertEqual(result['gaps'], [])
        self.assertEqual(result['segments'][-1]['end'], 3599)
        self.assertEqual(result['segments'][-1]['text'], 'ending words')
        self.assertEqual({s['speaker'] for s in result['segments']}, {'S01'})
        self.assertEqual(result['audioSha256'], original_hash)
        saved = json.loads((self.root / '.memoria-recordings' / self.request['sessionId'] / 'transcript-draft.json').read_text())
        self.assertEqual(saved['segments'], result['segments'])
        self.assertEqual(saved['speakerEmbeddings'], {'S01': [1, 0]})
        self.assertEqual(saved['chunks'][-1]['coreEnd'], 3600)
        self.events.assert_any_call(f'Transcribing part {len(plan_chunks(3600))} of {len(plan_chunks(3600))}')
        with self.audio.open('rb') as audio:
            self.assertEqual(hashlib.file_digest(audio, 'sha256').hexdigest(), original_hash)


if __name__ == '__main__': unittest.main()
