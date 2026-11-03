import { invoke } from '@tauri-apps/api/core'

export type TemporalValue = string | number | boolean | null | TemporalValue[] | { [key: string]: TemporalValue }
export type TemporalAttributeType = 'text' | 'number' | 'date' | 'enum'

export interface TemporalAttribute {
  name: string
  type: TemporalAttributeType
  values?: string[]
}

export interface TemporalObject {
  object_id: string
  label: string
  kind: string
  attributes: TemporalAttribute[]
}

export interface TemporalEvidence {
  quote: string
  speaker: string | null
  meeting: string | null
  /** Offset in seconds in the source meeting audio. */
  audio_start?: number | null
}

export type TemporalId = number
export interface TemporalCorrection {
  reviewer: string | null
  reason: string
  replaced_fact_id: TemporalId
}

/** How the ledger records a withdrawn fact: a correction leaves the reason "corrected: …". Older answers sent a flag. */
export interface TemporalRetraction {
  tx?: number
  by?: string | null
  reason?: string | null
}

export interface TemporalFact {
  fact_id: TemporalId
  object_id: string
  label: string
  attribute: string
  value: TemporalValue
  evidence: TemporalEvidence[]
  valid_from: string | null
  n_changes: number
  /** The tracked item's kind (decision, commitment or issue). */
  kind?: string
  decided_at?: string | null
  /** INITIAL, CORRECT, COMPLETE, …: how the fact entered the ledger. */
  change_type?: string | null
  valid_to?: string | null
  tx_from?: string | null
  tx_to?: string | null
  retracted?: boolean | TemporalRetraction | null
  /** Existing history links: the fact this value replaced or reconfirmed. */
  supersedes?: TemporalId | null
  confirms?: TemporalId | null
  corrects?: TemporalId | null
  correction?: TemporalCorrection | null
}

export interface TemporalHistoryFact extends Omit<TemporalFact, 'valid_from' | 'valid_to' | 'n_changes' | 'retracted' | 'decided_at'> {
  claim_from: string | null
  claim_to: string | null
  decided_at: string | null
  retracted: boolean | TemporalRetraction | null
  corrects: TemporalId | null
}

export interface TemporalProposal {
  proposal_id: TemporalId
  /** Always sent by the ledger; lets the panel look up the attribute's type. */
  object_id?: string
  label: string
  attribute: string
  value: TemporalValue
  current_value: TemporalValue
  quote: string
  speaker: string | null
  meeting: string | null
  confidence?: number
  reason?: string | null
}

export interface TemporalOverview {
  registry: { objects: TemporalObject[] }
  facts: TemporalFact[]
  proposals: TemporalProposal[]
  check: { ok: boolean; problems: TemporalValue[] }
}

export type TemporalQuery = { object_id: string; attribute: string } & (
  | { type: 'current' | 'n_changes' }
  | { type: 'as_of_valid'; valid_at: string }
   | { type: 'as_of_tx'; tx_at: string; valid_at?: string }
)

export interface TemporalIngestResult {
  items: TemporalValue[]
  counts: { [key: string]: number }
  [key: string]: unknown
}

interface TemporalMethods {
  overview: { params: Record<string, never>; result: TemporalOverview }
  'registry.set': { params: { objects: TemporalObject[] }; result: TemporalValue }
  'proposals.accept': { params: { proposal_id: TemporalId; edits?: { value: TemporalValue } }; result: TemporalValue }
  'proposals.reject': { params: { proposal_id: TemporalId }; result: TemporalValue }
  'facts.history': { params: { object_id: string; attribute: string }; result: TemporalHistoryFact[] }
  'facts.correct': { params: { fact_id: TemporalId; value: TemporalValue; reason: string }; result: TemporalValue }
  'facts.retract': { params: { fact_id: TemporalId; reason: string }; result: TemporalValue }
  query: { params: TemporalQuery; result: TemporalValue }
  ingest_reviewed_meeting: { params: { meetingId: string }; result: TemporalIngestResult }
}

async function request<M extends keyof TemporalMethods>(
  vaultPath: string, method: M, params: TemporalMethods[M]['params'],
): Promise<TemporalMethods[M]['result']> {
  try {
    return await invoke<TemporalMethods[M]['result']>('temporal_api', { request: { vaultPath, method, params } })
  } catch (error) {
    if (error instanceof Error) throw error
    if (typeof error === 'string') throw new Error(error)
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      throw new Error(error.message)
    }
    throw new Error('The tracked facts service is unavailable. Please try again.')
  }
}

export const temporalService = {
  overview: (vaultPath: string) => request(vaultPath, 'overview', {}),
  setRegistry: (vaultPath: string, objects: TemporalObject[]) => request(vaultPath, 'registry.set', { objects }),
  /** Approves a suggestion; with an edited value the ledger stores that value instead and records the edit. */
  acceptProposal: (vaultPath: string, proposal_id: TemporalId, edits?: { value: TemporalValue }) =>
    request(vaultPath, 'proposals.accept', edits ? { proposal_id, edits } : { proposal_id }),
  rejectProposal: (vaultPath: string, proposal_id: TemporalId) => request(vaultPath, 'proposals.reject', { proposal_id }),
  history: (vaultPath: string, object_id: string, attribute: string) => request(vaultPath, 'facts.history', { object_id, attribute }),
  correctFact: (vaultPath: string, fact_id: TemporalId, value: TemporalValue, reason: string) => request(vaultPath, 'facts.correct', { fact_id, value, reason }),
  retractFact: (vaultPath: string, fact_id: TemporalId, reason: string) => request(vaultPath, 'facts.retract', { fact_id, reason }),
  query: (vaultPath: string, params: TemporalQuery) => request(vaultPath, 'query', params),
  ingestReviewedMeeting: (vaultPath: string, meetingId: string) => request(vaultPath, 'ingest_reviewed_meeting', { meetingId }),
}
