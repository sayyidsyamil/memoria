"""Workspace-scoped adapter around the preserved FYP decision ledger.

Reviewed transcript ingestion preserves meeting dates, speaker labels, and recorded
offsets. Temporal proposals always require human approval. No UI or model loads at import.
"""
import json
import math
from datetime import datetime
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


class SharedExtractor:
    name = 'workspace-qwen'
    last_stats = {}

    def extract(self, context):
        from memoria_engine.extractors import build_prompt, parse_events
        from engine import local_generator
        raw = local_generator()(build_prompt(context))
        candidates, clean = parse_events(raw)
        self.last_stats = {'parsed_cleanly': clean, 'raw': raw}
        return candidates


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
        result = valid_current(service) if method == 'facts.current' else getattr(service, METHODS[method])(**params)
        if method == 'query' and params.get('type') == 'n_changes':
            result['history'] = service.facts_history(params['object_id'], params['attribute'])
            result['evidence'] = [item for fact in result['history'] for item in fact.get('evidence', [])]
        return {'ok': True, 'data': result}
    except Exception as error:
        return {'ok': False, 'error': {'code': 'TEMPORAL_REQUEST_FAILED', 'message': str(error)}}
    finally:
        if service is not None: service.pipe.ledger.close()
