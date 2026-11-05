"""Build the UAT starter vault: the three fictional "Digital Procurement Pilot" steering-committee
meetings (research/ledger-engine/data/demo), recorded and with reviewed transcripts, and the items
to track, with nothing tracked yet.

Each meeting keeps its audio for playback and evidence moments. The reviewed transcript is the
reference script with its speaker turns timed from the reference RTTM: a correctly reviewed
transcript, so the tasks do not depend on speech-recognition errors. No model is loaded.

    /opt/homebrew/bin/python3.11 scripts/uat/build_demo_vault.py /Users/Shared/Memoria/demo-vault
"""
import hashlib
import json
import re
import shutil
import sys
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / 'research' / 'ledger-engine' / 'data' / 'demo'
sys.path.insert(0, str(REPO / 'src-tauri' / 'resources' / 'memory'))
from engine import Engine, workspace_product  # noqa: E402
from temporal_service import temporal_api  # noqa: E402

SPEAKERS = {'Aisha': 'S01', 'Raj': 'S02', 'Wei Ling': 'S03'}
# Meeting starts: 09:30 in Kuala Lumpur (UTC+8).
STARTS = {1: '2026-09-14T01:30:00.000Z', 2: '2026-09-28T01:30:00.000Z', 3: '2026-10-12T01:30:00.000Z'}
README = '''# Digital Procurement Pilot

Fictional steering committee used for user acceptance testing. Three meetings were recorded
and their transcripts reviewed. All names, vendors and numbers are invented.
'''


def turns_of(number):
    lines = [line for line in (DEMO / 'audio' / f'meeting_{number}.ref.txt').read_text().splitlines() if line.strip()]
    spans = [line.split() for line in (DEMO / 'audio' / f'meeting_{number}.rttm').read_text().splitlines() if line.startswith('SPEAKER')]
    if len(lines) != len(spans):
        raise SystemExit(f'meeting {number}: {len(lines)} reference lines but {len(spans)} RTTM turns')
    turns = []
    for line, span in zip(lines, spans):
        name, text = line.split(':', 1)
        if name.strip() != span[7].replace('_', ' '):
            raise SystemExit(f'meeting {number}: speaker mismatch {name!r} / {span[7]!r}')
        start = float(span[3])
        turns.append({'start': round(start, 2), 'end': round(start + float(span[4]), 2), 'speaker': SPEAKERS[name.strip()], 'text': text.strip()})
    return turns


def clock(seconds):
    minutes, rest = divmod(int(max(0, seconds)), 60)
    return f'{minutes}:{rest:02d}'


def main(target):
    vault = Path(target)
    if vault.exists() and any(vault.iterdir()):
        raise SystemExit(f'{vault} is not empty')
    vault.mkdir(parents=True, exist_ok=True)
    (vault / 'Digital Procurement Pilot.md').write_text(README)
    engine = Engine(vault)
    names = {code: name for name, code in SPEAKERS.items()}
    with engine.locked():
        for number in (1, 2, 3):
            title = next(line[2:].strip() for line in (DEMO / f'meeting_{number}.md').read_text().splitlines() if line.startswith('# '))
            identifier = str(uuid.uuid5(uuid.NAMESPACE_URL, f'memoria-uat-demo-meeting-{number}'))
            folder = vault / '.memoria-recordings' / identifier
            folder.mkdir(parents=True)
            shutil.copyfile(DEMO / 'audio' / f'meeting_{number}.wav', folder / 'original.wav')
            audio = f'.memoria-recordings/{identifier}/original.wav'
            turns = turns_of(number)
            text = '\n\n'.join(f"[{clock(turn['start'])}] {names[turn['speaker']]}: {turn['text']}" for turn in turns)
            data = text.encode()
            (vault / 'attachments').mkdir(exist_ok=True)
            attachment = f'attachments/transcript-{identifier}.txt'
            (vault / attachment).write_bytes(data)
            slug = re.sub(r'[^a-zA-Z0-9-]+', '-', title).strip('-')[:60]
            source = f'source-{slug}-reviewed-transcript-{identifier}.md'
            reviewed = f'{title} — reviewed transcript'
            (vault / source).write_text('\n'.join([
                '---', 'type: Source', '_organized: true', f'title: {json.dumps(reviewed)}', f'source_filename: "transcript-{identifier}.txt"',
                f'sha256: {hashlib.sha256(data).hexdigest()}', 'extraction: text-only', f'imported_at: {json.dumps(STARTS[number])}', '---',
                f'# {reviewed}', '', f'[Open original](<{attachment}>)', '', '## Page 1', '',
                f'[Listen to meeting audio](<{audio}>)\n\nReviewed by the facilitator from the meeting script; speaker names confirmed.\n\n{text}', '']))
            workspace_product(engine, {'action': 'save_meeting', 'record': {
                'id': identifier, 'title': title, 'created': STARTS[number], 'status': 'transcript-reviewed', 'audioPath': audio,
                'turns': turns, 'names': names, 'profileIds': {}, 'marks': [], 'transcriptPath': source}})
        registry = json.loads((DEMO / 'registry.json').read_text())
        for item in registry['objects']:
            for attribute in item['attributes']:
                if attribute['type'] == 'person':
                    attribute['type'] = 'text'  # the app tracks owners as names
                if attribute['type'] != 'enum':
                    attribute.pop('values', None)
        result = temporal_api(engine, {'method': 'registry.set', 'params': {'objects': registry['objects']}})
        if not result['ok']:
            raise SystemExit(result)
    engine.db.close()
    print(json.dumps({'vault': str(vault), 'meetings': 3, 'trackedItems': [item['label'] for item in registry['objects']]}))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/Users/Shared/Memoria/demo-vault')
