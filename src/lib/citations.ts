import { clock } from './speakers'

/** Where a cited quote comes from: a moment in a meeting recording, or a page of a document. */
export interface CitedQuote {
  sourceTitle: string
  page: number
  moment?: { meetingTitle: string; at: number | null } | null
}

/** A citation chip: the meeting (or document) and where in it. Long titles are shortened; the chip keeps the full title on hover. */
export function citeLabel(evidence: CitedQuote) {
  const title = evidence.moment?.meetingTitle ?? evidence.sourceTitle
  const where = evidence.moment?.at != null ? clock(evidence.moment.at) : `p.${evidence.page}`
  return { title: title.length > 40 ? `${title.slice(0, 39)}…` : title, where,
    name: `Quote from ${title}${evidence.moment?.at != null ? ` at ${where}` : `, page ${evidence.page}`}`, full: `${title} · ${where}` }
}
