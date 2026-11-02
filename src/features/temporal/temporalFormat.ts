import { formatDay, formatDayTime, plural } from '../../lib/format'
import type { TemporalAttributeType, TemporalEvidence, TemporalQuery, TemporalValue } from './temporalService'

/** Meeting id → title, as far as it could be looked up. */
export type MeetingTitles = ReadonlyMap<string, string>

export interface DateOptions {
  /** Also show the time of day. Calendar dates (YYYY-MM-DD) have none, so they never gain one. */
  time?: boolean
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
 * A date for people, in Memoria's one style: "10 Oct 2026", or "10 Oct 2026, 09:30" with the time. `dateTime` is the exact
 * original value for a `<time>` element. Returns null for anything that is not a real ISO date or timestamp, so callers can
 * show it as written. A calendar date (YYYY-MM-DD) is a day, not an instant; timestamps are shown in the viewer's zone.
 */
export function readableDate(value: string, { time = false, timeZone }: DateOptions = {}): { label: string; dateTime: string } | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const parsed = parseDate(text)
  if (!parsed) return null
  if (parsed.calendar) return { label: formatDay(parsed.date, 'UTC'), dateTime: text }
  return { label: time ? formatDayTime(parsed.date, timeZone) : formatDay(parsed.date, timeZone), dateTime: text }
}

/** Today's calendar day in the viewer's zone, as YYYY-MM-DD: what a deadline is compared with. */
export function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** A calendar date value (YYYY-MM-DD) that names a real day. */
export function isCalendarDay(value: TemporalValue | undefined): value is string {
  if (typeof value !== 'string') return false
  const day = CALENDAR_DATE.exec(value.trim())
  return !!day && !!calendarDay(Number(day[1]), Number(day[2]), Number(day[3]))
}

// Currencies are written before the amount ("RM 280,000", "$2,500"); other units after it ("12 days", "40%").
const CURRENCIES = new Set(['RM', 'MYR', 'USD', 'US$', '$', 'EUR', '€', 'GBP', '£', 'SGD', 'S$', 'AUD', 'A$', 'NZD', 'CAD', 'HKD', 'JPY', '¥',
  'CNY', 'RMB', 'IDR', 'RP', 'INR', '₹', 'THB', '฿', 'PHP', '₱', 'KRW', '₩', 'CHF', 'VND', '₫', 'TWD', 'NT$', 'BND', 'AED', 'SAR'])
const LABEL_UNIT = /^(.*\S)\s*\(([^()\d]{1,8})\)$/u

/**
 * An item label whose last words name a unit in brackets, "Pilot budget (RM)", is shown as its title "Pilot budget" and the
 * unit is written with the amount instead. Only items that hold a number have a unit; "Vendor (final)" stays as it is.
 */
export function labelUnit(label: string, holdsNumber: boolean): { title: string; unit: string | null } {
  const text = typeof label === 'string' ? label.trim() : ''
  const match = holdsNumber ? LABEL_UNIT.exec(text) : null
  return match ? { title: match[1], unit: match[2].trim() } : { title: text, unit: null }
}

const NUMBER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

/** "RM 280,000", "$2,500", "12 days", "40%", or "280,000" without a unit. */
export function formatAmount(value: number, unit: string | null = null): string {
  const amount = NUMBER.format(value)
  if (!unit) return amount
  if (CURRENCIES.has(unit.toUpperCase())) return [...unit].length === 1 ? `${unit}${amount}` : `${unit} ${amount}`
  return unit === '%' ? `${amount}%` : `${amount} ${unit}`
}

/** A lower-case word from an allowed-values list ("done", "planned") reads as a word in a sentence: "Done". */
function capitalized(text: string): string {
  return /^[a-z][a-z -]*$/.test(text) ? text[0].toUpperCase() + text.slice(1) : text
}

/** A recorded value as people read it: dates in the one date style, numbers with separators and their unit, words as written. */
export function formatValue(value: TemporalValue | undefined, type?: TemporalAttributeType, unit: string | null = null): string {
  if (value == null) return 'Not recorded'
  if (typeof value === 'number' && Number.isFinite(value) && (type === 'number' || type === undefined)) return formatAmount(value, type === 'number' ? unit : null)
  if (type === 'date' && isCalendarDay(value)) return readableDate(value)?.label ?? value
  if (type === 'enum' && typeof value === 'string') return capitalized(value)
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}

const ATTRIBUTE_LABELS: Record<string, string> = { deadline: 'Due', due: 'Due', due_date: 'Due', duedate: 'Due' }

/** An attribute name as a row label: "deadline" is "Due", "go_live" is "Go live". */
export function attributeLabel(name: string): string {
  if (ATTRIBUTE_LABELS[name.toLowerCase()]) return ATTRIBUTE_LABELS[name.toLowerCase()]
  const words = name.replace(/[_-]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : name
}

/** "changed 1×" for a value that changed; empty when it never changed or the count is unusable. */
export function changedTimes(count: number): string {
  return Number.isInteger(count) && count > 0 ? `changed ${count}×` : ''
}

/** The ledger's refusals in plain words; anything else is shown as the ledger said it. */
export function plainLedgerError(message: string): string {
  if (/made against a belief that has since changed/i.test(message)) {
    return 'This suggestion is out of date: the value changed after it was made, so it cannot be accepted. Reject it, then correct the value on the board if needed.'
  }
  if (/has already been reviewed/i.test(message)) return 'This suggestion was already reviewed. Refresh to see the board as it is.'
  return message
}

const SKIPPED: Record<string, string> = {
  ungrounded: 'quote not found in the transcript', unresolved: 'unclear which item', invalid: 'not a value the item allows',
}

/** What reading a meeting found, in words: "6 suggestions to review · 1 skipped: quote not found in the transcript." */
export function ingestSummary(counts: { [key: string]: number } | undefined): string {
  const entries = Object.entries(counts ?? {}).filter(([, count]) => Number.isInteger(count) && count > 0)
  if (!entries.length) return 'No suggestions found in this meeting.'
  const parts = entries.map(([status, count]) => status === 'proposed' ? `${plural(count, 'suggestion')} to review`
    : status === 'applied' ? `${count} added to the board` : `${count} skipped: ${SKIPPED[status] ?? status.replaceAll('_', ' ')}`)
  return `${parts.join(' · ')}.`
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

/** The tracked item's label for a heading; its id only when the registry does not list the item (the id stays on hover). */
export function itemLabel(objectId: string, objects: readonly { object_id: string; label: string }[] | undefined): string {
  const label = objects?.find(item => item.object_id === objectId)?.label
  return typeof label === 'string' && label.trim() ? label.trim() : objectId
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
