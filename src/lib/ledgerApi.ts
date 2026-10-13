import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'

export type LedgerValue = string | number | boolean | null
export type AttributeType = 'text' | 'number' | 'date' | 'person' | 'enum'
export type ItemKind = 'decision' | 'commitment'

export interface LedgerEvidence {
  quote: string
  speaker: string
  /** Meeting id: for notes added from the vault this is the note's path relative to the vault. */
  meeting: string
  char_start?: number
  char_end?: number
  audio_start?: number | null
  confidence?: number | null
  extractor?: string
}

export interface LedgerFact {
  fact_id?: number
  object_id: string
  attribute: string
  label: string
  value: LedgerValue
  kind: ItemKind
  n_changes: number
  valid_from: string | null
  decided_at?: string | null
  claim_from?: string | null
  evidence: LedgerEvidence[]
}

export interface HistoryEntry {
  fact_id: number
  object_id: string
  attribute: string
  label: string
  value: LedgerValue
  claim_from: string | null
  claim_to: string | null
  decided_at: string | null
  change_type: string
  supersedes: number | null
  confirms: number | null
  corrects: number | null
  retracted: { tx: number; by: string; reason: string } | null
  evidence: LedgerEvidence[]
}

export interface RegistryAttribute {
  name: string
  type: AttributeType
  values: string[]
  change_kind: 'REVISE' | 'REVERSE'
}

export interface RegistryObject {
  object_id: string
  kind: ItemKind
  label: string
  attributes: RegistryAttribute[]
}

export interface LedgerRegistry {
  objects: RegistryObject[]
  people: Record<string, string>
}

export interface MeetingSummary {
  meeting_id: string
  occurred_at: string | null
  source_id: string
  evidence_items: number
}

export interface IngestItem {
  status: 'applied' | 'proposed' | 'ungrounded' | 'invalid' | 'unresolved' | string
  object_id: string | null
  attribute: string | null
  label: string
  value: LedgerValue
  quote: string | null
  reason: string
  proposal_id: number | null
}

export interface IngestResult {
  meeting_id: string
  stored_only: boolean
  turns: number
  counts: Record<string, number>
  items: IngestItem[]
  seconds: number
}

export interface Proposal {
  proposal_id: number
  object_id: string
  label: string
  attribute: string
  value: LedgerValue
  current_value: LedgerValue
  confidence: number | null
  reason: string
  quote: string | null
  speaker: string | null
  meeting: string | null
}

export type QueryType = 'current' | 'as_of_valid' | 'as_of_tx' | 'n_changes'

export interface QueryResult {
  type: QueryType
  answer: LedgerValue
  decided_at?: string | null
  evidence: LedgerEvidence[]
}

export interface AskRoute {
  type: QueryType | null
  object_id: string | null
  attribute: string | null
  valid_at: string | null
  tx_at: string | null
  ok: boolean
  reason: string
}

export type AskResult =
  | ({ ok: true; route: AskRoute; label: string; seconds: number } & QueryResult)
  | { ok: false; reason: string; route: AskRoute }

export interface BriefCommitment {
  object_id: string
  label: string
  status: string
  owner?: LedgerValue
  deadline?: LedgerValue
  [attribute: string]: LedgerValue | undefined
}

export interface BriefChange {
  label: string
  attribute: string
  from: LedgerValue
  to: LedgerValue
  decided_at: string | null
  quote: string | null
}

export interface Brief {
  open_commitments: BriefCommitment[]
  recent_changes: BriefChange[]
  decisions: LedgerFact[]
  waiting_for_review: number
  meetings: number
}

export interface IngestInput {
  meetingId: string
  turns: { speaker: string; text: string; start?: number }[]
  occurredAt?: string
  extractor?: 'mlx' | 'keyword' | 'none'
}

/** An error from the decision engine. `kind` is the engine's error type, e.g. "StaleProposal" or "AlreadyDone". */
export class LedgerError extends Error {
  readonly kind?: string
  constructor(message: string, kind?: string) {
    super(message)
    this.name = 'LedgerError'
    this.kind = kind
  }
}

const KIND_PREFIX = /^\[([A-Za-z_][A-Za-z0-9_]*)\]\s*/

function rawErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : (error as { message?: unknown })?.message
  return typeof raw === 'string' ? raw.trim() : ''
}

/** The Rust bridge prefixes engine errors with "[Kind] "; this reads the kind back. */
export function ledgerErrorKind(error: unknown): string | undefined {
  if (error instanceof LedgerError && error.kind) return error.kind
  return KIND_PREFIX.exec(rawErrorText(error))?.[1]
}

export function ledgerErrorMessage(error: unknown): string {
  const text = rawErrorText(error).replace(KIND_PREFIX, '')
  if (!text) return 'Something went wrong with the decision engine. Please try again.'
  if (/command ledger_call not found|ledger_call.*not (found|allowed)/i.test(text)) {
    return 'The decision engine is not available in this build of Memoria.'
  }
  if (/No mock handler/i.test(text)) return 'The decision engine is not available in the browser preview.'
  return text
}

type Call = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

function makeCall(vaultPath: string): Call {
  return async <T,>(method: string, params: Record<string, unknown> = {}) => {
    try {
      const args = { vaultPath, method, params }
      return isTauri() ? await invoke<T>('ledger_call', args) : await mockInvoke<T>('ledger_call', args)
    } catch (error) {
      throw new LedgerError(ledgerErrorMessage(error), ledgerErrorKind(error))
    }
  }
}

export function createLedgerApi(vaultPath: string) {
  const call = makeCall(vaultPath)
  return {
    ping: () => call<{ version: string; extractor: string; objects: number; meetings: number }>('ping'),
    getRegistry: () => call<LedgerRegistry>('registry.get'),
    setRegistry: (registry: LedgerRegistry) => call<LedgerRegistry>('registry.set', { objects: registry.objects, people: registry.people }),
    listMeetings: () => call<MeetingSummary[]>('meetings.list'),
    ingestMeeting: ({ meetingId, turns, occurredAt, extractor }: IngestInput) =>
      call<IngestResult>('meetings.ingest', {
        meeting_id: meetingId,
        turns,
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
        ...(extractor ? { extractor } : {}),
      }),
    currentFacts: () => call<LedgerFact[]>('facts.current'),
    factHistory: (objectId: string, attribute: string) => call<HistoryEntry[]>('facts.history', { object_id: objectId, attribute }),
    query: (params: { type: QueryType; objectId: string; attribute: string; validAt?: string; txAt?: string }) =>
      call<QueryResult>('query', {
        type: params.type,
        object_id: params.objectId,
        attribute: params.attribute,
        ...(params.validAt ? { valid_at: params.validAt } : {}),
        ...(params.txAt ? { tx_at: params.txAt } : {}),
      }),
    ask: (question: string) => call<AskResult>('ask', { question }),
    listProposals: () => call<Proposal[]>('proposals.list'),
    acceptProposal: (proposalId: number, edits?: { value: LedgerValue }, note?: string) =>
      call<{ fact_id: number; status: string }>('proposals.accept', {
        proposal_id: proposalId,
        ...(edits ? { edits } : {}),
        ...(note ? { note } : {}),
      }),
    rejectProposal: (proposalId: number, note?: string) =>
      call<{ rejected: number }>('proposals.reject', { proposal_id: proposalId, ...(note ? { note } : {}) }),
    correctFact: (factId: number, value: LedgerValue, reason: string) =>
      call<{ fact_id: number; status: string }>('facts.correct', { fact_id: factId, value, reason }),
    retractFact: (factId: number, reason: string) => call<{ retracted: number }>('facts.retract', { fact_id: factId, reason }),
    brief: () => call<Brief>('brief'),
  }
}

export type LedgerApi = ReturnType<typeof createLedgerApi>
