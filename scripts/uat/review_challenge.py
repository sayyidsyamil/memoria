"""Build and score the separate, controlled C1 review challenge. No language model.

    python3.11 scripts/uat/review_challenge.py build <fresh-vault> --receipt <outside.json>
    python3.11 scripts/uat/review_challenge.py grade <vault> --receipt <outside.json>

The supplied proposals are researcher-written: one wrong attribution and one supported
change. They are not measurements of the model's error rate. Core T1-T5 and SUS use
the ordinary starter vault; this challenge has its own workspace and results.

Build uses macOS speech synthesis to create clearly labelled fictional recordings.
Grade opens the fixture ledger read-only and never accepts or rejects a proposal.
Its JSON `passed` field is the challenge outcome; a zero exit code means scoring completed.
MEMORIA_MEMORY_DIR can select the installed app's Contents/Resources/memory directory.
"""
import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
import wave
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
MEMORY = Path(os.environ.get('MEMORIA_MEMORY_DIR', REPO / 'src-tauri/resources/memory')).expanduser()
if not (MEMORY / 'engine.py').is_file() and 'MEMORIA_MEMORY_DIR' not in os.environ:
    MEMORY = Path('/Applications/Memoria.app/Contents/Resources/memory')
if not (MEMORY / 'engine.py').is_file():
    raise SystemExit('Set MEMORIA_MEMORY_DIR to the app memory resources directory.')
sys.path.insert(0, str(MEMORY))
from engine import Engine, clock, workspace_product  # noqa: E402
from memoria_engine.pipeline import Candidate  # noqa: E402
from temporal_service import temporal_api  # noqa: E402
from temporal_support import temporal_home  # noqa: E402

FIXTURE = 'memoria-review-challenge-v1'
MARKER = '.memoria-memory/uat-fixture.json'
BASE_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, FIXTURE + '/baseline'))
FOLLOWUP_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, FIXTURE + '/follow-up'))
REGISTRY = [
    {'object_id': 'budget', 'label': 'Pilot budget (RM)', 'kind': 'decision',
     'attributes': [{'name': 'amount', 'type': 'number'}]},
    {'object_id': 'training', 'label': 'Staff training', 'kind': 'commitment',
     'attributes': [{'name': 'owner', 'type': 'text'}, {'name': 'deadline', 'type': 'date'}]},
]
BASELINE = [
    ('budget', 'amount', 280000, 'The approved pilot budget is RM 280,000.'),
    ('training', 'owner', 'Raj', 'Raj is responsible for staff training.'),
    ('training', 'deadline', '2026-11-03', 'Staff training is due on 3 November 2026.'),
]
CHALLENGE = [
    ('budget', 'amount', 12000, 'The training-workshop budget is RM 12,000. Keep it separate from the pilot budget.'),
    ('training', 'deadline', '2026-11-06', 'Staff training is now due on 6 November 2026. Raj remains the owner.'),
]
EXPECTED_CURRENT = {'budget.amount': 280000, 'training.owner': 'Raj', 'training.deadline': '2026-11-06'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fingerprint(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def write_new_json(path, value):
    path = Path(path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as out:
        json.dump(value, out, indent=2, ensure_ascii=False)
        out.write('\n')


def call(engine, method, params=None, extractor=None):
    with engine.locked():
        response = temporal_api(engine, {'method': method, 'params': params or {}}, extractor)
    if not response['ok']:
        raise ValueError(response['error']['message'])
    return response['data']


def synthesise(texts, output, voice='Samantha'):
    """Render each utterance to a file, then join PCM samples with exact turn offsets."""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    rate, silence = 16000, b'\0\0' * 8000
    frames, spans, position = [], [], 0
    with tempfile.TemporaryDirectory(prefix='uat-voice-', dir=output.parent) as scratch:
        for index, text in enumerate(texts):
            aiff, wav = Path(scratch) / f'{index}.aiff', Path(scratch) / f'{index}.wav'
            subprocess.run(['/usr/bin/say', '-v', voice, '-r', '165', '-o', str(aiff)],
                           input=text, text=True, check=True, capture_output=True)
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(aiff), '-ar', str(rate),
                            '-ac', '1', '-c:a', 'pcm_s16le', str(wav)], check=True, capture_output=True)
            with wave.open(str(wav), 'rb') as part:
                count = part.getnframes()
                data = part.readframes(count)
                assert (part.getframerate(), part.getnchannels(), part.getsampwidth()) == (rate, 1, 2)
            spans.append((position / rate, (position + count) / rate))
            frames.extend((data, silence))
            position += count + len(silence) // 2
    with wave.open(str(output), 'wb') as audio:
        audio.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        audio.writeframes(b''.join(frames))
    return spans


def save_meeting(engine, identifier, title, created, entries, audio_writer):
    root = engine.root
    audio = f'.memoria-recordings/{identifier}/original.wav'
    spans = audio_writer([entry[3] for entry in entries], root / audio)
    if len(spans) != len(entries):
        raise ValueError('Every fixture utterance needs an aligned audio span.')
    turns = [{'speaker': 'S01', 'start': start, 'end': end, 'text': entry[3]}
             for entry, (start, end) in zip(entries, spans)]
    text = '\n\n'.join(f"[{clock(t['start'])}] Aisha: {t['text']}" for t in turns)
    transcript = f'source-{identifier}.md'
    attachment = f'attachments/transcript-{identifier}.txt'
    (root / 'attachments').mkdir(exist_ok=True)
    (root / attachment).write_text(text + '\n', encoding='utf-8')
    (root / transcript).write_text('\n'.join([
        '---', 'type: Source', '_organized: true', f'title: {json.dumps(title + " — reviewed transcript")}',
        f'source_filename: "transcript-{identifier}.txt"', f'sha256: {digest(root / attachment)}',
        'extraction: text-only', f'imported_at: {json.dumps(created)}', '---',
        f'# {title} — reviewed transcript', '', f'[Open original](<{attachment}>)', '', '## Page 1', '',
        f'[Listen to meeting audio](<{audio}>)', '',
        'Fictional study recording, synthesised from the reference text. The transcript and speaker label are facilitator-prepared.',
        '', text, '',
    ]), encoding='utf-8')
    with engine.locked():
        workspace_product(engine, {'action': 'save_meeting', 'record': {
            'id': identifier, 'title': title, 'created': created, 'status': 'transcript-reviewed',
            'audioPath': audio, 'turns': turns, 'names': {'S01': 'Aisha'}, 'profileIds': {},
            'marks': [], 'transcriptPath': transcript,
        }})
    class WrittenFixture:
        name = 'researcher-written-uat-fixture'

        def extract(self, _context):
            return [Candidate(obj, attr, value, quote, index, None, 0.9)
                    for index, (obj, attr, value, quote) in enumerate(entries)]
    call(engine, 'ingest_reviewed_meeting', {'meetingId': identifier}, WrittenFixture())
    return [audio, transcript, attachment]


def read_connection(root):
    path = temporal_home(root) / 'ledger.sqlite'
    connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute('BEGIN')
    return connection


def build(vault, receipt_path, audio_writer=synthesise):
    root, receipt_path = Path(vault).expanduser().resolve(), Path(receipt_path).expanduser().resolve()
    if receipt_path.is_relative_to(root):
        raise ValueError('The facilitator receipt must be outside the participant vault.')
    if receipt_path.exists():
        raise ValueError('The receipt already exists; choose a fresh path.')
    if root.exists() and (not root.is_dir() or any(root.iterdir())):
        raise ValueError('The challenge vault must be a fresh, empty directory.')
    root.mkdir(parents=True, exist_ok=True)
    (root / 'Review exercise.md').write_text(
        '# Procurement review exercise\n\nFictional meeting material for a separate review exercise. '
        'All people, amounts and dates are invented.\n', encoding='utf-8')
    engine = Engine(root)
    try:
        call(engine, 'registry.set', {'objects': REGISTRY})
        sources = save_meeting(engine, BASE_ID, 'Procurement handover', '2026-10-12T01:30:00Z', BASELINE, audio_writer)
        baseline = call(engine, 'proposals.list')
        if len(baseline) != 3:
            raise ValueError('The fixture did not produce its three baseline facts.')
        for proposal in baseline:
            call(engine, 'proposals.accept', {'proposal_id': proposal['proposal_id'], 'reviewer': 'Facilitator',
                                             'note': 'Known baseline of a controlled fictional study fixture.'})
        sources += save_meeting(engine, FOLLOWUP_ID, 'Training follow-up', '2026-10-13T01:30:00Z', CHALLENGE, audio_writer)
        proposals = call(engine, 'proposals.list')
        if len(proposals) != 2 or any(p['meeting'] != FOLLOWUP_ID for p in proposals):
            raise ValueError('The challenge must start with exactly two pending follow-up proposals.')
        if not call(engine, 'check')['ok']:
            raise ValueError('Fixture ledger invariants failed.')
        cases = []
        with closing(read_connection(root)) as db:
            for proposal in proposals:
                payload = json.loads(db.execute('SELECT payload_json FROM proposals WHERE proposal_id = ?',
                                               (proposal['proposal_id'],)).fetchone()[0])
                supported = proposal['object_id'] == 'training'
                cases.append({'case': 'supported-deadline' if supported else 'unsupported-budget',
                              'proposal_id': proposal['proposal_id'], 'payload_sha256': fingerprint(payload),
                              'expected_action': 'accept' if supported else 'reject',
                              'object_id': proposal['object_id'], 'attribute': proposal['attribute'],
                              'value': proposal['value'], 'quote': proposal['quote']})
        marker = {'fixture': FIXTURE, 'synthetic': True, 'meeting_ids': [BASE_ID, FOLLOWUP_ID]}
        write_new_json(root / MARKER, marker)
        receipt = {'fixture': FIXTURE, 'vault': str(root), 'created': datetime.now(timezone.utc).isoformat(),
                   'origin': 'Researcher-written proposals with synthetic speech; no language-model generation.',
                   'separate_from': 'Core T1-T5, SUS and model-extraction accuracy results.',
                   'sources': {name: digest(root / name) for name in sources},
                   'registry_sha256': digest(temporal_home(root) / 'registry.json'), 'cases': cases,
                   'expected_current': EXPECTED_CURRENT,
                   'builder_sha256': digest(__file__),
                   'memory_source_sha256': {name: digest(MEMORY / name) for name in ('engine.py', 'temporal_service.py')}}
        write_new_json(receipt_path, receipt)
        return {'vault': str(root), 'receipt': str(receipt_path), 'pending_proposals': len(proposals), 'fixture': FIXTURE}
    finally:
        engine.db.close()


def current_value(db, obj, attr, instant):
    rows = db.execute(
        'SELECT f.value_json FROM validity v JOIN facts f ON f.fact_id = v.fact_id '
        'WHERE v.object_id = ? AND v.attribute = ? AND v.discriminator = ? AND v.tx_end IS NULL '
        'AND v.valid_from <= ? AND (v.valid_to IS NULL OR v.valid_to > ?)',
        (obj, attr, '', instant, instant)).fetchall()
    if len(rows) > 1:
        raise ValueError('Overlapping current facts; this fixture cannot be scored.')
    return json.loads(rows[0][0]) if rows else None


def grade(vault, receipt_path):
    root = Path(vault).expanduser().resolve()
    receipt_path = Path(receipt_path).expanduser().resolve()
    if receipt_path.is_relative_to(root):
        raise ValueError('The facilitator receipt must be outside the participant vault.')
    receipt = json.loads(receipt_path.read_text())
    marker = json.loads((root / MARKER).read_text())
    if receipt.get('fixture') != FIXTURE or marker.get('fixture') != FIXTURE or receipt.get('vault') != str(root):
        raise ValueError('This receipt does not identify the selected challenge vault.')
    cases = receipt.get('cases', [])
    if (len(cases) != 2 or {case.get('case') for case in cases} != {'unsupported-budget', 'supported-deadline'}
            or receipt.get('expected_current') != EXPECTED_CURRENT):
        raise ValueError('The receipt must retain both fixed challenge cases and their expected values.')
    for case in cases:
        supported = case['case'] == 'supported-deadline'
        expected = CHALLENGE[1 if supported else 0]
        actual = (case.get('object_id'), case.get('attribute'), case.get('value'), case.get('quote'))
        if actual != expected or case.get('expected_action') != ('accept' if supported else 'reject'):
            raise ValueError('The receipt does not match the frozen challenge recipe.')
    changed = [name for name, expected in receipt['sources'].items() if digest(root / name) != expected]
    if changed or digest(temporal_home(root) / 'registry.json') != receipt['registry_sha256']:
        raise ValueError('Fixture sources or registry changed; record the deviation instead of scoring this attempt.')
    results = []
    db = read_connection(root)
    try:
        rows = db.execute('SELECT p.proposal_id, p.payload_json, r.outcome FROM proposals p '
                          'LEFT JOIN reviews r ON r.proposal_id = p.proposal_id').fetchall()
        for case in cases:
            related = [row for row in rows if fingerprint(json.loads(row['payload_json'])) == case['payload_sha256']]
            if not any(row['proposal_id'] == case['proposal_id'] for row in related):
                raise ValueError('A fixture proposal is missing or has been replaced.')
            outcomes = [row['outcome'] or 'pending' for row in related]
            accepted = any(value in ('accepted', 'accepted_edited') for value in outcomes)
            handled = 'pending' not in outcomes
            passed = handled and (accepted if case['expected_action'] == 'accept' else 'rejected' in outcomes and not accepted)
            results.append({'case': case['case'], 'expected_action': case['expected_action'],
                            'reviews': [{'proposal_id': row['proposal_id'], 'outcome': row['outcome'] or 'pending'} for row in related],
                            'ever_accepted': accepted, 'handled': handled, 'passed': passed})
        instant = time.time_ns() // 1000
        current = {slot: current_value(db, *slot.split('.'), instant) for slot in EXPECTED_CURRENT}
    finally:
        db.close()
    values_correct = current == EXPECTED_CURRENT
    return {'fixture': FIXTURE, 'scored': datetime.now(timezone.utc).isoformat(), 'receipt_sha256': digest(receipt_path),
            'cases': results, 'current': current, 'expected_current': EXPECTED_CURRENT,
            'current_values_correct': values_correct, 'passed': values_correct and all(case['passed'] for case in results),
            'scope': 'Controlled C1 review decisions only. Source-reading reasons and times are observer-recorded; not model accuracy or participant UAT completion.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('build', 'grade'))
    parser.add_argument('vault', type=Path)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--voice', default='Samantha', help='macOS voice used when building the synthetic recordings')
    parser.add_argument('--output', type=Path, help='Save a new grading result outside the participant vault')
    args = parser.parse_args()
    try:
        if args.action == 'build':
            result = build(args.vault, args.receipt, lambda texts, path: synthesise(texts, path, args.voice))
        else:
            result = grade(args.vault, args.receipt)
            if args.output:
                if args.output.expanduser().resolve().is_relative_to(args.vault.expanduser().resolve()):
                    raise ValueError('Save the grading result outside the participant vault.')
                write_new_json(args.output, result)
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, sqlite3.Error, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Review challenge: {error}\n')


if __name__ == '__main__':
    main()
