"""Questions about a tracked value — what it is now, what it was on a date, how it changed —
answered from the reviewed decision ledger instead of wiki claims.

Read-only ledger snapshot, as for live checks. No model is called: answers are fixed sentences
over approved ledger values, and every statement cites the quoted evidence of the facts it states.
Questions that name no tracked item, or name only an attribute without asking about time, are
left to the wiki answer.
"""
import json
import os
import re
import sqlite3
from datetime import date
from types import SimpleNamespace

CURRENT = re.compile(r"\b(now|current(?:ly)?|at the moment|today|latest|these days|still|presently|anymore)\b", re.I)
CHANGES = re.compile(r"\b(chang(?:e|ed|es|ing)|history|previous(?:ly)?|before|earlier|originally|used to|switch(?:ed)?|replac(?:e|ed|ing)|over time)\b", re.I)


def _names(attribute, question):
    return re.search(rf"\b{re.escape(attribute.casefold().replace('_', ' '))}s?\b", question.casefold()) is not None


def _named_in_full(registry, question):
    """Of the items tied for the most label words in the question, the only one whose label words are all
    named, else None. The rule router breaks that tie by the longest word, so a word many questions share
    ('project' in "Project timeline") would outrank the item the question names in full ("Budget")."""
    from memoria_engine.fallback_router import STOP, _item_scores, _words
    scores = _item_scores(registry, _words(question))
    tied = [item for hits, _, item in scores if hits == scores[0][0]]
    full = [item for item in tied if scores[0][0] == len(
        {w for w in _words(f"{item.label} {item.object_id.replace('_', ' ')}") if w not in STOP and len(w) >= 3})]
    return full[0] if len(tied) > 1 and len(full) == 1 else None


def _complete_attribute(raw, registry, question):
    """A reply that names an item but leaves out its attribute is completed when only one attribute fits:
    the item's only attribute, its owner for a "who" question, or its only date for a "when" question."""
    start, end = raw.find('{'), raw.rfind('}')
    try:
        data = json.loads(raw[start:end + 1])
        item = registry.objects.get(data.get('object_id'))
        if item is None or data.get('attribute'):
            return raw
        words = set(re.findall(r'[a-z]+', question.casefold()))
        fits = item.attributes if len(item.attributes) == 1 else \
            [a for a in item.attributes if a.name == 'owner' or a.type == 'person'] if 'who' in words else \
            [a for a in item.attributes if a.type == 'date'] if words & {'when', 'due', 'deadline'} else []
        if len(fits) == 1:
            data['attribute'] = fits[0].name
            return json.dumps(data)
    except (ValueError, AttributeError, TypeError):
        pass
    return raw


def llm_route(registry, question, today, generate):
    """The evaluated language-model router (research/ledger-engine, report Section 6.4.2): the same prompt and
    validation, so a typed question routes as in the evaluation. Returns the route dict, or None when the
    reply names no usable slot."""
    from memoria_engine.evaluation.router import build_prompt, parse_route
    try:
        route = parse_route(_complete_attribute(generate(build_prompt(registry, today.isoformat(), question)), registry, question), registry)
    except Exception:
        return None
    if not route.ok:
        return None
    kind = route.type
    if kind == 'current' and CHANGES.search(question) and not CURRENT.search(question):
        kind = 'history'
    return {'type': kind, 'object_id': route.object_id, 'attribute': route.attribute, 'valid_at': route.valid_at, 'tx_at': route.tx_at}


def route_question(registry, question, today, generate=None):
    """Which tracked slot and lookup a question asks for, or None. With the language model available
    (`generate`), the evaluated model router decides; without it, or when its reply names no usable slot,
    the evaluated rule router does. With rules, a named item counts when the question also names the attribute
    or asks about time; an attribute named without its item counts only when it is the only such slot and
    the question asks about time."""
    if generate is not None:
        routed = llm_route(registry, question, today, generate)
        if routed is not None:
            return routed  # otherwise the rules decide; they leave topic questions to knowledge
    from memoria_engine.fallback_router import fallback_route, parse_dates, N_CHANGES
    from memoria_engine.pipeline import Registry
    dates = parse_dates(question, today)
    temporal = bool(CURRENT.search(question) or CHANGES.search(question) or N_CHANGES.search(question) or dates)
    route = fallback_route(registry, today.isoformat(), question)
    named = _named_in_full(registry, question)
    if named is not None and named.object_id != route.object_id:
        route = fallback_route(Registry({named.object_id: named}, registry.people), today.isoformat(), question)
    if route.ok:
        kind, object_id, attribute, valid_at, tx_at = route.type, route.object_id, route.attribute, route.valid_at, route.tx_at
        if not temporal and not _names(attribute, question):
            return None  # A topic question such as "What did we discuss about the pilot?"
    else:
        slots = [(item.object_id, spec.name) for item in registry.objects.values() for spec in item.attributes
                 if _names(spec.name, question)]
        if len(slots) != 1 or not temporal:
            return None
        (object_id, attribute), tx_at = slots[0], None
        kind = 'n_changes' if N_CHANGES.search(question) else 'as_of_valid' if dates else 'current'
        valid_at = dates[0].isoformat() if dates else None
    if kind == 'current' and CHANGES.search(question) and not CURRENT.search(question):
        kind = 'history'
    return {'type': kind, 'object_id': object_id, 'attribute': attribute, 'valid_at': valid_at, 'tx_at': tx_at}


def _snapshot(home, registry):
    """Vendor read methods over a read-only ledger connection: no mkdir, schema, replay or registry install."""
    from memoria_engine.ledger import Ledger
    from memoria_engine.service import Service
    service = Service.__new__(Service)
    service.home, service.registry = home, registry
    ledger = Ledger.__new__(Ledger)
    ledger._db = sqlite3.connect(home.joinpath('ledger.sqlite').as_uri() + '?mode=ro', uri=True)
    ledger._db.row_factory = sqlite3.Row
    try:
        ledger._db.execute('PRAGMA query_only = ON')
        ledger._db.execute('BEGIN')  # one consistent view while meetings are being approved
        service.pipe = SimpleNamespace(ledger=ledger, meeting_of_source={
            source['source_id']: source['meeting_id'] for source in ledger.sources()})
    except Exception:
        ledger._db.close()
        raise
    return service


GENERIC_ATTRIBUTES = {'outcome', 'value', 'amount', 'date'}
UNIT = re.compile(r'\s*\(([A-Z]{1,4}|[$€£¥])\)\s*$')


def subject(label, attribute):
    """How an answer names a slot: "Vendor" for an item's only generic value, "Staff training owner" otherwise;
    a unit in the label ("Pilot budget (RM)") moves to the value."""
    label = UNIT.sub('', label)
    return label if attribute.casefold() in GENERIC_ATTRIBUTES else f'{label} {attribute.replace("_", " ")}'


def shown_in(value, label):
    """A value in the unit its item's label names, e.g. "RM 280,000" for "Pilot budget (RM)"."""
    unit = UNIT.search(label)
    text = shown(value)
    return f'{unit.group(1)} {text}' if unit and isinstance(value, (int, float)) and not isinstance(value, bool) else text


def _times(count):
    return 'once' if count == 1 else 'twice' if count == 2 else f'{count} times'


def shown(value):
    """A tracked value as people read it: calendar dates spelled out, amounts with thousands separators."""
    if isinstance(value, bool) or value is None:
        return str(value)
    if isinstance(value, (int, float)):
        return f'{value:,.0f}' if float(value).is_integer() else f'{value:,}'
    text = str(value)
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
        try:
            day = date.fromisoformat(text)
            return f'{day.day} {day:%b %Y}'
        except ValueError:
            pass
    return text


def _citer(engine, records, citations, prefix='R'):
    """cite(evidence) -> citation ids: ledger evidence as citations into the meetings' reviewed transcripts."""
    from engine import safe_path, title_of

    def cite(evidence, fact=None):
        ids = []
        for item in evidence[:2]:
            record = records.get(item.get('meeting'))
            if not record or not record.get('transcriptPath') or not isinstance(item.get('quote'), str):
                continue
            path = record['transcriptPath']
            try:
                source = safe_path(engine.root, path)
                title = title_of(source, source.read_text())
            except (OSError, ValueError):
                continue
            identifier = f'{prefix}{len(citations) + 1}'
            citation = {'id': identifier, 'quote': item['quote'], 'sourcePath': path, 'sourceTitle': title, 'page': 1,
                        'moment': {'meetingId': record['id'], 'meetingTitle': record.get('title', 'Meeting'), 'at': item.get('audio_start')}}
            if fact is not None:
                citation.update(kind='tracked-fact', factId=fact['fact_id'], objectId=fact['object_id'], attribute=fact['attribute'])
            citations.append(citation)
            ids.append(identifier)
        return ids
    return cite


def _registry(engine):
    """(registry, ledger home) of a vault that tracks at least one item, else (None, home)."""
    from memoria_engine.service import registry_from_json
    from temporal_support import temporal_home
    home = temporal_home(engine.root)
    if not (home / 'registry.json').is_file() or not (home / 'ledger.sqlite').is_file():
        return None, home
    data = json.loads((home / 'registry.json').read_text())
    return (registry_from_json(data) if data.get('objects') else None), home


CLOSED = {'done', 'complete', 'completed', 'cancelled', 'canceled', 'closed'}


def brief_items(engine, most=8):
    """Brief sections from approved tracked facts: open commitments (current owner, deadline and status of
    each commitment not marked done or cancelled) and recent updates (slots whose value changed, newest
    first). Fixed sentences, no model; each statement cites the quoted evidence of the facts it states.
    Returns ({heading: items}, citations) or None when nothing is tracked."""
    from engine import human_date, meeting_records
    from temporal_support import valid_current, supporting_evidence
    registry, home = _registry(engine)
    if registry is None:
        return None
    service = _snapshot(home, registry)
    try:
        records = {record['id']: record for record in meeting_records(engine)}
        citations = []
        cite = _citer(engine, records, citations, prefix='T')
        current = valid_current(service)
        by_item = {}
        for fact in current:
            by_item.setdefault(fact['object_id'], {})[fact['attribute']] = fact
        commitments = []
        for object_id, spec in registry.objects.items():
            facts = by_item.get(object_id) or {}
            if spec.kind != 'commitment' or not facts or str((facts.get('status') or {}).get('value', '')).casefold() in CLOSED:
                continue
            parts, ids = [], []
            for attribute in [a.name for a in spec.attributes if a.name in facts]:
                fact = facts[attribute]
                word = 'due' if attribute in ('deadline', 'due', 'date') else attribute
                parts.append(f"{word} {shown(fact['value'])}")
                ids += cite(supporting_evidence(fact), fact)
            if ids:
                commitments.append({'text': f"{spec.label}: {'; '.join(parts)}.", 'citations': ids})
        changes = []
        for object_id, spec in registry.objects.items():
            for attribute in spec.attributes:
                history = [fact for fact in service.facts_history(object_id, attribute.name) if not fact.get('retracted')]
                values = [fact['value'] for fact in history]
                if len(history) < 2 or values[-1] == values[-2]:
                    continue
                latest, earlier = history[-1], history[-2]
                ids = cite(earlier.get('evidence') or [], earlier) + cite(supporting_evidence(latest) or latest.get('evidence') or [], latest)
                if ids:
                    changes.append((latest['decided_at'], {'text': f"{spec.label} — {attribute.name} changed from {shown(earlier['value'])} "
                                                           f"to {shown(latest['value'])} (decided {human_date(latest['decided_at'])}).", 'citations': ids}))
        updates = [item for _, item in sorted(changes, key=lambda pair: pair[0], reverse=True)]
        if not commitments and not updates:
            return None
        return {'Open commitments': commitments[:most], 'Recent updates': updates[:most]}, citations
    finally:
        service.pipe.ledger._db.close()


def tracked_citation_holds(engine, citation):
    """A saved brief may cite a tracked fact only while that fact is approved and not retracted."""
    registry, home = _registry(engine)
    if registry is None or citation.get('objectId') not in registry.objects:
        return False
    service = _snapshot(home, registry)
    try:
        return any(fact['fact_id'] == citation.get('factId') and not fact.get('retracted')
                   for fact in service.facts_history(citation['objectId'], citation.get('attribute')))
    finally:
        service.pipe.ledger._db.close()


def tracked_answer(engine, question, today=None):
    """An Ask result (same shape as wiki answers) when the question is about a tracked value with
    approved facts, else None."""
    from engine import human_date, local_generator, meeting_records
    from temporal_support import valid_current, supporting_evidence
    registry, home = _registry(engine)
    if registry is None:
        return None
    # In the app the resident language-model worker routes the question as in the evaluation; tests and
    # scripts without a worker use the rules.
    generate = local_generator() if os.environ.get('MEMORIA_QWEN_SOCKET') else None
    route = route_question(registry, question, today or date.today(), generate)
    if route is None:
        return None
    service = _snapshot(home, registry)
    try:
        slot = (route['object_id'], route['attribute'])
        history = [fact for fact in service.facts_history(*slot) if not fact.get('retracted')]
        if not history:
            return None  # Nothing approved for this slot yet: the wiki may still know something.
        label = registry.objects[route['object_id']].label
        attribute = route['attribute']
        name = subject(label, attribute)
        records = {record['id']: record for record in meeting_records(engine)}
        citations = []
        cite = _citer(engine, records, citations)

        items = []
        if route['type'] == 'current':
            fact = next((row for row in valid_current(service) if (row['object_id'], row['attribute']) == slot), None)
            if fact is None:
                items.append({'text': f'{name} has no value in force now.', 'citations': [], 'noEvidence': True})
            else:
                items.append({'text': f"{name} is {shown_in(fact['value'], label)} (decided {human_date(fact['decided_at'])}).",
                              'citations': cite(supporting_evidence(fact))})
        elif route['type'] in ('as_of_valid', 'as_of_tx'):
            found = service.query(route['type'], *slot, valid_at=route['valid_at'], tx_at=route['tx_at'])
            on = route['valid_at']
            if found['answer'] is None:
                items.append({'text': f'{name} had no recorded value on {shown(on)}.', 'citations': [], 'noEvidence': True})
            else:
                known = f", as recorded by {shown(route['tx_at'])}" if route['type'] == 'as_of_tx' and route['tx_at'] else ''
                items.append({'text': f"On {shown(on)}{known}, {name} was {shown_in(found['answer'], label)} (decided {human_date(found['decided_at'])}).",
                              'citations': cite(found['evidence'])})
        else:  # n_changes and history: the recorded values in order, each with its own evidence
            changes = service.query('n_changes', *slot)['answer']
            # A confirmation repeats the value; the summary lists each value once per run.
            values = ' → '.join(shown_in(fact['value'], label) for index, fact in enumerate(history)
                                if index == 0 or fact['value'] != history[index - 1]['value'])
            steps = []
            for fact in history:
                ids = cite(fact.get('evidence') or [])
                if ids:
                    steps.append({'text': f"{shown_in(fact['value'], label)} — decided {human_date(fact['decided_at'])}.", 'citations': ids})
            summary = f'{name} has not changed: {values}.' if not changes else f'{name} changed {_times(changes)}: {values}.'
            items.append({'text': summary, 'citations': [ref for step in steps for ref in step['citations']]})
            items.extend(steps)
        if not any(item['citations'] for item in items) and not all(item.get('noEvidence') for item in items):
            return None
        lookup = {'current': 'current value', 'as_of_valid': 'value on a date', 'as_of_tx': 'value as recorded by a date',
                  'n_changes': 'number of changes', 'history': 'recorded history'}[route['type']]
        return {'sections': [{'heading': 'Answer', 'items': items}], 'citations': citations,
                'retrieval': f'Tracked facts · {label} — {attribute} · {lookup}', 'warnings': [], 'message': None, 'source': 'tracked-facts'}
    finally:
        service.pipe.ledger._db.close()
