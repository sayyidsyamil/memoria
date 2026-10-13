import type { IngestResult } from '../../lib/ledgerApi'

export const PARSE_WARNING =
  "The language model's answer could not be fully read for this meeting. Some decisions may be missing. You can add the meeting again later."

/** Why the engine set a suggestion aside, in plain words (engine statuses: ungrounded, unresolved, invalid). */
const IGNORED_REASONS: Record<string, string> = {
  ungrounded: 'the quoted words were not found in the transcript',
  unresolved: 'it was not clear which tracked item it was about',
  invalid: 'its value or date could not be understood',
}
const OTHER_REASON = 'it could not be used'

export interface IngestSummary {
  recorded: number
  review: number
  ignored: number
  /** False when the model's reply could not be fully read, so the counts may be too low. */
  readCleanly: boolean
  /** One sentence per reason that something was ignored. */
  ignoredReasons: string[]
  /** The counts as one sentence. */
  text: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function describeIngest(result: IngestResult): IngestSummary {
  const counts = result.counts ?? {}
  const recorded = counts.applied ?? 0
  const review = counts.proposed ?? 0
  const readCleanly = result.stats?.parsed_cleanly !== false
  const ignoredByStatus = Object.entries(counts).filter(([status, n]) => status !== 'applied' && status !== 'proposed' && n > 0)
  const ignored = ignoredByStatus.reduce((sum, [, n]) => sum + n, 0)
  const ignoredReasons = ignoredByStatus.map(([status, n]) => `${plural(n, 'suggestion', 'suggestions')} ignored because ${IGNORED_REASONS[status] ?? OTHER_REASON}`)
  const parts = [`${plural(recorded, 'decision or promise', 'decisions and promises')} recorded`, `${review} waiting for your review`, `${ignored} ignored`]
  return { recorded, review, ignored, readCleanly, ignoredReasons, text: `${parts.join(', ')}.` }
}

export function summariseIngest(result: IngestResult): string {
  if (result.stored_only) return 'Saved the meeting. Automatic reading is switched off, so no decisions were looked for.'
  const summary = describeIngest(result)
  const details = summary.ignoredReasons.map((r) => `${r.charAt(0).toUpperCase()}${r.slice(1)}.`)
  if (!summary.readCleanly) return [PARSE_WARNING, `Found so far: ${summary.text}`, ...details].join(' ')
  return [summary.text, ...details].join(' ')
}
