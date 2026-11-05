"""Score a long-meeting draft against the AMI reference words on the fixture clock.

WER uses the research normalisation (research/ledger-engine/scripts/asr_der_eval.py norm_tokens),
fillers reported both ways. Local error rates at the transcription part boundaries are compared
with mid-part control windows: stitching that loses or repeats words shows up as a boundary excess.
"""
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
FILLERS = {'hmm', 'mm', 'mhm', 'mmm', 'uh', 'um'}
_APOS = str.maketrans({'\u2019': "'", '\u2018': "'", '\u02bc': "'", '\u00b4': "'", '`': "'"})
_TAG = re.compile(r'[\[{<][^\]}>]*[\]}>]')
_DELETE = re.compile(r'[.,?!;:"()\[\]{}\u2026\u201c\u201d\u00ab\u00bb_]')
_SPLIT = re.compile(r"[^\w']+")


def norm_tokens(text):
    t = unicodedata.normalize('NFKC', text).translate(_APOS).lower()
    t = _TAG.sub(' ', t)
    t = _DELETE.sub('', t)
    return [x for x in (p.strip("'") for p in _SPLIT.split(t)) if x]


def align(ref, hyp):
    """Word-level Levenshtein with backtrace; returns ops [(kind, ref_index|None, hyp_index|None)]."""
    n, m = len(ref), len(hyp)
    vocabulary = {}
    r = np.array([vocabulary.setdefault(w, len(vocabulary)) for w in ref], dtype=np.int32)
    h = np.array([vocabulary.setdefault(w, len(vocabulary)) for w in hyp], dtype=np.int32)
    back = np.zeros((n + 1, m + 1), dtype=np.uint8)  # 0 diagonal, 1 deletion (up), 2 insertion (left)
    back[0, 1:] = 2
    back[1:, 0] = 1
    prev = np.arange(m + 1, dtype=np.int32)
    columns = np.arange(m + 1, dtype=np.int32)
    for i in range(1, n + 1):
        diagonal = prev[:-1] + (h != r[i - 1])
        up = prev[1:] + 1
        candidate = np.empty(m + 1, dtype=np.int32)
        candidate[0] = prev[0] + 1
        candidate[1:] = np.minimum(diagonal, up)
        current = np.minimum.accumulate(candidate - columns) + columns
        row = np.where(current == candidate, np.where(np.concatenate(([False], diagonal <= up)), 0, 1), 2).astype(np.uint8)
        row[0] = 1
        back[i] = row
        prev = current
    ops, i, j = [], n, m
    while i or j:
        step = back[i, j]
        if step == 0:
            ops.append(('match' if ref[i - 1] == hyp[j - 1] else 'sub', i - 1, j - 1)); i -= 1; j -= 1
        elif step == 1:
            ops.append(('del', i - 1, None)); i -= 1
        else:
            ops.append(('ins', None, j - 1)); j -= 1
    return ops[::-1], int(prev[-1])


def streams(reference, draft, fillers):
    ref = []
    for word in reference['words']:
        for token in norm_tokens(word['word']):
            if fillers or token not in FILLERS:
                ref.append((token, word['start'], word['speaker']))
    hyp = []
    for segment in sorted(draft['segments'], key=lambda s: (s['start'], s['end'])):
        tokens = [t for t in norm_tokens(segment['text']) if fillers or t not in FILLERS]
        span = max(segment['end'] - segment['start'], 0.01)
        hyp.extend((token, segment['start'] + span * (k + .5) / max(len(tokens), 1), segment['speaker']) for k, token in enumerate(tokens))
    return ref, hyp


def local_rate(ops, ref, hyp, centre, half=15.0):
    errors = words = 0
    for kind, i, j in ops:
        at = ref[i][1] if i is not None else hyp[j][1]
        if abs(at - centre) > half: continue
        words += i is not None
        errors += kind != 'match'
    return errors, words


def main(draft_path):
    reference = json.loads((HERE / 'reference.json').read_text())
    draft = json.loads(Path(draft_path).read_text())
    report = {'draft': str(draft_path), 'duration': draft.get('duration'), 'processingSeconds': draft.get('processingSeconds'),
              'segments': len(draft['segments']), 'lastSegmentEnd': max(s['end'] for s in draft['segments']),
              'firstSegmentStart': min(s['start'] for s in draft['segments']), 'gaps': draft.get('gaps'),
              'chunks': [{k: c.get(k) for k in ('start', 'end', 'coreStart', 'coreEnd', 'status', 'retry', 'reason')} for c in draft.get('chunks', [])],
              'warnings': draft.get('warnings'), 'speakers': Counter(s['speaker'] for s in draft['segments'])}
    for fillers in (False, True):
        ref, hyp = streams(reference, draft, fillers)
        ops, distance = align([t for t, _, _ in ref], [t for t, _, _ in hyp])
        counts = Counter(kind for kind, _, _ in ops)
        key = 'withFillers' if fillers else 'fillersRemoved'
        report[key] = {'refTokens': len(ref), 'hypTokens': len(hyp), 'wer': round(distance / len(ref), 4),
                       'substitutions': counts['sub'], 'deletions': counts['del'], 'insertions': counts['ins']}
        if fillers: continue
        # Part boundaries are the midpoints of each overlap; controls sit mid-part.
        boundaries = [c['coreEnd'] for c in draft.get('chunks', []) if c.get('status') == 'complete' and c['coreEnd'] < draft['duration'] - 1]
        boundary = [local_rate(ops, ref, hyp, b) for b in boundaries]
        control = [local_rate(ops, ref, hyp, b - 140) for b in boundaries]
        total = lambda rows: (sum(e for e, _ in rows), sum(w for _, w in rows))
        be, bw = total(boundary); ce, cw = total(control)
        report['boundaries'] = {'count': len(boundaries), 'windowSeconds': 30, 'boundaryErrorRate': round(be / max(bw, 1), 4), 'boundaryRefWords': bw,
                                'controlErrorRate': round(ce / max(cw, 1), 4), 'controlRefWords': cw,
                                'perBoundary': [{'at': round(b, 1), 'errors': e, 'refWords': w} for b, (e, w) in zip(boundaries, boundary)]}
        # Coverage: reference words in each 5-minute span against hypothesis words there.
        spans = defaultdict(lambda: [0, 0])
        for _, at, _ in ref: spans[int(at // 300)][0] += 1
        for _, at, _ in hyp: spans[int(at // 300)][1] += 1
        report['perFiveMinutes'] = [{'from': k * 300, 'refTokens': v[0], 'hypTokens': v[1]} for k, v in sorted(spans.items())]
        # Speaker purity: each draft speaker's words by the reference speaker they align to.
        by_label = defaultdict(Counter)
        for kind, i, j in ops:
            if kind in ('match', 'sub'): by_label[hyp[j][2]][ref[i][2]] += 1
        report['speakerPurity'] = {label: {'words': sum(c.values()), 'top': c.most_common(2)} for label, c in sorted(by_label.items())}
    print(json.dumps(report, indent=1, default=str))


if __name__ == '__main__':
    main(sys.argv[1])
