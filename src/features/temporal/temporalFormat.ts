import { plural } from '../../lib/format'
import type { TemporalEvidence, TemporalQuery, TemporalValue } from './temporalService'

/** Meeting id → title, as far as it could be looked up. */
export type MeetingTitles = ReadonlyMap<string, string>

export interface DateOptions {
  /** Also show the time of day. Calendar dates (YYYY-MM-DD) have none, so they never gain one. */
  time?: boolean
  /** BCP 47 tag; defaults to the viewer's locale. */
  locale?: string
  /** IANA zone for timestamps; defaults to the viewer's zone. Calendar dates ignore it. */
  timeZone?: string
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
// ISO 8601 date and time with optional seconds, fraction and zone (Z, ±HH, ±HHMM or ±HH:MM).
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i

/** Midnight UTC of a real calendar day, or null. Held in UTC so that no viewer zone can move it to a neighbouring day. */
function calendarDay(year: number, month: number, day: number): Date | null {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  // Engines roll 2026-02-30 over to March; that is not a date the ledger could have recorded.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null
}

function parseDate(text: string): { date: Date; calendar: boolean } | null {
  const day = CALENDAR_DATE.exec(text)
  if (day) {
    const date = calendarDay(Number(day[1]), Number(day[2]), Number(day[3]))
    return date && { date, calendar: true }
  }
  const stamp = TIMESTAMP.exec(text)
  if (!stamp || !calendarDay(Number(stamp[1]), Number(stamp[2]), Number(stamp[3]))) return null
  const [, year, month, date, hour, minute, second = '00', fraction = '', zone = ''] = stamp
  // Engines disagree on short offsets and long fractions, so hand them the one form every engine accepts.
  const offset = zone.length > 1 ? zone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2').replace(/^([+-]\d{2})$/, '$1:00') : zone.toUpperCase()
  const instant = new Date(`${year}-${month}-${date}T${hour}:${minute}:${second}.${fraction.slice(0, 3).padEnd(3, '0')}${offset}`)
  return Number.isNaN(instant.getTime()) ? null : { date: instant, calendar: false }
}

/**
 * A date for people: "10 Oct 2026" or "Oct 10, 2026" depending on the locale. `dateTime` is the exact original value
 * for a `<time>` element. Returns null for anything that is not a real ISO date or timestamp, so callers can show it as written.
 * A calendar date (YYYY-MM-DD) is a day, not an instant; timestamps are shown in the viewer's zone, like the meeting list.
 */
export function readableDate(value: string, { time = false, locale, timeZone }: DateOptions = {}): { label: string; dateTime: string } | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const parsed = parseDate(text)
  if (!parsed) return null
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  if (time && !parsed.calendar) { options.hour = '2-digit'; options.minute = '2-digit' }
  options.timeZone = parsed.calendar ? 'UTC' : timeZone
  return { label: new Intl.DateTimeFormat(locale, options).format(parsed.date), dateTime: text }
}

/** "2 changes" for a fact line; empty when the count is unusable so that no "NaN changes" is ever shown. */
export function changeCount(count: number): string {
  if (!Number.isInteger(count) || count < 0) return ''
  return count === 0 ? 'no changes' : plural(count, 'change')
}

/** A whole-sentence answer to "how many times did this change?". */
export function changeSummary(count: number): string {
  if (count === 0) return 'No changes recorded'
  if (count === 1) return 'Changed once'
  return count === 2 ? 'Changed twice' : `Changed ${count} times`
}

const SHORT_ID_LENGTH = 4

/** The meeting's title, or a short labelled id when the title is unknown (deleted meeting, failed lookup). */
export function meetingLabel(id: string | null | undefined, titles: MeetingTitles): string {
  if (typeof id !== 'string' || !id.trim()) return 'Meeting not recorded'
  const title = titles.get(id)?.trim()
  return title || `Meeting ${id.length > SHORT_ID_LENGTH ? `${id.slice(0, SHORT_ID_LENGTH)}…` : id}`
}

/** What a lookup returned, reduced to what the panel can show. Unknown shapes are kept so they can still be inspected. */
export type QueryAnswerView =
  | { kind: 'changes'; count: number; evidence: TemporalEvidence[] }
  | { kind: 'value'; value: TemporalValue; decidedAt: string | null; evidence: TemporalEvidence[] }
  | { kind: 'unknown'; raw: TemporalValue }

function isRecord(value: TemporalValue | undefined): value is { [key: string]: TemporalValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Evidence without repeats: a count query returns the quotes of every version, and corrections inherit their predecessor's quote. */
function citations(value: TemporalValue | undefined): TemporalEvidence[] {
  const seen = new Set<string>()
  const evidence: TemporalEvidence[] = []
  for (const item of Array.isArray(value) ? value : []) {
    if (!isRecord(item)) continue
    const entry: TemporalEvidence = {
      quote: typeof item.quote === 'string' ? item.quote : '',
      speaker: typeof item.speaker === 'string' ? item.speaker : null,
      meeting: typeof item.meeting === 'string' ? item.meeting : null,
      audio_start: typeof item.audio_start === 'number' ? item.audio_start : null,
    }
    const key = JSON.stringify(entry)
    if (!seen.has(key)) { seen.add(key); evidence.push(entry) }
  }
  return evidence
}

export function describeQueryResult(result: TemporalValue, type: TemporalQuery['type']): QueryAnswerView {
  if (!isRecord(result) || !('answer' in result)) return { kind: 'unknown', raw: result }
  const evidence = citations(result.evidence)
  const { answer } = result
  if (type === 'n_changes' && typeof answer === 'number' && Number.isInteger(answer) && answer >= 0) return { kind: 'changes', count: answer, evidence }
  return { kind: 'value', value: answer, decidedAt: typeof result.decided_at === 'string' ? result.decided_at : null, evidence }
}
