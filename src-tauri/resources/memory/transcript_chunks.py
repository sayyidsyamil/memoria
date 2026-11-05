"""Bounded full-recording decoding; overlap supplies context, never a second owner."""
import re
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


def assign_voices(voices, local, threshold=.78, margin=.06, most=8):
    """Map one part's speakers onto the recording's voices (first embedding of each).

    MOSS already told a part's speakers apart, so two of them never share a voice: the
    closer one keeps it and the other becomes a new voice, never a second-best match (on
    AMI ES2004, independent matching merged two people into one label). A speaker as close
    to two voices as to one stays unassigned; ambiguity is not evidence of a new voice.
    """
    import numpy as np
    names, claims = {}, []
    for label, vector in sorted(local.items()):
        ranked = sorted(((float(np.dot(vector, voice)), speaker) for speaker, voice in voices.items()), reverse=True)
        if len(ranked) > 1 and ranked[0][0] >= threshold and ranked[0][0] - ranked[1][0] < margin:
            names[label] = 'unassigned'
        elif ranked and ranked[0][0] >= threshold:
            claims.append((ranked[0][0], label, ranked[0][1]))
    taken = set()
    for _, label, speaker in sorted(claims, reverse=True):
        if speaker not in taken:
            names[label] = speaker
            taken.add(speaker)
    for label in sorted(local):
        if label in names: continue
        if len(voices) >= most:
            names[label] = 'unassigned'
            continue
        speaker = f'S{len(voices) + 1:02d}'
        voices[speaker] = local[label]
        names[label] = speaker
    return names


def transcribe_chunks(model, wav, duration, progress, initial_output=None):
    """Retry saturated/invalid windows once in halves; publish gaps, not partial output."""
    import soundfile as sf
    from transcribe import complete_segments, validate_segments
    from live_speech import narrow_window_segments
    from voice_profiles import speaker_embeddings
    gaps, chunks, warnings, voices, parts = [], [], [], {}, []

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
        try:
            embeddings = speaker_embeddings(samples, segments)
        except Exception as error:
            embeddings = {}
            warning = f'Voice matching unavailable: {error}'
            if warning not in warnings: warnings.append(warning)
        for segment in segments:
            for key in ('start', 'end', 'modelStart', 'modelEnd'):
                if key in segment: segment[key] = round(segment[key] + window['start'], 2)
        parts.append({'window': window, 'segments': segments, 'embeddings': embeddings})

    windows = plan_chunks(duration)
    for index, window in enumerate(windows):
        progress(f'Transcribing part {index + 1} of {len(windows)}')
        decode(window, Path(wav).with_name(f'part-{index + 1}.wav'), output=initial_output if index == 0 else None)
    turns = drop_repeats(stitch(parts, voices))
    text = ''.join(f"[{turn['start']:.2f}]" + (f"[{turn['speaker']}]" if turn['speaker'] != 'unassigned' else '') +
                   f"{turn['text']}[{turn['end']:.2f}]" for turn in turns)
    return {'segments': turns, 'text': text, 'gaps': gaps, 'chunks': chunks,
            'warnings': warnings, 'speakerEmbeddings': voices}


def common_pause(segments, nominal, least=.2, reach=OVERLAP_SECONDS / 2 - 2):
    """The moment nearest the nominal boundary that no turn of either part covers, within the overlap
    but clear of its edges, where a part may cut a word off; else the nominal boundary."""
    low, high = nominal - reach, nominal + reach
    free, cursor = [], low
    for start, end in sorted((s['start'], s['end']) for s in segments if s['end'] > low and s['start'] < high):
        if start - cursor >= least: free.append((cursor, start))
        cursor = max(cursor, end)
    if high - cursor >= least: free.append((cursor, high))
    moments = [min(max(nominal, start + least / 2), end - least / 2) for start, end in free]
    return min(moments, key=lambda moment: abs(moment - nominal), default=nominal)


def stitch(parts, voices):
    """Each part owns the turns whose midpoint lies between its two cuts. A cut starts at the middle of
    the overlap and moves to a pause both parts agree on: a passage the parts segment differently is
    then owned once, not twice or by neither (AMI ES2004 lost a 10-word passage at the middle)."""
    parts = sorted(parts, key=lambda part: part['window']['coreStart'])
    bounds = [[part['window']['coreStart'], part['window']['coreEnd']] for part in parts]
    for index in range(len(parts) - 1):
        if bounds[index][1] == bounds[index + 1][0]:
            cut = common_pause(parts[index]['segments'] + parts[index + 1]['segments'], bounds[index][1])
            bounds[index][1] = bounds[index + 1][0] = cut
    turns = []
    for index, (part, (low, high)) in enumerate(zip(parts, bounds)):
        owned = [segment for segment in part['segments'] if low <= (segment['start'] + segment['end']) / 2 < high]
        names = assign_voices(voices, {label: part['embeddings'][label] for label in {segment['speaker'] for segment in owned}
                                       if label != 'unassigned' and label in part['embeddings']})
        for segment in owned:
            turns.append({**segment, 'speaker': names.get(segment['speaker'], 'unassigned'), 'part': index})
    return sorted(turns, key=lambda turn: (turn['start'], turn['end']))


def _word(token):
    return re.sub(r"[^\w']+", '', token.casefold()).strip("'")


def drop_repeats(turns, least=3):
    """Neighbouring parts both hear their overlap. When the two segment it differently, a passage can
    be owned twice: a turn from the later part then opens with the words an overlapping turn from the
    earlier part ended on (seen at 2 of 12 boundaries in an hour of AMI). Keep those words once;
    anything not repeated word for word is left for review."""
    kept = []
    for turn in turns:
        earlier = next((t for t in reversed(kept) if t['part'] != turn['part'] and t['end'] > turn['start']), None)
        if earlier:
            before = [w for w in map(_word, earlier['text'].split()) if w]
            tokens = turn['text'].split()
            after = [w for w in map(_word, tokens) if w]
            repeat = max((k for k in range(least, min(len(before), len(after)) + 1) if before[-k:] == after[:k]), default=0)
            if repeat:
                seen, cut = 0, 0
                while seen < repeat:
                    seen += bool(_word(tokens[cut]))
                    cut += 1
                rest = ' '.join(tokens[cut:]).lstrip(',.;:!?- ')
                if not rest:
                    continue
                turn = {**turn, 'text': rest[0].upper() + rest[1:], 'start': max(turn['start'], earlier['end'])}
        kept.append(turn)
    for turn in kept:
        turn.pop('part', None)
    return kept
