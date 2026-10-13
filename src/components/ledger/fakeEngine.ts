import type { AskResult, Brief, HistoryEntry, IngestResult, LedgerFact, MeetingSummary, Proposal } from '../../lib/ledgerApi'
import { SAMPLE_REGISTRY } from '../../lib/ledgerSampleRegistry'

type Handler = (params: Record<string, unknown>) => unknown

const evidence = (quote: string, speaker: string, meeting = 'transcripts/steering-1.md') => ({ quote, speaker, meeting, audio_start: 150, char_start: 0, char_end: quote.length })

export const GOLIVE_EVIDENCE = evidence('Migration testing slipped. Let us set go-live for the fifteenth of December.', 'Wei Ling')

export const FACTS: LedgerFact[] = [
  { fact_id: 3, object_id: 'golive', attribute: 'date', label: 'Go-live date', kind: 'decision', value: '2026-12-15', n_changes: 1, valid_from: '2026-11-16', decided_at: '2026-11-16T09:32:30', evidence: [GOLIVE_EVIDENCE] },
  { fact_id: 5, object_id: 'budget', attribute: 'amount', label: 'Pilot budget (RM)', kind: 'decision', value: 280000, n_changes: 0, valid_from: '2026-11-02', decided_at: '2026-11-02T09:40:00', evidence: [evidence('We settled at two hundred and eighty thousand.', 'Raj')] },
]

export const HISTORY: HistoryEntry[] = [
  { fact_id: 2, object_id: 'golive', attribute: 'date', label: 'Go-live date', value: '2026-12-01', claim_from: '2026-10-19', claim_to: '2026-11-16', decided_at: '2026-10-19T09:30:00', change_type: 'INITIAL', supersedes: null, confirms: null, corrects: null, retracted: null, evidence: [evidence('Go-live is the first of December.', 'Aisha')] },
  { fact_id: 3, object_id: 'golive', attribute: 'date', label: 'Go-live date', value: '2026-12-15', claim_from: '2026-11-16', claim_to: null, decided_at: '2026-11-16T09:32:30', change_type: 'REVISE', supersedes: 2, confirms: null, corrects: null, retracted: null, evidence: [GOLIVE_EVIDENCE] },
]

export const PROPOSAL: Proposal = {
  proposal_id: 7, object_id: 'training', label: 'Staff training', attribute: 'deadline', value: '2026-12-10', current_value: '2026-11-30',
  confidence: 0.7, reason: 'confirm_conflicts', quote: 'Maybe the training can slip to the tenth of December.', speaker: 'Raj', meeting: 'transcripts/steering-1.md',
}

export const BRIEF: Brief = {
  open_commitments: [{ object_id: 'training', label: 'Staff training', status: 'open', owner: 'raj', deadline: '2026-11-30' }],
  recent_changes: [{ label: 'Go-live date', attribute: 'date', from: '2026-12-01', to: '2026-12-15', decided_at: '2026-11-16T09:32:30', quote: 'Let us set go-live for the fifteenth of December.' }],
  decisions: [], waiting_for_review: 1, meetings: 1,
}

export const TRANSCRIPT_B = '---\ntype: Transcript\ndate: 2026-11-30\n---\n\n# Steering 2\n\n## Transcript\n\n**Aisha** · 0:05\nWelcome back.\n\n**Raj** · 0:40\nTraining is done.\n'

export interface FakeState {
  registry: typeof SAMPLE_REGISTRY
  facts: LedgerFact[]
  proposals: Proposal[]
  meetings: MeetingSummary[]
  askResult: AskResult
  calls: { method: string; params: Record<string, unknown> }[]
  failWith: string | null
  /** One-off failures per method; consumed by the next call of that method. */
  failOnce: Record<string, { message: string; apply?: () => void }>
}

export function freshState(): FakeState {
  return {
    registry: structuredClone(SAMPLE_REGISTRY),
    facts: structuredClone(FACTS),
    proposals: [structuredClone(PROPOSAL)],
    meetings: [{ meeting_id: 'transcripts/steering-1.md', occurred_at: '2026-10-19T09:30:00', source_id: 'abc', evidence_items: 3 }],
    askResult: { ok: false, reason: 'no match', route: { type: null, object_id: null, attribute: null, valid_at: null, tx_at: null, ok: false, reason: 'no match' } },
    calls: [],
    failWith: null,
    failOnce: {},
  }
}

export function makeEngine(state: FakeState) {
  const ingestResult: IngestResult = { meeting_id: '', stored_only: false, turns: 2, counts: { applied: 1, proposed: 1, ungrounded: 0, invalid: 0, unresolved: 0 }, items: [], seconds: 1 }
  const handlers: Record<string, Handler> = {
    ping: () => ({ version: 't', extractor: 'none', objects: 6, meetings: 1 }),
    'registry.get': () => state.registry,
    'registry.set': (p) => { state.registry = { objects: [...state.registry.objects, ...(p.objects as never[])], people: { ...state.registry.people, ...(p.people as object) } }; return state.registry },
    'meetings.list': () => state.meetings,
    'meetings.ingest': (p) => {
      state.meetings = [...state.meetings, { meeting_id: String(p.meeting_id), occurred_at: String(p.occurred_at), source_id: 'new', evidence_items: 1 }]
      return { ...ingestResult, meeting_id: String(p.meeting_id) }
    },
    'facts.current': () => state.facts,
    'facts.history': () => HISTORY,
    'proposals.list': () => state.proposals,
    'proposals.accept': () => { state.proposals = []; return { fact_id: 9, status: 'applied' } },
    'proposals.reject': () => { state.proposals = []; return { rejected: 7 } },
    'facts.correct': () => ({ fact_id: 10, status: 'applied' }),
    'facts.retract': () => ({ retracted: 3 }),
    ask: () => state.askResult,
    brief: () => BRIEF,
  }
  return async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (command === 'get_note_content') return TRANSCRIPT_B
    const { method, params } = args as { method: string; params: Record<string, unknown> }
    state.calls.push({ method, params })
    if (state.failWith) throw new Error(state.failWith)
    const once = state.failOnce[method]
    if (once) {
      delete state.failOnce[method]
      once.apply?.()
      throw new Error(once.message)
    }
    const handler = handlers[method]
    if (!handler) throw new Error(`unexpected method ${method}`)
    return structuredClone(handler(params))
  }
}
