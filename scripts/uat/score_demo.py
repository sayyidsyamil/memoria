"""Score the UAT demo vault's tracked-fact proposals against the answer key, then play T2-T5 through
the app's own APIs: accept the proposals that match a gold event, reject the rest, correct the
training owner to Raj, ask the three T4 questions, and build the T5 brief.

    /opt/homebrew/bin/python3.11 scripts/uat/score_demo.py <vault> [--play]
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'src-tauri' / 'resources' / 'memory'))
from engine import Engine  # noqa: E402
from temporal_service import temporal_api  # noqa: E402

GOLD = [  # research/ledger-engine/data/demo/answer_key.md (CONFIRM events need no new value)
    ('vendor', 'outcome', 'Alpha Systems'), ('budget', 'amount', 250000), ('golive', 'date', '2026-10-26'),
    ('migration', 'owner', 'Wei Ling'), ('migration', 'deadline', '2026-10-09'), ('training', 'owner', 'Aisha'),
    ('training', 'deadline', '2026-10-16'), ('vendor', 'outcome', 'Beta Cloud'), ('budget', 'amount', 280000),
    ('security', 'owner', 'Wei Ling'), ('security', 'deadline', '2026-10-05'), ('migration', 'deadline', '2026-10-23'),
    ('golive', 'date', '2026-11-09'), ('training', 'deadline', '2026-11-03'), ('security', 'status', 'done')]
QUESTIONS = ['What is the go-live date now?', 'What was the pilot budget on 27 September 2026?',
             'How many times did the go-live date change?']


def same(value, gold):
    if isinstance(gold, (int, float)):
        try: return float(value) == float(gold)
        except (TypeError, ValueError): return False
    return str(value).strip().casefold() == str(gold).casefold()


def call(engine, method, params=None):
    with engine.locked():
        result = temporal_api(engine, {'method': method, 'params': params or {}})
    if not result['ok']:
        raise SystemExit(result)
    return result['data']


def main(vault, play):
    engine = Engine(Path(vault))
    proposals = call(engine, 'overview')['proposals']
    matched, wrong = [], []
    for proposal in proposals:
        hit = any(proposal['object_id'] == o and proposal['attribute'] == a and same(proposal['value'], v) for o, a, v in GOLD)
        (matched if hit else wrong).append(proposal)
    found = {(o, a, str(v)) for o, a, v in GOLD if any(p['object_id'] == o and p['attribute'] == a and same(p['value'], v) for p in proposals)}
    print(json.dumps({'proposals': len(proposals), 'matchGold': len(matched), 'wrong': [(p['object_id'], p['attribute'], p['value'], (p.get('quote') or '')[:70]) for p in wrong],
                      'goldFound': len(found), 'goldMissing': [(o, a, v) for o, a, v in GOLD if (o, a, str(v)) not in found]}, indent=1, default=str))
    if not play:
        return
    for proposal in matched:
        call(engine, 'proposals.accept', {'proposal_id': proposal['proposal_id']})
    for proposal in wrong:
        call(engine, 'proposals.reject', {'proposal_id': proposal['proposal_id']})
    owner = next((f for f in call(engine, 'overview')['facts'] if f['object_id'] == 'training' and f['attribute'] == 'owner'), None)
    if owner:
        call(engine, 'facts.correct', {'fact_id': owner['fact_id'], 'value': 'Raj', 'reason': 'The chair said Raj will do the staff training from now on.'})
    with engine.locked():
        for question in QUESTIONS:
            answer = engine.answer(question)
            items = [item['text'] for section in answer.get('sections', []) for item in section['items']]
            print('T4', question, '->', items[:1] or answer.get('message'))
        brief = engine.answer('Next steering committee meeting', brief=True, generator=lambda prompt: (_ for _ in ()).throw(AssertionError('no model')))
    for section in brief['sections']:
        if section['items']:
            print('T5', section['heading'], [item['text'] for item in section['items']])
    engine.db.close()


if __name__ == '__main__':
    main(sys.argv[1], '--play' in sys.argv)
