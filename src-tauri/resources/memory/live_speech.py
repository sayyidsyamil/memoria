"""Speech-gated MOSS windows, one evolving transcript and a reusable final draft."""
import base64
import json
import os
import sys
import uuid
import re
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
RATE = 16000
HOP = int(os.environ.get('MEMORIA_SPEECH_HOP_SECONDS', '4')) * RATE
CONTEXT = int(os.environ.get('MEMORIA_SPEECH_CONTEXT_SECONDS', '2')) * RATE

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

def has_speech(samples):
    import numpy as np
    import webrtcvad
    if not len(samples) or np.sqrt(np.mean(samples ** 2)) < .0005:
        return False
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
    vad = webrtcvad.Vad(2)
    return sum(vad.is_speech(pcm[offset:offset+960], RATE)
               for offset in range(0, len(pcm)-959, 960)) >= 3

def trim_context_repeat(previous, incoming):
    """Remove identical suffix/prefix context words, never fuzzy paraphrases."""
    old = previous.split()
    new = incoming.split()
    canonical = lambda words: [re.sub(r'[^\w]', '', word).lower() for word in words]
    a, b = canonical(old), canonical(new)
    for size in range(min(len(a), len(b), 60), 1, -1):
        if a[-size:] == b[:size]: return ' '.join(new[size:])
    # An entire short tail may have been decoded again with truncated left context.
    if len(b) >= 3 and len(b) <= len(a) and a[-len(b):] == b: return ''
    return incoming

def trim_overlapping_context(previous, incoming):
    """Align only the temporal overlap's suffix/prefix; preserve incoming spelling."""
    from difflib import SequenceMatcher
    old, new = previous.split(), incoming.split()
    canonical = lambda words: [re.sub(r'[^\w]', '', word).lower() for word in words]
    a, b = canonical(old[-40:]), canonical(new[:40])
    best = None
    for left in range(3, len(a) + 1):
        for right in range(max(3, left - 3), min(len(b), left + 3) + 1):
            ratio = SequenceMatcher(None, a[-left:], b[:right], autojunk=False).ratio()
            if ratio >= .72 and (a[-1] == b[right-1] or ratio >= .9):
                candidate = (ratio * min(left, right), right)
                if best is None or candidate > best: best = candidate
    return ' '.join(new[best[1]:]) if best else trim_context_repeat(previous, incoming)

def assign_voice(voices, vector):
    import numpy as np
    ranked = sorted([(float(np.dot(vector, voice)), speaker) for speaker, voice in voices.items()], reverse=True)
    if ranked and ranked[0][0] >= .78:
        if len(ranked) > 1 and ranked[0][0] - ranked[1][0] < .06:
            return 'unassigned'  # Ambiguity is not evidence of a new voice.
        return ranked[0][1]
    if len(voices) >= 8: return 'unassigned'
    speaker = f'S{len(voices) + 1:02d}'
    voices[speaker] = vector
    return speaker

def decode_window(model, window):
    from transcribe import validate_segments
    output = model.generate(window, max_tokens=384, temperature=0.0)
    if output.generation_tokens >= 384:
        raise ValueError('Window exceeded output limit')
    return validate_segments(output.segments, len(window) / RATE)

class WindowTranscript:
    def __init__(self, model):
        import numpy as np
        self.model = model
        self.buffer = np.zeros(0, dtype='float32')
        self.offset = 0
        self.committed = 0
        self.total = 0
        self.turns = []
        self.voices = {}
        self.warnings = []
        self.gaps = []

    def feed(self, samples, final=False):
        import numpy as np
        self.buffer = np.concatenate([self.buffer, samples])
        self.total += len(samples)
        # Keep two seconds of future audio around each core boundary. It is
        # context only and will belong to the next core, never transcribed twice.
        while self.total - self.committed >= HOP + CONTEXT or (final and self.total > self.committed):
            end = min(self.committed + HOP, self.total)
            window_start = max(0, self.committed - CONTEXT)
            window_end = min(self.total, end + CONTEXT)
            window = self.buffer[window_start-self.offset:window_end-self.offset]
            core = self.buffer[self.committed-self.offset:end-self.offset]
            if has_speech(core):
                recovery = False
                try:
                    segments = decode_window(self.model, window)
                except ValueError as error:
                    try:
                        segments = decode_window(self.model, core)
                        recovery = True
                    except ValueError:
                        segments = None
                if segments is None:
                    # One pathological window must not terminate the meeting.
                    # Record an explicit gap rather than publish truncated text.
                    self.gaps.append({'start': self.committed / RATE, 'end': end / RATE, 'reason': 'Window and core retry exceeded output or timestamp limits'})
                    emit({'stage': 'A transcript passage needs review', 'gap': self.gaps[-1]})
                    self.committed = end
                    keep = max(0, self.committed - CONTEXT)
                    self.buffer = self.buffer[keep-self.offset:]; self.offset = keep
                    continue
                decode_start = self.committed if recovery else window_start
                decode_audio = core if recovery else window
                owned = [segment for segment in segments if
                         self.committed / RATE <= decode_start / RATE + (segment['start'] + segment['end']) / 2 < end / RATE]
                # Voice matching reconciles window-local MOSS IDs. Short/overlap
                # turns stay unknown instead of reusing an arbitrary local label.
                from voice_profiles import speaker_embeddings
                embeddings = speaker_embeddings(decode_audio, segments)
                names = {}
                for local, vector in embeddings.items():
                    names[local] = assign_voice(self.voices, vector)
                for segment in owned:
                    segment['start'] += decode_start / RATE
                    segment['end'] += decode_start / RATE
                    segment['speaker'] = names.get(segment['speaker'], 'unassigned')
                    if self.turns and segment['start'] < self.turns[-1]['end'] and (segment['speaker'] == self.turns[-1]['speaker'] or 'unassigned' in (segment['speaker'], self.turns[-1]['speaker'])):
                        original_text = segment['text']
                        segment['text'] = trim_overlapping_context(' '.join(turn['text'] for turn in self.turns[-5:]), segment['text'])
                        if segment['text'] != original_text:
                            segment['rawWindowText'] = original_text
                            segment['contextTrimmed'] = True
                    if not segment['text']: continue
                    self.turns.append(segment)
                emit({'transcript': self.text(), 'turns': self.turns, 'stage': 'Live transcript', 'provisional': True})
            self.committed = end
            keep = max(0, self.committed - CONTEXT)
            self.buffer = self.buffer[keep-self.offset:]
            self.offset = keep

    def text(self):
        return ' '.join(turn['text'] for turn in self.turns)

def run(model=None):
    import numpy as np
    request = json.loads(sys.stdin.readline())
    root = Path(request['vaultPath']).resolve(strict=True)
    identifier = str(uuid.UUID(request['sessionId']))
    directory = root / '.memoria-recordings' / identifier
    directory.resolve().relative_to(root)
    directory.mkdir(parents=True, exist_ok=True)
    from huggingface_hub import snapshot_download
    from mlx_audio.stt import load
    from transcribe import MODEL, REVISION
    emit({'stage': 'Preparing MOSS live transcript'})
    model = model or load(snapshot_download(MODEL, revision=REVISION, local_files_only=True))
    emit({'stage': 'Warming MOSS · not recording'})
    # Materialize lazy weights/kernels before declaring readiness. Warmup text
    # is discarded and never published as meeting evidence.
    if getattr(model, '_memoria_warmed', False):
        pass
    else:
        model.generate(np.zeros(RATE, dtype='float32'), max_tokens=32, temperature=0.0)
    from resemblyzer import VoiceEncoder
    import voice_profiles
    if voice_profiles._encoder is None: voice_profiles._encoder = VoiceEncoder(device='cpu', verbose=False)
    session = WindowTranscript(model)
    emit({'stage': 'Live captions ready'})
    expected = 0
    for line in sys.stdin:
        message = json.loads(line)
        if message.get('end'):
            session.feed(np.zeros(0, dtype='float32'), final=True)
            from voice_profiles import match_profiles, list_profiles
            result = {'model': MODEL, 'revision': REVISION, 'segments': session.turns,
                      'duration': session.total / RATE, 'text': session.text(),
                      'speakerEmbeddings': session.voices,
                      'speakerMatches': match_profiles(root, session.voices), 'profiles': list_profiles(root),
                      'warnings': ['MOSS near-live draft. Review words and speaker assignments.',
                                   'Window boundaries and overlapping speech can cause omissions or repeats.',
                                   'Timestamps use caption PCM time; pauses and startup may differ from the original recording clock.'],
                      'nearLive': True, 'gaps': session.gaps}
            if session.gaps: result['warnings'].append(f'{len(session.gaps)} audio intervals could not be transcribed. Check the marked intervals against the recording.')
            temporary = directory / f'.transcript-{uuid.uuid4()}.tmp'
            with temporary.open('x') as file:
                json.dump(result, file, ensure_ascii=False); file.flush(); os.fsync(file.fileno())
            os.replace(temporary, directory / 'transcript-draft.json')
            result.pop('speakerEmbeddings')
            emit({'stage': 'Transcript ready for review', 'done': True, 'draft': result})
            return
        if message['index'] != expected: raise ValueError('PCM sequence gap; captioning stopped')
        expected += 1
        pcm = np.frombuffer(base64.b64decode(message['data'], validate=True), dtype='<f4').copy()
        if not 0 < len(pcm) <= 16384 or not np.isfinite(pcm).all(): raise ValueError('Invalid PCM segment')
        session.feed(pcm)
        emit({'ack': message['index']})

if __name__ == '__main__':
    try:
        if os.environ.get('MEMORIA_SPEECH_SOCKET'):
            from resident_client import relay
            relay(os.environ['MEMORIA_SPEECH_SOCKET'], 'live')
        else: run()
    except Exception as error:
        emit({'error': str(error)}); sys.exit(1)
