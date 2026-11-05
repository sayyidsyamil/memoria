"""Does the app's Ask give the answers the October evaluation scored? (AMI test split)

For each AMI test series and each ledger of the October run (gold facts; extracted facts; extracted facts with the
perfect reviewer), the ledger is rebuilt by the evaluated pipeline code from the run's recorded model replies and
written where the app keeps it (<vault>/.memoria-memory/temporal), beside reviewed meeting records saved through the
app's meeting service. Every test question is then sent to the app's engine.py as the desktop app sends an Ask, and
the value its answer states is scored with the October scorer (oracle.values_equal, metrics.score_answers).
A route check then gives every AMI test question and every second phrasing of the synthetic test chains to the app's
route_question, dated as the evaluation dated them, and scores the route as October scored its router.

--router chooses how the app routes, as the app itself would:
  rules   no language-model worker (MEMORIA_QWEN_SOCKET unset), so the rule router;
  replay  the evaluated model router, answered with October's own recorded reply (no model);
  live    the evaluated model router, answered by the running app's Qwen worker through engine.local_generator()
          (MEMORIA_QWEN_SOCKET names its socket); every reply is cached in live-replies.jsonl beside this script, and
          without a worker socket the run uses those cached replies only.
No process is started and no other socket is opened; a path that would need a model is recorded as "needs model".

    /opt/homebrew/bin/python3.11 research/app-parity/ask_parity.py --router rules|replay|live --out FILE [--keep DIR]
"""
import argparse
import contextlib
import hashlib
import io
import json
import os
import re
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import replace
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
LEDGER = REPO / 'research/ledger-engine'
sys.path[:0] = [str(REPO / 'src-tauri/resources/memory'), str(LEDGER / 'scripts/ami')]
sys.dont_write_bytecode = True  # research/ledger-engine stays read-only

import ask_facts  # noqa: E402
import engine as app  # noqa: E402  the desktop app's engine.py
from memoria_engine.evaluation import metrics  # noqa: E402
from memoria_engine.evaluation.baselines import today_iso  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.evaluation.oracle import values_equal  # noqa: E402
from memoria_engine.evaluation.router import INSTRUCTIONS, Route, oracle_route, routed_answer  # noqa: E402
from memoria_engine.evaluation.run_eval import SPLITS, run_pipeline  # noqa: E402
from memoria_engine.extractors import OracleExtractor  # noqa: E402
from memoria_engine.pipeline import Pipeline, make_policy  # noqa: E402
from memoria_engine.service import iso, now_us, registry_to_json  # noqa: E402
from memoria_engine.windowed import WindowedExtractor  # noqa: E402
from replay_offline import CacheOnly  # noqa: E402  October's replay: recorded replies only
from run_ami_review import WindowOracleReviewer  # noqa: E402  October's perfect reviewer
from specs import SPECS  # noqa: E402

# (ledger, October result file, its answer column, recorded extraction replies (None: gold facts), review policy)
CONDITIONS = [
    ('gold facts', 'memoria_test.json', 'oracle_ext+router', None, 'immediate'),
    ('extracted facts', 'memoria_test.json', 'ext+router', 'ami_test_memoria.jsonl', 'immediate'),
    ('extracted, perfect reviewer', 'memoria_test_review.json', 'ext+router', 'ami_test_memoria_review.jsonl', 'confirm_conflicts'),
]
# (route-check set, data folder, wording, split, October's stored router run: result file and padding level)
SETS = [('AMI test', 'ami_v0', 'ask', 'test', 'ami/memoria_test.json', None),
        ('Synthetic test, second phrasing', 'pilot_v0', 'alt', 'test', 'test/memoria_test_alt.json', '0')]
TYPES = [('overall', 'All'), ('current', 'Current'), ('as_of_valid', 'As of a past date'), ('n_changes', 'How many changes')]
NO_ANSWER = '<not answered from tracked facts>'
FIELDS = ('type', 'object_id', 'attribute', 'valid_at', 'tx_at')


class NeedsModel(BaseException):
    """BaseException, so the app's own `except Exception` fallbacks cannot hide a model call."""


def refuse(*_args, **_kwargs):
    raise NeedsModel('this path would reach the language model')


WORKER, CONNECT, LOCAL_GENERATOR = None, socket.socket.connect, app.local_generator


def worker_only(sock, address):
    """Live mode may reach the running app's Qwen worker socket; nothing else is ever connected."""
    if WORKER is None or address != WORKER:
        refuse()
    return CONNECT(sock, address)


socket.socket.connect, subprocess.Popen, app.local_generator = worker_only, refuse, lambda: refuse


class Replay:
    """October's own router reply, read with October's replay tool under the October run's key (model, 90 tokens,
    prompt). The app dates its prompt with the day it runs and the evaluation with the day after each series
    (`today`); that line, and only that line, is set back before the lookup."""

    def __init__(self):
        self.llms = [CacheOnly(str(LEDGER / 'results/cache' / name)) for name in ('ami_test_memoria.jsonl', 'test_memoria.jsonl')]
        self.today, self.last, self.redated = None, None, set()

    def reply(self, prompt):
        for llm in self.llms:
            try:
                return llm.complete(prompt, max_tokens=90)['text']
            except SystemExit:  # CacheOnly: that run never sent this prompt
                pass
        return None

    def __call__(self, prompt):
        head, _, tail = prompt.rpartition("Today's date: ")  # the question's date line; the few-shot example has its own
        october = head + "Today's date: " + self.today + tail[tail.index('\n'):]
        reply = self.reply(october) if prompt.startswith(INSTRUCTIONS) else None
        if reply is None:
            raise NeedsModel('October recorded no router reply for this prompt')
        if october != prompt:
            self.redated.add(prompt)
        self.last = (october, reply)
        return reply


class Live:
    """The running app's Qwen worker through engine.local_generator(); every reply is cached by the sha256 of its
    prompt with the seconds the call took, so a rerun needs no model."""

    def __init__(self, path):
        self.path, self.last, self.used, self.errors = path, None, set(), []
        self.replies = {r['prompt_sha256']: r for r in map(json.loads, path.read_text().splitlines())} if path.exists() else {}

    def __call__(self, prompt):
        if not prompt.startswith(INSTRUCTIONS):
            raise NeedsModel('only router prompts go to the worker')
        key = hashlib.sha256(prompt.encode()).hexdigest()
        if key not in self.replies:
            started = time.perf_counter()
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    text = LOCAL_GENERATOR()(prompt)
            except Exception as error:  # the app then falls back to its rules; counted, never cached
                self.errors.append(str(error))
                raise
            question = prompt.rsplit('\nQ: ', 1)[1].removesuffix('\nA:')
            self.replies[key] = {'prompt_sha256': key, 'question': question, 'today': re.findall(r"(?m)^Today's date: (.*)$", prompt)[-1],
                                 'reply': text, 'seconds': round(time.perf_counter() - started, 3), 'recorded': time.strftime('%Y-%m-%d %H:%M:%S')}
            with self.path.open('a', encoding='utf-8') as out:
                out.write(json.dumps(self.replies[key], ensure_ascii=False) + '\n')
        self.used.add(key)
        self.last = (prompt, self.replies[key]['reply'])
        return self.last[1]


def setup(mode):
    """The router the app will use, chosen only through what the app reads: MEMORIA_QWEN_SOCKET and local_generator."""
    global WORKER
    if mode == 'rules':
        os.environ.pop('MEMORIA_QWEN_SOCKET', None)
        return None
    if not hasattr(ask_facts, 'llm_route'):
        raise SystemExit('this ask_facts.py has no model router')
    if mode == 'replay':
        os.environ['MEMORIA_QWEN_SOCKET'] = 'replay (no worker)'
        router = Replay()
    else:
        WORKER = os.environ.get('MEMORIA_QWEN_SOCKET') or ''
        if not Path(WORKER).is_socket():  # no worker: cached replies only; an unknown prompt is recorded as "needs model"
            WORKER, os.environ['MEMORIA_QWEN_SOCKET'] = None, 'cached live replies only'
        router = Live(HERE / 'live-replies.jsonl')
    app.local_generator = lambda: router
    return router


def build_vault(root, chain, replies, policy):
    """Reviewed transcripts and meeting records through the app's meeting service, then the October ledger in the
    app's temporal store: run_eval.run_pipeline's three steps, with the ledger on disk. Returns the pipeline."""
    ids = {gm.meeting.meeting_id: str(uuid.uuid5(uuid.NAMESPACE_URL, 'ami/' + gm.meeting.meeting_id)) for gm in chain.meetings}
    engine = app.Engine(root)
    with contextlib.redirect_stdout(io.StringIO()), engine.locked():
        for gm in chain.meetings:
            m, path = gm.meeting, f'source-{gm.meeting.meeting_id}.md'
            body = '\n\n'.join(f'[{app.clock(t.start)}] {t.speaker}: {t.text}' for t in m.turns)
            (root / path).write_text(f'---\ntype: Source\ntitle: "AMI {m.meeting_id} — reviewed transcript"\n---\n'
                                     f'# AMI {m.meeting_id} — reviewed transcript\n\n{body}\n')
            app.workspace_product(engine, {'action': 'save_meeting', 'record': {
                'id': ids[m.meeting_id], 'title': f'AMI {m.meeting_id}', 'created': iso(m.occurred_at),
                'status': 'transcript-reviewed', 'transcriptPath': path}})
    engine.db.close()
    # App meeting ids are UUIDs; the extractor's prompt never contains the id, so the recorded replies still apply.
    chain = replace(chain, meetings=tuple(replace(gm, meeting=replace(gm.meeting, meeting_id=ids[gm.meeting.meeting_id]))
                                          for gm in chain.meetings))
    home = root / '.memoria-memory' / 'temporal'
    home.mkdir()
    (home / 'registry.json').write_text(json.dumps(registry_to_json(chain.registry), indent=1, ensure_ascii=False))
    extractor = OracleExtractor(chain) if replies is None else WindowedExtractor(CacheOnly(str(LEDGER / 'results/cache' / replies)))
    pipe = Pipeline(chain.registry, extractor, make_policy(policy), None if policy == 'immediate' else WindowOracleReviewer(chain),
                    db_path=str(home / 'ledger.sqlite'), log_path=str(home / 'ledger.jsonl'))
    for gm in chain.meetings:
        pipe.ingest(gm.meeting)
    return pipe


def app_request(root, request):
    """One engine.py request, as the desktop app sends it: JSON on stdin, the last JSON line on stdout."""
    stdin, out = sys.stdin, io.StringIO()
    sys.stdin = io.StringIO(json.dumps({**request, 'vaultPath': str(root), 'jobId': str(uuid.uuid4())}))
    try:
        with contextlib.redirect_stdout(out):
            app.main()
    except NeedsModel:
        return {'needsModel': True}
    except Exception as error:  # engine.py's __main__ wrapper reports these as {"error": ...}
        return {'error': str(error)}
    finally:
        sys.stdin = stdin
    return json.loads(out.getvalue().splitlines()[-1])['result']


def stated_value(result, registry):
    """The value an app answer states, read back from its fixed sentence (current or v0.2.0 wording); NO_ANSWER
    unless tracked facts answered."""
    if result.get('source') != 'tracked-facts':
        return NO_ANSWER
    label, attribute = result['retrieval'].removeprefix('Tracked facts · ').rsplit(' · ', 1)[0].rsplit(' — ', 1)
    text, a, l = result['sections'][0]['items'][0]['text'], re.escape(attribute), re.escape(label)
    if hasattr(ask_facts, 'subject'):  # "Battery type is kinetic (decided …)"
        name = now = re.escape(ask_facts.subject(label, attribute))
        none = rf'{name} (?:has no value in force now|had no recorded value on .+)'
    else:  # v0.2.0: "The current outcome for Battery type is kinetic (decided …)"
        name, now, none = rf'the {a} for {l}', rf'The current {a} for {l}', rf'No {a} for {l} (?:is in force now|was recorded for .+)'
    if re.fullmatch(none + r'\.', text):
        return None
    count = re.fullmatch(rf'{name} (?:has not changed|changed (once|twice|\d+ times)): .+\.', text, re.I)
    if count:
        return 0 if count[1] is None else {'once': 1, 'twice': 2}.get(count[1]) or int(count[1].split()[0])
    value = re.fullmatch(rf'(?:{now} is|On [^,]+(?:, as recorded by [^,]+)?, {name} was) (.+) \(decided [^()]*\)\.', text)
    if value is None:
        return f'<unread: {text}>'
    object_id = next(o.object_id for o in registry.objects.values() if o.label == label)
    try:
        return registry.normalise(object_id, attribute, value[1])  # "RM 280,000" back to 280000
    except ValueError:
        return value[1]


def route_of(registry, question, day, router):
    """The app's route and what decided it: the model router's reply, or the rules (no worker, or an unusable reply)."""
    if router is None:
        return ask_facts.route_question(registry, question, day), 'rules'
    with contextlib.redirect_stdout(io.StringIO()):
        route = ask_facts.route_question(registry, question, day, router)
        by_model = ask_facts.llm_route(registry, question, day, router) is not None
    return route, 'model' if by_model else 'rules'


def same(route, other):
    return route is not None and other is not None and all(route[f] == other[f] for f in FIELDS)


def shown(route):
    return ' '.join(str(route[f]) for f in ('type', 'object_id', 'valid_at', 'tx_at') if route[f]) if route else 'none'


def reason(row):
    if row['app_source'] in ('needs model', 'error'):
        return row['app_source']
    if row['app_route'] is None:
        return f"{row['routed_by']}: no tracked item, so Ask leaves it to the wiki answer (needs model)"
    if not row['route_as_october']:
        return f"{row['routed_by']} route {shown(row['app_route'])}; October routed {shown(row['october_route'])}"
    if row['app'] == NO_ANSWER:
        return 'no approved fact for the item, so Ask leaves it to the wiki answer (needs model)'
    return 'same route as October, different stated value'


def parity(base, today, router):
    chains = [c for c in load_chains(str(LEDGER / 'data/ami_v0')) if SPECS[c.chain_id]['split'] == 'test']
    rows, checks = [], {}
    for name, stored_file, column, replies, policy in CONDITIONS:
        stored = {(r['chain'], r['qid']): r for r in json.loads((LEDGER / 'results/ami' / stored_file).read_text())['memoria']['rows']}
        check = checks[name] = {'rebuilt_answers_differ': 0, 'slots_differing_now_vs_evaluation_now': 0, 'app_store_check_failed': 0}
        for chain in chains:
            root = base / f"{name.replace(', ', '-').replace(' ', '-')}-{chain.chain_id}"
            root.mkdir()
            pipe = build_vault(root, chain, replies, policy)
            for q in chain.questions:  # the rebuilt ledger must give October's stored answer to October's route
                old = stored[(chain.chain_id, q.qid)]
                check['rebuilt_answers_differ'] += not values_equal(routed_answer(pipe.ledger, Route(**old['route']), chain.now), old['answers'][column]['answer'])
            for slot in chain.registry.slots():  # the app reads "now" from the clock; October used the day after the series
                then, now = (pipe.ledger.as_of(*slot, valid_at=t) for t in (chain.now, now_us()))
                check['slots_differing_now_vs_evaluation_now'] += (then and then.value) != (now and now.value)
            pipe.ledger.close()
            overview = app_request(root, {'action': 'temporal_api', 'method': 'overview'})
            check['app_store_check_failed'] += not (overview['ok'] and overview['data']['check']['ok'])
            if isinstance(router, Replay):
                router.today = today_iso(chain)
            for q in chain.questions:
                old = stored[(chain.chain_id, q.qid)]
                started = time.perf_counter()
                result = app_request(root, {'action': 'ask', 'question': q.ask})
                seconds = round(time.perf_counter() - started, 3)
                value = stated_value(result, chain.registry)
                route, routed_by = (None, 'needs model') if result.get('needsModel') else route_of(chain.registry, q.ask, today, router)
                items = (result.get('sections') or [{'items': [{}]}])[0]['items']
                row = {'ledger': name, 'chain': chain.chain_id, 'qid': q.qid, 'type': q.type, 'question': q.ask, 'gold': q.gold,
                       'october': old['answers'][column]['answer'], 'october_correct': old['answers'][column]['correct'],
                       'october_route': {f: old['route'][f] for f in FIELDS}, 'app': value, 'app_correct': values_equal(value, q.gold),
                       'app_route': route, 'routed_by': routed_by, 'router_reply': router.last[1] if router and routed_by != 'needs model' else None,
                       'app_text': items[0].get('text') or result.get('message'), 'ask_seconds': seconds,
                       'app_source': 'needs model' if result.get('needsModel') else 'error' if 'error' in result else result.get('source') or 'wiki answer',
                       'app_warnings': result.get('warnings') or result.get('error')}
                row['route_as_gold'] = same(route, oracle_route(q).as_dict())
                row['route_as_october'] = same(route, row['october_route'])
                row['same_as_october'] = values_equal(value, row['october'])
                row['reason'] = None if row['same_as_october'] else reason(row)
                rows.append(row)
    return rows, checks


def route_check(router, replay):
    """Every question of SETS through the app's route_question, dated as the evaluation dated it, scored as October
    scored its router: exact route, and the routed answer on gold facts at the evaluation's "now"; plus agreement with
    October's own route and, for a model router, with October's reply to the same prompt."""
    split = {**{c: s['split'] for c, s in SPECS.items()}, **{c: s for s, names in SPLITS.items() for c in names}}
    out = {}
    for name, folder, wording, part, stored_file, level in SETS:
        stored = json.loads((LEDGER / 'results' / stored_file).read_text())
        october = {(r['chain'], r['qid']): r['route'] for r in (stored['levels'][level] if level else stored['memoria'])['rows']}
        tally = out[name] = dict.fromkeys(('questions', 'exact', 'left_to_wiki', 'correct_on_gold', 'route_as_october', 'reply_as_october', 'needs_model'), 0)
        for chain in [c for c in load_chains(str(LEDGER / 'data' / folder), wording) if split.get(c.chain_id) == part]:
            gold, day = run_pipeline(chain, OracleExtractor(chain), 'immediate')['pipeline'].ledger, date.fromisoformat(today_iso(chain))
            if isinstance(router, Replay):
                router.today = day.isoformat()
            for q in chain.questions:
                try:
                    route, _ = route_of(chain.registry, q.ask, day, router)
                except NeedsModel:
                    tally['needs_model'] += 1
                    continue
                kind = route and ('n_changes' if route['type'] == 'history' else route['type'])  # a history answer states the count
                answer = NO_ANSWER if route is None else routed_answer(gold, Route(kind, *(route[f] for f in FIELDS[1:]), ok=True), chain.now)
                tally['questions'] += 1
                tally['exact'] += same(route, oracle_route(q).as_dict())
                tally['left_to_wiki'] += route is None
                tally['correct_on_gold'] += values_equal(answer, q.gold)
                tally['route_as_october'] += same(route, october[(chain.chain_id, q.qid)])
                tally['reply_as_october'] += bool(router) and replay.reply(router.last[0]) == router.last[1]
    return out


def report(mode, rows, checks, routes, router):
    lines = [f'Router: {mode}', '', '| Ledger | System | ' + ' | '.join(t for _, t in TYPES) + ' | Same answer as October |', '|---' * (len(TYPES) + 3) + '|']
    for name, *_ in CONDITIONS:
        mine = [r for r in rows if r['ledger'] == name]
        for system, key in (('October pipeline', 'october_correct'), ('App Ask', 'app_correct')):
            score = metrics.score_answers([{'type': r['type'], 'correct': r[key]} for r in mine])
            same_answer = f"{sum(r['same_as_october'] for r in mine)}/{len(mine)}" if key == 'app_correct' else ''
            lines.append(f"| {name if key == 'october_correct' else ''} | {system} | " +
                         ' | '.join(f"{score[t]['correct']}/{score[t]['n']}" for t, _ in TYPES) + f' | {same_answer} |')
    lines += ['', 'Checks: ' + json.dumps(checks)]
    if isinstance(router, Replay):
        lines.append(f"Replay: {len(router.redated)} distinct app prompts differed from October's only in the \"Today's date\" line")
    if isinstance(router, Live):
        seconds = [router.replies[k]['seconds'] for k in router.used]
        lines.append(f'Live ({WORKER or "no worker, cached replies only"}): {len(seconds)} distinct router prompts; worker seconds per call '
                     f'median {statistics.median(seconds):.2f}, mean {statistics.mean(seconds):.2f}, max {max(seconds):.2f}; worker errors {len(router.errors)}')
    asks = {name: statistics.median(r['ask_seconds'] for r in rows if r['ledger'] == name) for name, *_ in CONDITIONS}
    lines.append('Ask seconds per question, median of the whole engine.py request: ' + ', '.join(f'{n} {s:.3f}' for n, s in asks.items()))
    lines += ['', '| Ledger | Series | Question | Gold | October | App | Reason |', '|---|---|---|---|---|---|---|']
    lines += [f"| {r['ledger']} | {r['chain']} {r['qid']} | {r['question']} | {r['gold']} | {r['october']} | {r['app']} | {r['reason']} |"
              for r in rows if not r['same_as_october']]
    lines += ['', '| Route check | Questions | Exact route | Left to the wiki | Correct on gold facts | Same route as October | Same reply as October | Needs model |',
              '|---|---|---|---|---|---|---|---|']
    lines += [f"| {name} | {t['questions']} | {t['exact']} | {t['left_to_wiki']} | {t['correct_on_gold']} | {t['route_as_october']} | "
              f"{t['reply_as_october'] if router else ''} | {t['needs_model']} |" for name, t in routes.items()]
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--router', choices=('rules', 'replay', 'live'), default='rules')
    ap.add_argument('--out', required=True, help='result file (JSON)')
    ap.add_argument('--keep', help='build the vaults in this new directory and keep them')
    args = ap.parse_args()
    router, today = setup(args.router), date.today()
    with tempfile.TemporaryDirectory() as scratch:
        base = Path(args.keep or scratch)
        base.mkdir(exist_ok=not args.keep)
        rows, checks = parity(base.resolve(), today, router)
    routes = route_check(router, Replay())
    used = hashlib.sha256(Path(ask_facts.__file__).read_bytes()).hexdigest()[:12]
    Path(args.out).write_text(json.dumps({'router': args.router, 'today': today.isoformat(), 'ask_facts_sha256_12': used, 'checks': checks,
                                          'worker_errors': getattr(router, 'errors', None), 'routes': routes, 'rows': rows}, indent=1, default=str))
    print(f'ask_facts.py sha256 {used}, today {today}\n')
    print(report(args.router, rows, checks, routes, router))


if __name__ == '__main__':
    main()
