"""Local-only MOSS drafts for up to three hours of saved audio; originals stay untouched."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from transcript_chunks import CHUNK_SECONDS, MAX_RECORDING_SECONDS, MAX_TOKENS, transcribe_chunks
from private_storage import mark_private

MODEL = 'OpenMOSS-Team/MOSS-Transcribe-Diarize'
REVISION = '704aa4a9c304e8520be88901e0d1960158ef5b15'

def progress(stage):
    print(json.dumps({'progress': stage}), flush=True)

STAMP = re.compile(r'\[(S\d+|\d+(?:\.\d+)?)\]')

def text_segments(text):
    """MOSS timestamped text ("[0.00]words[3.96][9.86][S01] words[12.42]") as segments,
    including passages that carry no speaker tag."""
    parts = STAMP.split(text or '')
    result, start, speaker, content = [], None, None, ''
    for index, part in enumerate(parts):
        if index % 2 == 0:
            if start is not None: content += part
        elif part.startswith('S'):
            if start is not None: speaker = part
        elif start is None:
            start, speaker, content = float(part), None, ''
        elif content.strip():
            result.append({'start': start, 'end': float(part), 'speaker_id': speaker or 'unassigned', 'text': content.strip()})
            start = None
        else:
            start = float(part)  # consecutive timestamps: the later one opens the passage
    return result

def complete_segments(output):
    """The model's parsed segments, plus timestamped passages its parser dropped for lacking a
    speaker tag (observed: the opening sentence of a recording). When the passages hold exactly
    the parsed words, they are used instead: same words, the model's own passage timing (observed:
    an untagged output parsed as one 15 s segment that glued two sentences together)."""
    segments = list(getattr(output, 'segments', None) or [])
    key = lambda text: re.sub(r'\W+', ' ', re.sub(r'\[(?:S\d+|\d+(?:\.\d+)?)\]', ' ', str(text))).strip().lower()
    passages = text_segments(getattr(output, 'text', ''))
    if passages and key(' '.join(passage['text'] for passage in passages)) == key(' '.join(str(segment.get('text', '')) for segment in segments)):
        return passages
    known = [key(segment.get('text', '')) for segment in segments]
    for passage in passages:
        candidate = key(passage['text'])
        if candidate and not any(candidate in existing or existing in candidate for existing in known if existing):
            segments.append(passage); known.append(candidate)
    return sorted(segments, key=lambda segment: float(segment['start']))

def validate_segments(segments, duration):
    result = []
    for segment in segments or []:
        start, end = float(segment['start']), float(segment['end'])
        if not 0 <= start <= end <= duration + 1:
            raise ValueError('Model returned invalid timestamps; review raw output before retrying.')
        text = re.sub(r'^\[S\d+\]\s*', '', str(segment.get('text', ''))).strip()
        text = re.sub(r'\[(?:S\d+|\d+(?:\.\d+)?)\]', '', text).strip()
        if text:
            result.append({'start': round(start, 2), 'end': round(min(end, duration), 2),
                           'speaker': str(segment.get('speaker_id', 'unassigned')), 'text': text})
    return result

def run(request, model=None):
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    root = Path(request['vaultPath']).resolve(strict=True)
    from voice_profiles import list_profiles, save_profiles
    if request['action'] == 'speaker_profiles': return list_profiles(root)
    if request['action'] == 'meeting_draft':
        import uuid
        path = root / '.memoria-recordings' / str(uuid.UUID(request['sessionId'])) / 'transcript-draft.json'
        path.resolve().relative_to(root)
        if not path.exists(): return None
        result = json.loads(path.read_text())
        result.pop('speakerEmbeddings', None)
        return result
    if request['action'] == 'save_voice_profiles':
        return save_profiles(root, request['sessionId'], request.get('assignments', []))
    audio = Path(request['audioPath']).resolve(strict=True)
    audio.relative_to(root)
    if audio.suffix.lower() not in {'.wav', '.webm', '.m4a', '.mp3', '.flac'}:
        raise ValueError('Unsupported recording format')
    progress('Checking recording and local speech model')
    from huggingface_hub import snapshot_download
    model_path = snapshot_download(MODEL, revision=REVISION, local_files_only=True)
    ffmpeg = os.environ.get('MEMORIA_FFMPEG', '/opt/homebrew/bin/ffmpeg')
    with tempfile.TemporaryDirectory(prefix='memoria-transcript-') as temporary:
        wav = Path(temporary) / 'recording.wav'
        # Decode at most the documented three-hour limit plus a detection second.
        # The source is read-only; no oversized recording is silently truncated.
        subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-i', str(audio), '-t', str(MAX_RECORDING_SECONDS + 1),
                        '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(wav)],
                       check=True, capture_output=True, timeout=1800)
        import soundfile as sf
        duration = sf.info(wav).duration
        if duration > MAX_RECORDING_SECONDS:
            raise ValueError('Transcription supports recordings up to 3 hours of saved audio. This recording is longer; the original audio is untouched. Split it into shorter recordings before retrying.')
        if duration < .25:
            return {'segments': [], 'text': '', 'duration': duration, 'warnings': ['Recording is too short to transcribe.']}
        from live_speech import has_speech
        # Scan bounded blocks rather than allocating three hours of PCM in RAM.
        blocks = [sf.read(wav, dtype='float32')[0]] if duration <= CHUNK_SECONDS else sf.blocks(wav, blocksize=16000 * 30, dtype='float32')
        if not any(has_speech(block) for block in blocks):
            return {'segments': [], 'text': '', 'duration': duration, 'warnings': ['No speech detected. Original audio is saved.']}
        progress('Loading local MOSS speech model')
        if model is None:
            from mlx_audio.stt import load
            model = load(model_path)
        progress('Transcribing and assigning provisional speakers')
        start = time.perf_counter()
        chunked = None
        if duration <= CHUNK_SECONDS:
            progress('Transcribing part 1 of 1')
            output = model.generate(str(wav), max_tokens=MAX_TOKENS, temperature=0.0)
            if output.generation_tokens < MAX_TOKENS:
                segments = validate_segments(complete_segments(output), duration)
                text = output.text
            else:
                # The ordinary short-recording path remains one unchanged call.
                # Only a saturated output needs the same split recovery as long audio.
                chunked = transcribe_chunks(model, wav, duration, progress, initial_output=output)
        else:
            chunked = transcribe_chunks(model, wav, duration, progress)
        if chunked is not None:
            segments, text = chunked['segments'], chunked['text']
        with audio.open('rb') as original:
            audio_hash = hashlib.file_digest(original, 'sha256').hexdigest()
        result = {'model': MODEL, 'revision': REVISION, 'duration': duration,
                  'processingSeconds': time.perf_counter() - start, 'segments': segments,
                  'text': text, 'audioSha256': audio_hash,
                  'warnings': ['Machine draft: review words, timestamps and speaker labels against the audio.',
                               'Speaker labels are anonymous; overlap may cause missing words or incorrect assignments.',
                               'Pauses are omitted from the recording clock. Timestamps refer to saved audio, not wall-clock time.']}
        if chunked is not None:
            result['chunks'], result['gaps'] = chunked['chunks'], chunked['gaps']
            result['warnings'].extend(chunked['warnings'])
            if chunked['gaps']:
                result['warnings'].append(f"{len(chunked['gaps'])} audio intervals could not be transcribed. Check the marked gaps against the original recording.")
        if not segments:
            result['warnings'].append('No readable speech was detected. The original audio remains available.')
        progress('Matching voices to saved speaker names')
        try:
            from voice_profiles import speaker_embeddings, match_profiles
            if chunked is None:
                samples, _ = sf.read(wav, dtype='float32')
                embeddings = speaker_embeddings(samples, segments)
            else:
                embeddings = chunked['speakerEmbeddings']
            result['speakerEmbeddings'] = embeddings
            result['speakerMatches'] = match_profiles(root, embeddings)
        except Exception as error:
            result['speakerEmbeddings'] = {}
            result['speakerMatches'] = {}
            result['warnings'].append(f'Voice matching unavailable: {error}')
        result['profiles'] = list_profiles(root)
        progress('Saving recoverable transcript draft')
        identifier = request['sessionId']
        import uuid
        identifier = str(uuid.UUID(identifier))
        directory = root / '.memoria-recordings' / identifier
        directory.resolve().relative_to(root)
        mark_private(directory.parent)
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / 'transcript-draft.json'
        temporary_file = directory / f'.draft-{uuid.uuid4()}.tmp'
        with temporary_file.open('x') as file:
            json.dump(result, file, ensure_ascii=False, indent=2)
            file.flush(); os.fsync(file.fileno())
        os.replace(temporary_file, destination)
        del result['speakerEmbeddings']
        return result

if __name__ == '__main__':
    try:
        if os.environ.get('MEMORIA_SPEECH_SOCKET'):
            from resident_client import relay
            relay(os.environ['MEMORIA_SPEECH_SOCKET'], 'transcribe')
        else: print(json.dumps({'result': run(json.load(sys.stdin))}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({'error': str(error)}), flush=True)
        sys.exit(1)
