"""Evaluate the app's read-only live_check, not the historical research auditor.

No model libraries are imported or weights loaded. Real calls MUST use the app's
resident worker via MEMORIA_QWEN_SOCKET. See APP_LIVE_CHECK.md for mapping limits.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
MEMORY = HERE.parents[1] / 'src-tauri' / 'resources' / 'memory'
sys.path.insert(0, str(MEMORY))

from live_assistance import live_check
from memoria_engine.pipeline import Candidate
from memoria_engine.service import Service
from temporal_support import temporal_home

ALERTS = ('OUTDATED', 'CONTRADICTS')
ITEM = re.compile(r'^\s*[-*]\s*\[([^\]]+)\]\s*(.+)$', re.M)
REPLACEMENT = re.compile(r'\s+\(replaces (.*)\)\s*$', re.I)
LABEL_STOP = set('the a an it they we this that was were is are has have had decided agreed realized to will would must should be been'.split())


def sha256(text):
    return hashlib.sha256(text.encode()).hexdigest()


def read_lines(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def load_inputs(split='test'):
    stem = 'memoria_bench_dev' if split == 'dev' else 'memoria_bench'
    rows_path = HERE / 'data' / f'{stem}.jsonl'
    provenance_path = HERE / 'data' / f'{stem}.provenance.jsonl'
    rows, provenance = read_lines(rows_path), read_lines(provenance_path)
    # The frozen cache contains the same versioned decisions used by M2. Ignore
    # absolute versioned_file paths: they refer to the retired app's old folder.
    cache_path = HERE / 'results' / 'cache' / f'{split}.json'
    if cache_path.is_file():
        cache = json.loads(cache_path.read_text())
        if any(cache['stamp'][key] != sha256(path.read_text())
               for key, path in (('rows', rows_path), ('provenance', provenance_path))):
            raise ValueError('Benchmark cache does not match the probe/provenance bytes.')
        memories = {name: '\n'.join(f"- {item['citation']} {item['text']}" for item in series['items']) + '\n'
                    for name, series in cache['series'].items()}
    else:
        # Corpus-only reconstruction; do NOT import run_benchmarks.build_cache,
        # memoria or guard: they can load a separate model or embedder.
        from ami_loader import Series
        from generate_bench import memory_for
        memories = {name: memory_for(name, list(Series(name, history_only=True).decisions), rows, provenance)
                    for name in sorted({r['series_id'] for r in rows})}
    if {r['series_id'] for r in rows} - memories.keys():
        raise ValueError('Missing series memory.')
    return rows, provenance, memories


def slot(citation, text):
    """One independent text slot per decision; no probe/gold-assisted extraction.

    First content word supplies an explicit subject; the whole current sentence
    supplies the lexical attribute descriptor and proposition value. This avoids
    silently discarding unparsed clauses, but is NOT a normal user registry.
    """
    words = re.findall(r'[^\W\d_]+', text, re.UNICODE)
    label = next((w for w in words if w.casefold() not in LABEL_STOP), 'Decision')
    return {'object_id': 'decision-' + sha256(citation)[:16], 'label': label,
            'kind': 'decision', 'attributes': [{'name': text, 'type': 'text'}]}


def build_workspace(root, memory, provenance=()):
    """Approve deterministic extracted fixtures via preserved Service APIs.

    Returns current fact ID -> original benchmark citation. Real and synthetic
    replacement values are approved earlier in the SAME slot, not just appended
    to the prompt. No model/extractor inference and no edits to vendor code.
    """
    service = Service(str(temporal_home(root)), extractor='none')
    citation_of = {}
    try:
        items = ITEM.findall(memory)
        if not items or len({c for c, _ in items}) != len(items):
            raise ValueError('Memory must contain distinct cited decisions.')
        specs = [(citation, text, slot(citation, REPLACEMENT.sub('', text))) for citation, text in items]
        service.registry_set([spec for _, _, spec in specs])

        def approve(spec, value, quote, meeting, occurred, speaker):
            attribute = spec['attributes'][0]['name']

            class Extractor:
                name = 'benchmark-fixture'
                def extract(self, context):
                    return [Candidate(spec['object_id'], attribute, value, quote, 0, None, 1.0)]

            service.extractor = lambda kind: Extractor()
            stamp = re.search(r':(\d+):(\d+)', meeting)
            start = int(stamp[1]) * 60 + int(stamp[2]) if stamp else 0
            # Ledger source identity hashes the rendered turns, not meeting_id.
            # Cite this fixture in its non-human speaker label so duplicate AMI
            # summary sentences from different meetings stay distinct sources.
            result = service.meetings_ingest(meeting, [{'speaker': f'{speaker} [{meeting}]', 'start': start, 'text': quote}],
                occurred_at=occurred, extractor='keyword', policy='confirm_all')
            pending = [i['proposal_id'] for i in result['items'] if i.get('proposal_id') is not None]
            if len(pending) != 1:
                raise ValueError(f'Fixture did not produce one proposal: {result}')
            return service.proposals_accept(pending[0], reviewer='benchmark-fixture')['fact_id']

        for citation, text, spec in specs:
            replacement = REPLACEMENT.search(text)
            previous = replacement[1].split('; ') if replacement else []
            for index, value in enumerate(previous):
                real = next((p for p in provenance if p.get('decision') == citation and
                             p.get('basis') == 'real-supersession' and p.get('replaces') == value), None)
                quote = real['old_text'] if real else value
                meeting = real['old_decision'] if real else f'{citation}-synthetic-history-{index}'
                approve(spec, quote, quote, meeting, f'2000-01-{index + 1:02d}T00:00:00Z',
                        'AMI decision summary' if real else 'Synthetic supersession fixture')
            fact_id = approve(spec, REPLACEMENT.sub('', text), text, citation,
                              '2001-01-01T00:00:00Z', 'AMI decision summary')
            citation_of[fact_id] = f'[{citation}]'
        return citation_of
    finally:
        service.pipe.ledger.close()


def run(probes, memories, provenance=(), verifier=None, scorer=None):
    """Run app checks with injectable verifier(statement, facts)/scorer(messages).

    Without BOTH fakes a resident socket must be explicitly supplied: this harness
    must never take engine.local_generator's worker-start fallback.
    """
    if (verifier is None or scorer is None) and not os.environ.get('MEMORIA_QWEN_SOCKET'):
        raise ValueError('Set MEMORIA_QWEN_SOCKET to the running app worker (no model is loaded by this harness).')
    rows = []
    # One disposable workspace per series, cleaned even on model/socket errors.
    for series in sorted({p['series_id'] for p in probes}):
        with tempfile.TemporaryDirectory(prefix='memoria-app-bench-') as folder:
            root = Path(folder)
            citation_of = build_workspace(root, memories[series], provenance)
            engine = SimpleNamespace(root=root)
            for probe in (p for p in probes if p['series_id'] == series):
                reply = live_check(engine, {'statement': probe['statement']}, verifier=verifier, scorer=scorer)
                data = reply.get('data', {})
                cues = data.get('cues', [])
                alert = bool(cues)
                # Binary projection ONLY. These placeholders are for the existing
                # alert metric helpers, never a six-class accuracy/Macro-F1 claim.
                rows.append({**probe, 'system': 'APP_LIVE_CHECK', 'alert': alert,
                    'pred': 'CONTRADICTS' if alert else 'INSUFFICIENT_EVIDENCE',
                    'citation': citation_of.get(cues[0]['factId'], '') if cues else '',
                    'citations': [citation_of.get(c['factId'], '') for c in cues],
                    'latency_ms': data.get('seconds', 0) * 1000, 'status': data.get('status', 'error'),
                    'warnings': data.get('warnings', []), 'error': reply.get('error'),
                    'cues': cues, 'memory_sha256': sha256(memories[series])})
    return rows


def summarise(rows):
    import eval_metrics as E
    if not rows:
        raise ValueError('No probes to score.')
    metrics = E.scores(E.confusion_matrix(rows))
    keys = ('alert_precision', 'alert_recall', 'false_alarm')
    result = {key: metrics[key] for key in ('n', 'tp', 'fp', 'fn', 'tn', *keys)}
    result.update(errors=sum(r['status'] == 'error' for r in rows),
                  uncertain=sum(r['status'] == 'uncertain' for r in rows),
                  p50_ms=E.percentile([r['latency_ms'] for r in rows], 50),
                  p95_ms=E.percentile([r['latency_ms'] for r in rows], 95),
                  mapping='binary alert/no-alert only; pred is a placeholder, not a six-class prediction')
    if len({r['series_id'] for r in rows}) >= 10:
        result['ci'] = E.cluster_bootstrap(rows, keys=keys)
    return result


def compare(rows, reference, system):
    """Paired binary tests only, refusing partial/misaligned probe sets."""
    import eval_metrics as E
    import stat_tests as T
    a, b = T.paired_systems(rows + reference, 'APP_LIVE_CHECK', system)
    ar, br = [T.alert_right(r) for r in a], [T.alert_right(r) for r in b]
    return {'reference': system, 'mcnemar_alert': T.mcnemar(ar, br),
            'series_sign_alert': T.series_sign(ar, br, [r['series_id'] for r in a]),
            'paired_bootstrap': E.paired_bootstrap(a, b, keys=('alert_recall', 'false_alarm'))}


def finite_json(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: finite_json(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [finite_json(v) for v in value]
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--split', choices=('test', 'dev'), default='test')
    parser.add_argument('--dev', action='store_true', help='alias for --split dev')
    parser.add_argument('--limit', type=int, help='first N probes; partial results, not a benchmark score')
    parser.add_argument('--output', type=Path, required=True, help='NEW JSONL prediction file, never a frozen result')
    parser.add_argument('--compare', type=Path, help='existing prediction JSONL for paired binary comparison')
    parser.add_argument('--reference-system', default='M2')
    args = parser.parse_args(argv)
    if args.limit is not None and args.limit <= 0:
        parser.error('--limit must be positive')
    if not os.environ.get('MEMORIA_QWEN_SOCKET'):
        parser.error('MEMORIA_QWEN_SOCKET must name the app resident Qwen socket; no standalone worker is started')
    if args.output.exists():
        parser.error('--output must not already exist (frozen files are never overwritten)')
    split = 'dev' if args.dev else args.split
    probes, provenance, memories = load_inputs(split)
    if args.limit is not None:
        probes = probes[:args.limit]
    rows = run(probes, memories, provenance)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as out:
        for row in rows:
            out.write(json.dumps(finite_json(row), ensure_ascii=False, allow_nan=False) + '\n')
    summary = {**summarise(rows), 'split': split, 'limit': args.limit,
               'guard': os.environ.get('MEMORIA_GUARD', 'on'), 'socket': os.environ['MEMORIA_QWEN_SOCKET']}
    if args.compare:
        summary['comparison'] = compare(rows, read_lines(args.compare), args.reference_system)
    print(json.dumps(finite_json(summary), indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
