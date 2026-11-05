"""Seed a disposable vault with the 60-minute AMI recording as an unreviewed meeting, plus the
ES2004 tracked items from research/ledger-engine/data/ami_v0/ES2004.chain. Uses the app's own
meeting and tracked-facts APIs (same code the app calls)."""
import hashlib
import json
import shutil
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
MEMORY = Path.home() / 'Documents/memoria-workspace/src-tauri/resources/memory'
sys.path.insert(0, str(MEMORY))
from engine import Engine, workspace_product  # noqa: E402
from temporal_service import temporal_api  # noqa: E402

VAULT = HERE / 'vault'
TITLE = 'Remote design meeting (AMI ES2004, 60 min)'
OBJECTS = [
    ('battery', 'Battery type', ['rechargeable', 'kinetic', 'conventional'], 'REVISE'),
    ('video_plus', 'Video Plus capability', ['included', 'excluded'], 'REVERSE'),
    ('docking', 'Docking station', ['included', 'excluded'], 'REVERSE'),
    ('lcd_colour', 'LCD screen colours', ['black and white', 'full colour'], 'REVISE'),
    ('speech', 'Speech recognition', ['included', 'excluded'], 'REVERSE'),
]


def main():
    if VAULT.exists():
        raise SystemExit(f'{VAULT} exists; remove it first')
    VAULT.mkdir()
    (VAULT / 'About this vault.md').write_text('# M2 long-meeting check\n\nDisposable vault: one 60-minute AMI meeting recording (CC BY 4.0).\n')
    identifier = str(uuid.uuid4())
    recording = VAULT / '.memoria-recordings' / identifier
    recording.mkdir(parents=True)
    shutil.copyfile(HERE / 'original.webm', recording / 'original.webm')
    digest = hashlib.sha256((recording / 'original.webm').read_bytes()).hexdigest()
    created = '2026-02-09T09:00:00.000Z'
    source = f'source-Remote-design-meeting-AMI-ES2004-60-min-{identifier}.md'
    (VAULT / source).write_text(
        f'---\ntype: Source\n_organized: true\ntitle: "{TITLE}"\nsource_filename: "meeting-{identifier}.webm"\nsha256: {digest}\n'
        f'extraction: text-only\nimported_at: "{created}"\n---\n# {TITLE}\n\n[Open original](<.memoria-recordings/{identifier}/original.webm>)\n\n'
        '## Page 1\n\nAMI Meeting Corpus ES2004b and the start of ES2004c (CC BY 4.0), joined into one 60-minute recording. '
        'Review the transcript before approving knowledge.\n')
    engine = Engine(VAULT)
    with engine.locked():
        saved = workspace_product(engine, {'action': 'save_meeting', 'record': {
            'id': identifier, 'title': TITLE, 'created': created, 'status': 'needs-review',
            'audioPath': f'.memoria-recordings/{identifier}/original.webm', 'sourcePath': source}})
        registry = temporal_api(engine, {'method': 'registry.set', 'params': {'objects': [
            {'object_id': key, 'label': label, 'kind': 'decision',
             'attributes': [{'name': 'outcome', 'type': 'enum', 'values': values, 'change_kind': change}]}
            for key, label, values, change in OBJECTS]}})
    engine.db.close()
    assert registry['ok'], registry
    print(json.dumps({'vault': str(VAULT), 'meetingId': identifier, 'meeting': saved.get('id', saved) if isinstance(saved, dict) else saved}))


if __name__ == '__main__':
    main()
