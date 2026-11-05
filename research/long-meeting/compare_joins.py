"""Compare ways of joining the same 13 decoded parts (parts.json): ownership and voice matching only.

A: independent voice matching, midpoint ownership (first chunked build, run 1)
B: one voice per part speaker, pause-aligned cut, repeated openings trimmed (run 2)
C: B, and a speaker left ambiguous only between voices nobody else in its part took
"""
import copy
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path.home() / 'Documents/memoria-workspace/src-tauri/resources/memory'))
import transcript_chunks as T  # noqa: E402
from live_speech import assign_voice  # noqa: E402
import evaluate_transcript as E  # noqa: E402


def load():
    parts = json.loads((HERE / 'parts.json').read_text())
    for part in parts:
        for segment in part['segments']:
            for key in ('start', 'end', 'modelStart', 'modelEnd'):
                if key in segment: segment[key] = round(segment[key] + part['window']['start'], 2)
        part['embeddings'] = {label: np.array(vector, dtype=np.float32) for label, vector in part['embeddings'].items()}
    return parts


def variant_a(parts):
    voices, turns = {}, []
    for index, part in enumerate(parts):
        w = part['window']
        owned = [s for s in part['segments'] if w['coreStart'] <= (s['start'] + s['end']) / 2 < w['coreEnd']]
        names = {label: assign_voice(voices, part['embeddings'][label]) for label in sorted({s['speaker'] for s in owned})
                 if label != 'unassigned' and label in part['embeddings']}
        turns += [{**s, 'speaker': names.get(s['speaker'], 'unassigned')} for s in owned]
    return sorted(turns, key=lambda t: (t['start'], t['end']))


def assign_by_elimination(voices, local, threshold=.78, margin=.06, most=8):
    names, taken = {}, set()
    ranked = {label: sorted(((float(np.dot(vector, voice)), speaker) for speaker, voice in voices.items()), reverse=True)
              for label, vector in local.items()}
    pending = set(local)
    while True:
        best = None
        for label in sorted(pending):
            available = [(s, v) for s, v in ranked[label] if v not in taken]
            if available and available[0][0] >= threshold:
                ambiguous = len(available) > 1 and available[0][0] - available[1][0] < margin
                if not ambiguous and (best is None or available[0][0] > best[0]):
                    best = (available[0][0], label, available[0][1])
        if best is None: break
        _, label, speaker = best
        names[label] = speaker; taken.add(speaker); pending.discard(label)
    for label in sorted(pending):
        available = [(s, v) for s, v in ranked[label] if v not in taken]
        if available and available[0][0] >= threshold:
            names[label] = 'unassigned'  # still ambiguous between voices nobody else took
        elif len(voices) < most:
            speaker = f'S{len(voices) + 1:02d}'; voices[speaker] = local[label]; names[label] = speaker
        else:
            names[label] = 'unassigned'
    return names


def variant(parts, assign):
    original = T.assign_voices
    T.assign_voices = assign
    try:
        return T.drop_repeats(T.stitch(copy.deepcopy(parts), {}))
    finally:
        T.assign_voices = original


def score(turns):
    reference = json.loads((HERE / 'reference.json').read_text())
    ref, hyp = E.streams(reference, {'segments': turns}, False)
    ops, distance = E.align([t for t, _, _ in ref], [t for t, _, _ in hyp])
    by = defaultdict(Counter)
    for kind, i, j in ops:
        if kind in ('match', 'sub'): by[hyp[j][2]][ref[i][2].split('.')[1]] += 1
    aligned = sum(sum(c.values()) for c in by.values())
    pure = sum(c.most_common(1)[0][1] for label, c in by.items() if label != 'unassigned')
    return {'wer': round(distance / len(ref), 4), 'turns': len(turns), 'labels': sorted(by),
            'unassignedWords': sum(by['unassigned'].values()), 'unassignedShare': round(sum(by['unassigned'].values()) / aligned, 3),
            'purityOfLabelled': round(pure / max(aligned - sum(by['unassigned'].values()), 1), 3),
            'byLabel': {label: dict(c.most_common(3)) for label, c in sorted(by.items())}}


def main():
    parts = load()
    for name, turns in (('A', variant_a(parts)), ('B', variant(parts, T.assign_voices)), ('C', variant(parts, assign_by_elimination))):
        print(name, json.dumps(score(turns)))


if __name__ == '__main__':
    main()
