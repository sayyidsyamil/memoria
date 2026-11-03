"""Verify a disposable test instance through its installed engine and resident workers.

    python3.11 -B scripts/uat/smoke_installed.py --pid PID --expected-version 0.3.2 \
      --pristine /path/to/pristine-demo --output /path/to/new-smoke.json --restart-worker

Start Memoria with --memoria-vault-instance first. This creates a new copy of the
pristine demo and never tests against the application's normal workspace. The optional
restart check kills only the Qwen worker using that test instance's private socket.
This is an installed-worker smoke test, not a native UI, microphone or participant test.
"""
import argparse
import hashlib
import json
import os
import plistlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

sys.dont_write_bytecode = True
from build_demo_vault import SPEAKERS, turns_of  # noqa: E402
from score_demo import GOLD, QUESTIONS, same  # noqa: E402


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--expected-version', required=True)
    parser.add_argument('--app', type=Path, default=Path('/Applications/Memoria.app'))
    parser.add_argument('--pristine', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, default=Path(tempfile.gettempdir()) / 'opencode')
    parser.add_argument('--restart-worker', action='store_true')
    args = parser.parse_args()
    app, pristine, output = (p.expanduser().resolve() for p in (args.app, args.pristine, args.output))
    if output.exists():
        parser.error('The output already exists; preserve earlier results and choose a fresh path.')
    with (app / 'Contents/Info.plist').open('rb') as handle:
        version = plistlib.load(handle)['CFBundleShortVersionString']
    if version != args.expected_version:
        parser.error(f'Expected {args.expected_version}, found {version}.')
    command = subprocess.check_output(['/bin/ps', '-p', str(args.pid), '-o', 'args='], text=True).strip()
    binary = app / 'Contents/MacOS/memoria'
    if str(binary) not in command or '--memoria-vault-instance' not in command:
        parser.error('PID must be the selected app launched explicitly as a disposable vault instance.')
    if not (pristine / '.memoria-memory/temporal/registry.json').is_file():
        parser.error('Build a pristine starter with build_demo_vault.py first.')
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    for kind in ('qwen', 'embed'):
        matches = list(Path(tempfile.gettempdir()).glob(f'mm-{args.pid}-*-{kind}.sock'))
        if len(matches) != 1 or not matches[0].is_socket():
            parser.error(f'Expected one resident {kind} socket for the test app.')
        env[f'MEMORIA_{kind.upper()}_SOCKET'] = str(matches[0])
    args.scratch.mkdir(parents=True, exist_ok=True)
    vault = Path(tempfile.mkdtemp(prefix=f'release-{version}-', dir=args.scratch)) / 'vault'
    shutil.copytree(pristine, vault)
    print(f'Fresh smoke vault: {vault}', flush=True)
    engine = app / 'Contents/Resources/memory/engine.py'

    def call(action, target=None, **fields):
        done = subprocess.run([sys.executable, '-B', '-u', str(engine)],
                              input=json.dumps({'action': action, 'vaultPath': str(target or vault), **fields}),
                              text=True, capture_output=True, env=env, timeout=300, check=True)
        for line in reversed(done.stdout.splitlines()):
            reply = json.loads(line)
            if 'error' in reply:
                raise RuntimeError(reply['error'])
            if 'result' in reply:
                result = reply['result']
                if isinstance(result, dict) and (result.get('ok') is False or result.get('error')):
                    raise RuntimeError(result)
                return result
        raise RuntimeError(f'No result from installed engine: {done.stdout[-500:]} {done.stderr[-500:]}')

    def temporal(method, target=None, **params):
        return call('temporal_api', target=target, method=method, params=params)['data']

    def items(answer):
        return [item['text'] for section in answer.get('sections', []) for item in section['items']]

    initial = temporal('overview')
    assert not initial['facts'] and not initial['proposals'], 'The starter is not pristine.'
    sources = {str(uuid.uuid5(uuid.NAMESPACE_URL, f'memoria-uat-demo-meeting-{n}')): turns_of(n) for n in (1, 2, 3)}
    names = {identifier: name for name, identifier in SPEAKERS.items()}
    started = time.perf_counter()
    for meeting in sources:
        temporal('ingest_reviewed_meeting', meetingId=meeting)
    t1 = round(time.perf_counter() - started, 2)
    proposals = temporal('overview')['proposals']
    wrong = [p for p in proposals if not any(p['object_id'] == o and p['attribute'] == a and same(p['value'], v) for o, a, v in GOLD)]
    missing = [g for g in GOLD if not any(p['object_id'] == g[0] and p['attribute'] == g[1] and same(p['value'], g[2]) for p in proposals)]
    ungrounded = [p for p in proposals if not p.get('quote') or not any(
        ' '.join(p['quote'].split()) in ' '.join(t['text'].split()) and p['speaker'] == names[t['speaker']]
        for t in sources.get(p['meeting'], []))]
    assert not wrong and not missing and not ungrounded, {'wrong_values': wrong, 'missing': missing, 'ungrounded': ungrounded}
    print(f'T1: {len(proposals)} values match the key; all {len(GOLD)} expected events; quotes grounded; {t1}s', flush=True)
    # Keep the actual model proposals for a separate, presenter-only opening demonstration.
    # No engine process is open on this vault between requests, so its databases have closed.
    demo = vault.parent / 'advantage-demo'
    shutil.copytree(vault, demo)
    vendor_changes = sorted((p for p in proposals if p['object_id'] == 'vendor' and p['value'] == 'Beta Cloud'),
                            key=lambda p: p['proposal_id'])
    assert vendor_changes, 'No vendor-change proposal for the opening demonstration.'
    held = vendor_changes[0]['proposal_id']
    for proposal in sorted(proposals, key=lambda p: p['proposal_id']):
        if proposal['proposal_id'] == held:
            continue
        method = 'proposals.reject' if proposal in vendor_changes else 'proposals.accept'
        temporal(method, target=demo, proposal_id=proposal['proposal_id'], reviewer='Demo setup',
                 note='Presenter-only preparation; the vendor change is left for the live demonstration.')
    demo_pending = temporal('proposals.list', target=demo)
    assert len(demo_pending) == 1 and demo_pending[0]['proposal_id'] == held
    assert temporal('query', target=demo, type='current', object_id='vendor', attribute='outcome')['answer'] == 'Alpha Systems'
    print(f'Opening-demo vault: {demo} (Alpha approved, one Beta proposal pending)', flush=True)
    for proposal in proposals:
        temporal('proposals.accept', proposal_id=proposal['proposal_id'], reviewer='Release smoke (script)')
    owner = next(f for f in temporal('overview')['facts'] if f['object_id'] == 'training' and f['attribute'] == 'owner')
    correction_reason = 'The chair confirmed the recorded owner should be Raj.'
    temporal('facts.correct', fact_id=owner['fact_id'], value='Raj', reason=correction_reason, reviewer='Release smoke (script)')
    owner_answer = call('ask', question='Who owns Staff training?')
    assert owner_answer.get('source') == 'tracked-facts' and any('Raj' in text for text in items(owner_answer)), owner_answer
    manual = [citation for citation in owner_answer['citations'] if citation.get('kind') == 'manual-correction'
              and citation.get('objectId') == 'training' and citation.get('attribute') == 'owner']
    assert len(manual) == 1 and manual[0]['correction']['reason'] == correction_reason, 'Ask omitted the recorded correction reason.'
    assert 'quote' not in manual[0] and 'moment' not in manual[0], 'A manual correction was presented as transcript evidence.'
    live_owner = call('live_ask', question='Who owns Staff training?')
    assert correction_reason in json.dumps(live_owner, ensure_ascii=False), 'Live Ask omitted the recorded correction reason.'
    assert not temporal('proposals.list')
    vendor_now = temporal('query', type='current', object_id='vendor', attribute='outcome')
    vendor_past = temporal('query', type='as_of_valid', object_id='vendor', attribute='outcome', valid_at='2026-09-27')
    vendor_history = temporal('facts.history', object_id='vendor', attribute='outcome')
    assert vendor_now['answer'] == 'Beta Cloud' and vendor_past['answer'] == 'Alpha Systems'
    assert {'Alpha Systems', 'Beta Cloud'} <= {fact['value'] for fact in vendor_history}
    assert vendor_now['evidence'] and vendor_past['evidence']
    answers = []
    for question, expected in zip(QUESTIONS, ('9 Nov 2026', '250,000', 'changed once')):
        answer = items(call('ask', question=question))
        assert answer and expected in answer[0], (question, answer)
        answers.append({'question': question, 'answer': answer})
        print(f'T4: {answer[0]}', flush=True)
    brief = call('brief', question='Next steering committee meeting')
    open_items = next(s['items'] for s in brief['sections'] if s['heading'] == 'Open commitments')
    open_text = ' '.join(i['text'] for i in open_items)
    assert all(text in open_text for text in ('Staff training', 'Raj', '3 Nov 2026', 'Data migration', 'Wei Ling', '23 Oct 2026')), open_text
    training = next(item for item in open_items if 'Staff training' in item['text'])
    by_id = {citation['id']: citation for citation in brief.get('citations', [])}
    training_evidence = {'item': training, 'citations': [by_id[identifier] for identifier in training.get('citations', [])]}
    assert correction_reason in json.dumps(training_evidence, ensure_ascii=False), 'The brief omitted the owner correction reason.'
    saved = call('save_brief', id=str(uuid.uuid4()), topic='Next steering committee meeting', result=brief)
    saved_page = (vault / saved['pagePath']).read_text()
    assert f'Reason: {correction_reason}' in saved_page and f'> {correction_reason}' not in saved_page
    assert any(dependency['factId'] == manual[0]['factId'] and dependency['requiresCurrent']
               for dependency in saved['factDependencies']), 'The saved brief omitted its corrected-owner dependency.'
    assert temporal('check')['ok']

    def vendor_check():
        cues = call('live_check', statement='Gamma Solutions is our vendor now.')['data']['cues']
        assert any(c['label'] == 'Vendor' and c['currentValue'] == 'Beta Cloud' for c in cues), cues

    vendor_check()
    for statement in ('The vendor is Beta Cloud.', 'The pilot budget is 280,000 ringgit.'):
        assert not call('live_check', statement=statement)['data']['cues'], statement
    restart = None
    if args.restart_worker:
        socket = Path(env['MEMORIA_QWEN_SOCKET'])

        def qwen_pid():
            processes = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,args='], text=True).splitlines()
            matches = []
            for line in processes:
                fields = line.strip().split(None, 2)
                if len(fields) == 3 and fields[1] == str(args.pid) and 'model_server.py' in fields[2] and any(
                        path in fields[2] for path in (str(socket), str(socket.resolve()))):
                    matches.append(int(fields[0]))
            assert len(matches) <= 1, 'More than one matching test worker.'
            return matches[0] if matches else None

        before = qwen_pid()
        assert before, 'No owned Qwen worker to restart.'
        started = time.perf_counter()
        os.kill(before, signal.SIGKILL)
        deadline = time.monotonic() + 120
        after = before
        while time.monotonic() < deadline:
            after = qwen_pid()
            if after and after != before:
                break
            time.sleep(0.1)
        assert after and after != before, 'The test app did not replace its Qwen worker.'
        restart = round(time.perf_counter() - started, 2)
        vendor_check()
        print(f'Qwen replacement process after {restart}s; subsequent vendor check passed.', flush=True)
    assert not list(app.rglob('__pycache__')), 'Bytecode was written inside the bundle.'
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    result = {'version': version, 'app': str(app), 'app_pid': args.pid, 'vault': str(vault),
              'scope': 'Installed engine and resident workers; fictional fixture, scripted review. No native UI/microphone/UAT claim.',
              'engine_sha256': sha(engine), 'model_server_sha256': sha(engine.parent / 'model_server.py'),
              't1_seconds': t1, 'proposals': proposals, 'value_matches_key': len(proposals), 'expected_events_found': len(GOLD),
              'quote_provenance_checked': True, 'source_entailment': 'Value matching and quote provenance are checked; source interpretation needs a separate audit.',
              'answers': answers, 'open_commitments': open_text,
              'correction_provenance': {'question': 'Who owns Staff training?', 'answer': owner_answer,
                                        'brief_training': training_evidence, 'reason_returned': correction_reason,
                                        'live_ask_reason': 'passed', 'saved_brief': saved},
              'advantage_demo': {'vault': str(demo), 'pending_vendor_proposal_id': held,
                                 'origin': 'Actual proposals from this model run; other suggestions reviewed by a script for presentation. Separate from participant T1-T5 and C1.'},
              'vendor_history_check': {'current': vendor_now['answer'], 'on_2026_09_27': vendor_past['answer'], 'cited': True},
              'qwen_replacement_process_seconds': restart, 'post_restart_check': 'passed' if restart is not None else 'not run',
              'signature': 'passed', 'ledger_invariants': 'passed'}
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as out:
        json.dump(result, out, indent=2)
        out.write('\n')
    print('INSTALLED-WORKER SMOKE PASS', flush=True)


if __name__ == '__main__':
    main()
