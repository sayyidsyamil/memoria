"""False alerts of the app's live check on real, unrelated speech.

Every turn of the 60-minute AMI ES2004 transcript (a design team discussing a TV remote) is
checked against the approved tracked facts of the fictional procurement pilot (vendor, budget,
go-live date, owners and deadlines). The meeting is about something else, so every alert is false.
Uses the app's live_check with its verifier and guard through a running Qwen worker
(MEMORIA_QWEN_SOCKET); no model is loaded here.

    MEMORIA_QWEN_SOCKET=... python3.11 unrelated_speech.py <ledger-vault> <ami-draft.json> <out.jsonl>
"""
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'src-tauri' / 'resources' / 'memory'))
import live_assistance  # noqa: E402


def main(ledger_vault, draft_path, output):
    turns = [segment['text'] for segment in json.loads(Path(draft_path).read_text())['segments'] if segment['text'].strip()]
    with tempfile.TemporaryDirectory(prefix='memoria-unrelated-') as folder:
        root = Path(folder)
        shutil.copytree(Path(ledger_vault) / '.memoria-memory' / 'temporal', root / '.memoria-memory' / 'temporal')
        engine = SimpleNamespace(root=root)
        rows, started = [], time.perf_counter()
        for statement in turns:
            asked = []

            def verifier(spoken, facts):
                # Counts the turns that share a word with a tracked item and so reach the model.
                asked.append([fact['label'] for fact in facts])
                return live_assistance._shared_verifier(spoken, facts)

            reply = live_assistance.live_check(engine, {'statement': statement}, verifier=verifier)
            data = reply.get('data', {})
            rows.append({'statement': statement, 'status': data.get('status', 'error'), 'cues': data.get('cues', []),
                         'modelChecked': asked[0] if asked else None, 'warnings': data.get('warnings', []),
                         'seconds': data.get('seconds'), 'error': reply.get('error')})
    with open(output, 'x') as out:
        for row in rows:
            out.write(json.dumps(row, ensure_ascii=False) + '\n')
    alerts = [row for row in rows if row['cues']]
    checked = [row for row in rows if row['modelChecked']]
    print(json.dumps({'turns': len(rows), 'alerts': len(alerts), 'falseAlertRate': round(len(alerts) / len(rows), 4),
                      'uncertain': sum(row['status'] == 'uncertain' for row in rows), 'errors': sum(row['status'] == 'error' for row in rows),
                      'modelChecked': len(checked), 'alertsWhenModelChecked': sum(bool(row['cues']) for row in checked), 'minutes': round((time.perf_counter() - started) / 60, 1),
                      'alertExamples': [(row['statement'][:100], row['cues'][0]['label'], row['cues'][0]['currentValue']) for row in alerts[:10]]}, indent=1))


if __name__ == '__main__':
    main(*sys.argv[1:4])
