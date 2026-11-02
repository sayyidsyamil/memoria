"""Where in the hour the extracted knowledge and tracked facts come from (no silent truncation check).

Reads the M2 vault: knowledge proposals built from the reviewed transcript (evidence unit -> its
[m:ss] turn time) and tracked-fact proposals/facts (evidence audio offsets). Prints counts per
ten minutes and the tracked values against the ES2004 gold decisions.
"""
import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
MEMORY = Path.home() / 'Documents/memoria-workspace/src-tauri/resources/memory'
sys.path.insert(0, str(MEMORY))
from engine import Engine, units_for  # noqa: E402
from temporal_service import temporal_api  # noqa: E402

VAULT = HERE / 'vault'
STAMP = re.compile(r'^\[(\d+):(\d{2})')


def bucket(seconds):
    return f'{int(seconds // 600) * 10:02d}–{int(seconds // 600) * 10 + 10:02d} min'


def main():
    db = sqlite3.connect(VAULT / '.memoria-memory' / 'journal.sqlite')
    report = {'knowledge': [], 'tracked': {}}
    for status, payload in db.execute('select status, payload from proposals'):
        proposal = json.loads(payload)
        source = VAULT / proposal['sourcePath']
        if 'reviewed-transcript' not in proposal['sourcePath'] or not source.exists():
            continue
        units = {unit['id']: unit for unit in units_for(source.read_text())}
        times = []
        for claim in proposal['claims']:
            unit = units.get(claim.get('evidenceId'))
            match = STAMP.match(unit['text']) if unit else None
            if match: times.append(int(match[1]) * 60 + int(match[2]))
        report['knowledge'].append({'status': status, 'claims': len(proposal['claims']), 'units': len(units),
                                    'byTenMinutes': dict(sorted(Counter(bucket(t) for t in times).items())),
                                    'latestEvidence': f'{max(times) // 60}:{max(times) % 60:02d}' if times else None,
                                    'kinds': dict(Counter(claim['kind'] for claim in proposal['claims']))})
    db.close()
    engine = Engine(VAULT)
    with engine.locked():
        overview = temporal_api(engine, {'method': 'overview', 'params': {}})['data']
    engine.db.close()
    transcript = next(iter(sorted(VAULT.glob('source-*reviewed-transcript*.md'))), None)
    lines = [line for line in transcript.read_text().splitlines() if STAMP.match(line)] if transcript else []

    def time_of(quote):
        """A proposal lists its quote only: find the reviewed turn that holds it."""
        line = next((line for line in lines if quote and quote in line), None)
        match = STAMP.match(line) if line else None
        return int(match[1]) * 60 + int(match[2]) if match else None

    for label, items in (('proposals', overview['proposals']), ('facts', overview['facts'])):
        rows = []
        for item in items:
            evidence = item.get('evidence') or [{'quote': item.get('quote')}]
            starts = [e['audio_start'] if isinstance(e.get('audio_start'), (int, float)) else time_of(e.get('quote')) for e in evidence]
            rows.append({'item': item['object_id'], 'value': item['value'], 'at': [f'{int(s // 60)}:{int(s % 60):02d}' for s in starts if s is not None],
                         'quote': next((e.get('quote') for e in evidence if e.get('quote')), None)})
        report['tracked'][label] = rows
    print(json.dumps(report, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
