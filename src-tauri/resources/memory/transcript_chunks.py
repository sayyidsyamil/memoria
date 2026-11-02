"""Bounded full-recording decoding; overlap supplies context, never a second owner."""
from pathlib import Path

RATE = 16000
CHUNK_SECONDS = 300
OVERLAP_SECONDS = 20
MAX_TOKENS = 16384
# Three hours of saved audio (not wall-clock meeting time). Conversion reads one
# extra second solely to detect and visibly reject oversized inputs.
MAX_RECORDING_SECONDS = 3 * 60 * 60


def plan_chunks(duration):
    windows = []
    start = 0
    while start < duration:
        end = min(start + CHUNK_SECONDS, duration)
        windows.append({'start': start, 'end': end})
        if end == duration: break
        start += CHUNK_SECONDS - OVERLAP_SECONDS
    for index, window in enumerate(windows):
        window['coreStart'] = (windows[index-1]['end'] + window['start']) / 2 if index else 0
        window['coreEnd'] = (window['end'] + windows[index+1]['start']) / 2 if index+1 < len(windows) else duration
    return windows


def transcribe_chunks(model, wav, duration, progress, initial_output=None):
    """Retry saturated/invalid windows once in halves; publish gaps, not partial output."""
    import soundfile as sf
    from transcribe import complete_segments, validate_segments
    from live_speech import assign_voice, narrow_window_segments
    from voice_profiles import speaker_embeddings
    turns, gaps, chunks, warnings, voices = [], [], [], [], {}

    def decode(window, path, retry=False, output=None):
        with sf.SoundFile(wav) as audio:
            audio.seek(round(window['start'] * RATE))
            samples = audio.read(round((window['end'] - window['start']) * RATE), dtype='float32')
        sf.write(path, samples, RATE, subtype='PCM_16')
        metadata = {**window, 'retry': retry}
        chunks.append(metadata)
        try:
            if output is None:
                output = model.generate(str(path), max_tokens=MAX_TOKENS, temperature=0.0)
            if output.generation_tokens >= MAX_TOKENS:
                raise ValueError('Chunk exceeded output limit')
            segments = validate_segments(complete_segments(output), len(samples) / RATE)
        except ValueError as error:
            metadata['status'] = 'gap' if retry else 'split'
            metadata['reason'] = str(error)
            if retry:
                gaps.append({'start': window['coreStart'], 'end': window['coreEnd'],
                             'reason': f'Chunk split retry failed: {error}'})
                progress('A transcript passage needs review')
                return
            progress('Retrying transcript part in two halves')
            middle = (window['coreStart'] + window['coreEnd']) / 2
            for index, (left, right) in enumerate(((window['coreStart'], middle), (middle, window['coreEnd']))):
                child = {'start': max(window['start'], left - OVERLAP_SECONDS / 2),
                         'end': min(window['end'], right + OVERLAP_SECONDS / 2),
                         'coreStart': left, 'coreEnd': right}
                decode(child, path.with_name(f'{path.stem}-retry-{index}.wav'), retry=True)
            return
        metadata['status'] = 'complete'
        narrow_window_segments(segments, samples)
        owned = [segment for segment in segments if window['coreStart'] <=
                 window['start'] + (segment['start'] + segment['end']) / 2 < window['coreEnd']]
        names = {}
        try:
            embeddings = speaker_embeddings(samples, segments)
            for local in sorted({segment['speaker'] for segment in owned}):
                if local != 'unassigned' and local in embeddings:
                    names[local] = assign_voice(voices, embeddings[local])
        except Exception as error:
            warning = f'Voice matching unavailable: {error}'
            if warning not in warnings: warnings.append(warning)
        for segment in owned:
            segment['speaker'] = names.get(segment['speaker'], 'unassigned')
            for key in ('start', 'end', 'modelStart', 'modelEnd'):
                if key in segment: segment[key] = round(segment[key] + window['start'], 2)
            turns.append(segment)

    windows = plan_chunks(duration)
    for index, window in enumerate(windows):
        progress(f'Transcribing part {index + 1} of {len(windows)}')
        decode(window, Path(wav).with_name(f'part-{index + 1}.wav'), output=initial_output if index == 0 else None)
    turns.sort(key=lambda segment: (segment['start'], segment['end']))
    text = ''.join(f"[{turn['start']:.2f}]" + (f"[{turn['speaker']}]" if turn['speaker'] != 'unassigned' else '') +
                   f"{turn['text']}[{turn['end']:.2f}]" for turn in turns)
    return {'segments': turns, 'text': text, 'gaps': gaps, 'chunks': chunks,
            'warnings': warnings, 'speakerEmbeddings': voices}
