"""Workspace-scoped adapter around the preserved FYP decision ledger.

Reviewed transcript ingestion preserves meeting dates, speaker labels, and recorded
offsets. Temporal proposals always require human approval. No UI or model loads at import.
"""
import json
import math
import re
from datetime import datetime
from decimal import Decimal
from memoria_engine.service import Service, METHODS
from temporal_support import temporal_home, valid_current

ALLOWED = set(METHODS) - {'ask', 'meetings.ingest'}
PARAMETERS = {
    'overview': set(), 'registry.get': set(), 'registry.set': {'objects', 'people'},
    'meetings.list': set(), 'facts.current': set(), 'facts.history': {'object_id', 'attribute'},
    'proposals.list': set(), 'proposals.accept': {'proposal_id', 'edits', 'reviewer', 'note'},
    'proposals.reject': {'proposal_id', 'reviewer', 'note'},
    'facts.correct': {'fact_id', 'value', 'reason', 'reviewer'},
    'facts.retract': {'fact_id', 'reason', 'reviewer'},
    'query': {'type', 'object_id', 'attribute', 'valid_at', 'tx_at'},
    'brief': set(), 'check': set(), 'ping': set(), 'ingest_reviewed_meeting': {'meetingId'},
}


def validate_params(method, params):
    if method not in PARAMETERS or set(params) - PARAMETERS[method]:
        raise ValueError('Unknown temporal operation or unsupported parameters.')
    for key in ('proposal_id', 'fact_id'):
        if key in params and (type(params[key]) is not int or not 0 < params[key] <= 9007199254740991):
            raise ValueError(f'{key} must be a positive integer.')
    if method.startswith('proposals.') and method != 'proposals.list' and 'proposal_id' not in params:
        raise ValueError('A proposal identifier is required.')
    if method in ('facts.correct', 'facts.retract'):
        if 'fact_id' not in params or not isinstance(params.get('reason'), str) or not params['reason'].strip():
            raise ValueError('A fact identifier and reason are required.')
    if method in ('facts.history', 'query'):
        if not all(isinstance(params.get(key), str) and params[key].strip() for key in ('object_id', 'attribute')):
            raise ValueError('A tracked item and attribute are required.')
    if method == 'query':
        if params.get('type') not in ('current', 'as_of_valid', 'as_of_tx', 'n_changes'):
            raise ValueError('Unknown temporal query type.')
        required = 'valid_at' if params['type'] == 'as_of_valid' else 'tx_at' if params['type'] == 'as_of_tx' else None
        if required and not params.get(required): raise ValueError(f'{required} is required.')
        for key in ('valid_at', 'tx_at'):
            if key in params:
                if not isinstance(params[key], str): raise ValueError('Query dates must be text.')
                datetime.fromisoformat(params[key].replace('Z', '+00:00'))
    if method == 'registry.set':
        if not isinstance(params.get('objects'), list): raise ValueError('Tracked objects must be a list.')
        for obj in params['objects']:
            if not isinstance(obj, dict) or not all(isinstance(obj.get(k), str) and obj[k].strip() for k in ('object_id', 'label', 'kind')):
                raise ValueError('Tracked items require an ID, label and kind.')
            if not isinstance(obj.get('attributes'), list) or not obj['attributes']: raise ValueError('At least one attribute is required.')
            for attr in obj['attributes']:
                if not isinstance(attr, dict) or attr.get('type') not in ('text', 'number', 'date', 'enum') or not isinstance(attr.get('name'), str) or not attr['name'].strip():
                    raise ValueError('Invalid tracked attribute.')
                if attr['type'] == 'enum' and (not isinstance(attr.get('values'), list) or not attr['values'] or not all(isinstance(v, str) and v.strip() for v in attr['values'])):
                    raise ValueError('Enum attributes require allowed values.')


NUMBER = re.compile(r'(?<![\d.,])([+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+\-−]?\d+)?)(?![.,]\d)\s*(billion|million|thousand|k|m)?\b', re.I)
SCALE = {'billion': 1_000_000_000, 'million': 1_000_000, 'm': 1_000_000, 'thousand': 1_000, 'k': 1_000}


def quoted_numbers(quote):
    """The amounts a quote states: '250,000 ringgit' -> 250000, 'RM2.5 million' -> 2500000."""
    found = set()
    for digits, scale in NUMBER.findall(quote or ''):
        value = float(digits.replace(',', '').replace('−', '-')) * SCALE.get(scale.casefold(), 1)
        if math.isfinite(value):
            found.add(int(value) if value.is_integer() else value)
    return found


WORD_ONES = dict(zip('one two three four five six seven eight nine'.split(), range(1, 10)))
WORD_TENS = dict(zip('twenty thirty forty fifty sixty seventy eighty ninety'.split(), range(20, 100, 10)))
WORD_BELOW_HUNDRED = {**WORD_ONES, **WORD_TENS,
                      **dict(zip('ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(), range(10, 20)))}
WORD_SCALE = {'thousand': 1_000, 'million': 1_000_000, 'billion': 1_000_000_000}
WORD_ZERO = {'zero', 'nought'}
WORD_DIGITS = {**WORD_ONES, **dict.fromkeys((*WORD_ZERO, 'oh'), 0)}  # after 'point': 'point oh five' is 0.05
NUMBER_WORDS = {*WORD_BELOW_HUNDRED, *WORD_SCALE, *WORD_ZERO, 'hundred'}
SPOKEN_WORDS = NUMBER_WORDS | {'and', 'a', 'oh', 'point', 'minus', 'negative'}
# Alone between two numbers, these make them one expression: a range, a choice, a ratio, a sum or a hesitation ("fifty uh million").
LINKS = {'to', 'or', 'through', 'till', 'until', 'by', 'times', 'over', 'x', 'in', 'out', 'of', 'per', 'plus', 'vs', 'versus',
         'uh', 'um', 'er', 'erm', 'ah', 'eh', 'mm', 'hmm'}
FRACTION = re.compile(r'(?:first|second|third|\w*(?:fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|teenth|tieth|hundredth'
                      r'|thousandth|millionth|billionth))s?|half|halves|quarters?')
# A number followed by one of these is not a plain amount: an ordinal or fraction, a percentage, digits, or a magnitude not read here.
QUALIFIER = re.compile(FRACTION.pattern + r'|percent(?:age)?|pc|%|grand|k|m|bn|mn|mil|dozens?|score|hundreds|thousands|millions|billions'
                       r'|trillions?|odd|ish|something|plus|\d+')


def _below_hundred(words):
    if len(words) == 2 and words[0] in WORD_TENS and words[1] in WORD_ONES:
        return WORD_TENS[words[0]] + WORD_ONES[words[1]]
    return WORD_BELOW_HUNDRED.get(words[0]) if len(words) == 1 else None


def _below_thousand(words):
    """'a hundred and fifty' -> 150, 'twenty five hundred' -> 2500, 'nine' -> 9; None if malformed."""
    if 'hundred' not in words:
        return _below_hundred(words)
    at = words.index('hundred')
    times = 1 if words[:at] == ['a'] else _below_hundred(words[:at])
    rest = words[at + 1:]
    tail = _below_hundred(rest[1:] if rest[:1] == ['and'] else rest) if rest else 0
    return None if times is None or tail is None else times * 100 + tail


def _whole(words):
    """'a hundred and fifty thousand' -> 150000; None unless the words are one well-formed whole number."""
    if len(words) == 1 and words[0] in WORD_ZERO:
        return 0
    total, group, last = 0, [], None
    for word in words:
        if word not in WORD_SCALE:
            group.append(word)
            continue
        times = 1 if group == ['a'] else _below_thousand(group[1:] if last and group[:1] == ['and'] else group)
        if not times or last and WORD_SCALE[word] >= last:
            return None
        total, group, last = total + times * WORD_SCALE[word], [], WORD_SCALE[word]
    if last and group[:1] == ['and']:
        group = group[1:]  # 'a thousand and five'
    if not group:
        return total if last else None
    rest = _below_thousand(group)
    return None if rest is None else total + rest


def _spoken(words):
    """'minus twelve point five' -> -12.5, 'two point five million' -> 2500000; None unless one well-formed number."""
    sign = -1 if words[:1] in (['minus'], ['negative']) else 1
    words = words[1:] if sign < 0 else words
    if 'point' not in words:
        whole = _whole(words)
        return None if whole is None else sign * whole
    at = words.index('point')
    whole, decimals, scale = words[:at], words[at + 1:], 1
    if decimals and decimals[-1] in WORD_SCALE and not {'hundred', *WORD_SCALE} & set(whole):
        decimals, scale = decimals[:-1], WORD_SCALE[decimals[-1]]
    whole = _whole(whole) if whole else 0
    if whole is None or not decimals or any(word not in WORD_DIGITS for word in decimals):
        return None
    value = sign * scale * (whole + Decimal('0.' + ''.join(str(WORD_DIGITS[word]) for word in decimals)))
    return int(value) if value == value.to_integral_value() else float(value)


def _trimmed(words):
    """Drops joining words at the edges of a phrase: 'a twenty five and' -> 'twenty five', but 'a hundred' keeps its 'a'."""
    while words and words[0] in ('and', 'a', 'oh') and not (words[0] == 'a' and words[1:2] and words[1] in {'hundred', *WORD_SCALE}):
        words = words[1:]
    while words and words[-1] in ('and', 'a', 'oh'):
        words = words[:-1]
    return words


def spoken_numbers(quote):
    """The amounts a quote says in words: 'twelve point five Euros' -> 12.5, 'twenty-five' -> 25, 'a hundred and fifty
    thousand' -> 150000, 'minus five' -> -5. A phrase gives nothing when it is not one plain amount: malformed or run into
    another number ('twelve fifty', 'fifteen and twenty five', 'twenty to thirty', 'fifty uh million'), an ordinal, fraction
    or percentage ('twenty fifth', 'two and a half', 'half a million', 'ten percent'), next to digits, a magnitude not read
    here ('twenty grand'), or a bare 'one' (usually 'the one', 'no one'). The same amount said twice in a row is one amount."""
    text = (quote or '').casefold()
    tokens = list(re.finditer(r'\d+|%|[^\W\d_]+', text))
    words = [token.group() for token in tokens]
    runs, i = [], 0
    while i < len(words):
        j = i
        while j < len(words) and words[j] in SPOKEN_WORDS and (j == i or re.fullmatch(r'\s+|-', text[tokens[j - 1].end():tokens[j].start()])):
            j += 1
        if NUMBER_WORDS & set(words[i:j]):
            phrase, after, before = _trimmed(words[i:j]), words[j:j + 2], words[max(0, i - 2):i]
            qualified = (after[:1] and QUALIFIER.fullmatch(after[0]) or after == ['per', 'cent']
                         or before[-1:] and (before[-1].isdigit() or FRACTION.fullmatch(before[-1]))
                         or len(before) == 2 and before[1] == 'of' and FRACTION.fullmatch(before[0]))
            runs.append((i, j, None if qualified or phrase == ['one'] else _spoken(phrase)))
        i = max(j, i + 1)
    clusters = []
    for start, end, value in runs:
        gap = words[clusters[-1][-1][1]:start] if clusters else None
        if gap == []:
            clusters[-1].append((start, end, value))  # said again straight after: one amount only if the same
        elif gap and all(word in LINKS for word in gap):
            clusters[-1].append((start, end, None))  # a range, choice, ratio, sum or hesitation: not one amount
        else:
            clusters.append([(start, end, value)])
    return {cluster[0][2] for cluster in clusters if all(run[2] is not None and run[2] == cluster[0][2] for run in cluster)}


def said_in_words(value, quote):
    """True when the quote says this finite amount in words."""
    return value is not None and math.isfinite(value) and value in spoken_numbers(quote)


def repaired(candidate, registry):
    """Two deterministic repairs of a small model's draft, both grounded in the registry or the quote:
    a generic attribute name ("value") on an item with exactly one attribute is that attribute, and
    a number that the quote does not state is replaced by the quote's only number (a 4B model wrote
    "250,000 ringgit" as 2500000). A number the quote says in words ("twelve point five Euros per unit")
    is kept as it is: words confirm the model's value but never supply or replace one. An amount whose
    quote states no number at all is dropped (None): nothing grounds it. Anything else ambiguous is left
    for validation to judge."""
    from dataclasses import replace
    spec = registry.objects.get(candidate.object_id) if candidate.object_id else None
    if spec is None:
        return candidate
    names = [attribute.name for attribute in spec.attributes]
    if candidate.attribute not in names and len(names) == 1:
        candidate = replace(candidate, attribute=names[0])
    attribute = next((a for a in spec.attributes if a.name == candidate.attribute), None)
    if attribute is not None and attribute.type == 'number':
        stated = quoted_numbers(candidate.quote)
        try:
            raw = candidate.value if isinstance(candidate.value, (int, float)) and not isinstance(candidate.value, bool) else re.sub(r'[^\d.\-]', '', str(candidate.value))
            value = float(raw)
        except (ValueError, OverflowError):
            value = None
        numeric = isinstance(candidate.value, (int, float, str)) and not isinstance(candidate.value, bool)
        if numeric and value not in stated and said_in_words(value, candidate.quote):
            return candidate
        if not stated:
            return None
        if len(stated) == 1 and value not in stated:
            candidate = replace(candidate, value=next(iter(stated)))
    return candidate


class SharedExtractor:
    name = 'workspace-qwen'
    last_stats = {}

    def extract(self, context):
        from memoria_engine.extractors import build_prompt, parse_events
        from engine import local_generator
        raw = local_generator()(build_prompt(context))
        candidates, clean = parse_events(raw)
        self.last_stats = {'parsed_cleanly': clean, 'raw': raw}
        return [fixed for candidate in candidates if (fixed := repaired(candidate, context.registry)) is not None]


def accept_with_rebase(service, params):
    """Accept a suggestion. The engine refuses one whose belief has changed since it was proposed (stale). When
    several meetings are taken in before any review, approving an older meeting's value changes the belief
    that a later meeting's suggestion was made against, although its value, quote and dates have not changed:
    the suggestion is then proposed again, unchanged, against today's belief and that one is accepted, with
    the stale one rejected and both steps kept in the ledger's log. The reviewer sees the current value next to
    every suggestion, so accepting it means the same as before."""
    from memoria_engine.ledger import StaleProposal
    try:
        return service.proposals_accept(**params)
    except StaleProposal:
        ledger = service.pipe.ledger
        row = ledger._db.execute('SELECT payload_json, confidence, reason FROM proposals WHERE proposal_id = ?',
                                 (params['proposal_id'],)).fetchone()
        fresh = ledger._write('propose', {'assert': json.loads(row['payload_json']), 'confidence': row['confidence'], 'reason': row['reason']})
        reviewer = params.get('reviewer', 'user')
        ledger.reject(params['proposal_id'], reviewer, note=f'Proposed again as {fresh}: an earlier meeting was approved since.')
        return {**service.proposals_accept(**{**params, 'proposal_id': fresh}), 'reproposed_as': fresh}


def temporal_api(engine, request, extractor=None):
    service = None
    try:
        method = request.get('method')
        params = request.get('params') or {}
        if not isinstance(params, dict): raise ValueError('Temporal parameters must be an object.')
        validate_params(method, params)
        service = Service(str(temporal_home(engine.root)), extractor='none')
        if method == 'overview':
            return {'ok': True, 'data': {'registry': service.registry_get(), 'facts': valid_current(service), 'proposals': service.proposals_list(), 'check': service.check()}}
        if method == 'ingest_reviewed_meeting':
            from meetings_service import MeetingService, MeetingRepository
            record = MeetingService(MeetingRepository(engine)).execute({'operation': 'get', 'id': params.get('meetingId')})
            if not record.get('transcriptPath'): raise ValueError('Review and save the transcript before adding tracked facts.')
            if any(item['meeting_id'] == record['id'] for item in service.meetings_list()):
                raise ValueError('This meeting has already been added to tracked facts. Review its existing proposals or history.')
            if not service.registry.objects: raise ValueError('Track at least one item before reviewing temporal facts.')
            occurred = record.get('created')
            if not occurred: raise ValueError('Set the actual meeting date before adding tracked facts.')
            datetime.fromisoformat(occurred.replace('Z', '+00:00'))
            from engine import safe_path, clock, speaker_label
            source = safe_path(engine.root, record['transcriptPath']).read_text()
            turns = []
            order = []
            for turn in record.get('turns') or []:
                if turn.get('contextTrimmed') or turn.get('timingStatus') == 'unresolved-context-trim':
                    raise ValueError('Context-trimmed text has no aligned audio start. Refine and save the transcript before adding tracked facts.')
                if turn.get('timingStatus') == 'unresolved-live-text':
                    raise ValueError('Live text has no aligned audio start. Refine and save the transcript before adding tracked facts.')
                start = turn.get('start')
                if not isinstance(start, (int, float)) or not math.isfinite(start): raise ValueError('Meeting timestamps are invalid.')
                label = speaker_label(turn['speaker'], record.get('names'), order)
                if f"[{clock(start)}] {label}: {turn['text']}" not in source:
                    raise ValueError('Reviewed source no longer matches the saved transcript. Re-review it first.')
                turns.append({'speaker': label, 'start': start, 'text': turn['text']})
            from memoria_engine.windowed import WindowedExtractor
            shared = WindowedExtractor(extractor or SharedExtractor())
            # Extract before the preserved pipeline commits a source. A generation
            # timeout must not consume the meeting identifier and prevent a retry.
            from memoria_engine.pipeline import Meeting, MeetingContext, Turn
            from memoria_engine.ledger import ts
            from memoria_engine.service import now_us
            built = tuple(Turn(i, t['speaker'], float(t['start']), ' '.join(t['text'].split())) for i, t in enumerate(turns))
            meeting = Meeting(record['id'], ts(occurred), now_us(), built)
            candidates = shared.extract(MeetingContext(meeting, service.registry, service.pipe.beliefs_at(meeting.occurred_at)))
            class PreparedExtractor:
                name = shared.name
                last_stats = getattr(shared, 'last_stats', {})
                def extract(self, _context): return candidates
            service.extractor = lambda _kind: PreparedExtractor()
            result = service.meetings_ingest(record['id'], turns, occurred_at=occurred, extractor='mlx', policy='confirm_all')
            return {'ok': True, 'data': result}
        if method not in ALLOWED: raise ValueError('Unknown temporal operation.')
        if method == 'query' and params.get('type') == 'as_of_tx' and not params.get('valid_at'):
            # "As known" means the value in force now, restricted to the recorded cutoff.
            params = {**params, 'valid_at': datetime.now().astimezone().isoformat()}
        if method in ('facts.correct', 'facts.retract') and not str(params.get('reason') or '').strip():
            raise ValueError('A reason is required for a correction or retraction.')
        if method == 'proposals.accept':
            result = accept_with_rebase(service, params)
        else:
            result = valid_current(service) if method == 'facts.current' else getattr(service, METHODS[method])(**params)
        if method == 'query' and params.get('type') == 'n_changes':
            result['history'] = service.facts_history(params['object_id'], params['attribute'])
            result['evidence'] = [item for fact in result['history'] for item in fact.get('evidence', [])]
        return {'ok': True, 'data': result}
    except Exception as error:
        return {'ok': False, 'error': {'code': 'TEMPORAL_REQUEST_FAILED', 'message': str(error)}}
    finally:
        if service is not None: service.pipe.ledger.close()
