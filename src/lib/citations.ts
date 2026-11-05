import { clock } from './speakers'
import { reviewerName } from '../features/temporal/temporalBoard'
import type { TemporalCorrection } from '../features/temporal/temporalService'

/** Where a cited quote comes from: a moment in a meeting recording, or a page of a document. */
export interface CitedQuote {
  kind?: 'tracked-fact'
  sourceTitle: string
  page: number
  moment?: { meetingTitle: string; at: number | null } | null
}

export interface SourceCitation extends CitedQuote {
  id: string
  sourcePath: string
  quote: string
  moment?: { meetingId: string; meetingTitle: string; at: number | null } | null
  factId?: number
  objectId?: string
  attribute?: string
  requiresCurrent?: boolean
}

/** A reviewer assertion has no transcript quote or audio moment. The inherited source is context only. */
export interface ManualCorrectionCitation {
  id: string
  kind: 'manual-correction'
  factId: number
  objectId: string
  attribute: string
  requiresCurrent?: boolean
  statement: string
  correction: TemporalCorrection
  recordedAt: string
  decidedAt: string
  claimFrom: string
  claimTo: string | null
  originalContext: { sourcePath: string; sourceTitle: string }[]
}

export type MemoryCitation = SourceCitation | ManualCorrectionCitation

/** A citation chip: the meeting (or document) and where in it. Long titles are shortened; the chip keeps the full title on hover. */
export function citeLabel(evidence: CitedQuote | ManualCorrectionCitation) {
  if (evidence.kind === 'manual-correction') {
    const title = `Correction by ${reviewerName(evidence.correction.reviewer)}`
    return { title, where: 'Manual', name: `${title}: ${evidence.statement}`, full: `${title} · ${evidence.correction.reason}` }
  }
  const title = evidence.moment?.meetingTitle ?? evidence.sourceTitle
  const where = evidence.moment?.at != null ? clock(evidence.moment.at) : `p.${evidence.page}`
  return { title: title.length > 40 ? `${title.slice(0, 39)}…` : title, where,
    name: `Quote from ${title}${evidence.moment?.at != null ? ` at ${where}` : `, page ${evidence.page}`}`, full: `${title} · ${where}` }
}
