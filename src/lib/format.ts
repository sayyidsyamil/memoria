// One date style everywhere in Memoria: "9 Nov 2026", and with a time "12 Oct 2026, 09:30" (24-hour clock).
// Month names are written out here rather than by Intl, whose short months differ between engines ("Sep" or "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface DayParts { year: number; month: number; day: number; hour: number; minute: number }

/** The calendar parts of an instant: in the viewer's zone by default, or in the IANA zone given (e.g. 'UTC'). */
function dayParts(date: Date, timeZone?: string): DayParts {
  if (!timeZone) return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]))
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute) }
}

/** "9 Nov 2026". */
export function formatDay(date: Date, timeZone?: string): string {
  const { year, month, day } = dayParts(date, timeZone)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

/** "12 Oct 2026, 09:30". */
export function formatDayTime(date: Date, timeZone?: string): string {
  const parts = dayParts(date, timeZone)
  return `${formatDay(date, timeZone)}, ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

function parse(iso?: string | null) {
  const date = iso ? new Date(iso) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}
export function dayLabel(iso?: string | null) {
  const date = parse(iso)
  return date ? formatDay(date) : ''
}
export function whenLabel(iso?: string | null) {
  const date = parse(iso)
  return date ? formatDayTime(date) : ''
}

/** Two-letter initials for a person, the digit for "Speaker 2", and "?" for an unknown voice. */
export function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (!words.length || /^unknown/i.test(label)) return '?'
  if (/^speaker\s+\d+$/i.test(label)) return words[1]
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

/** Splits text into plain and matched runs. Matching is by word prefix, like the engine's lexical search. */
export function highlightParts(text: string, words: string[]): { text: string; hit: boolean }[] {
  if (!words.length || !text) return [{ text, hit: false }]
  const tokens = text.split(/(\s+)/).filter(token => token !== '')
  const hits = tokens.map(token => {
    const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
    return !!word && words.some(candidate => word.startsWith(candidate))
  })
  // Whitespace between two matched words belongs to the match, so a phrase highlights as one run.
  const flags = tokens.map((token, index) => /^\s+$/.test(token) ? !!hits[index - 1] && !!hits[index + 1] : hits[index])
  const parts: { text: string; hit: boolean }[] = []
  tokens.forEach((token, index) => {
    const last = parts[parts.length - 1]
    if (last && last.hit === flags[index]) last.text += token
    else parts.push({ text: token, hit: flags[index] })
  })
  return parts
}

/** "1 meeting", "3 meetings". Pass `many` for irregular plurals. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
