export interface TranscriptTurn {
  speaker: string
  text: string
  start?: number
}

export interface ParsedTranscript {
  title: string
  occurredAt?: string
  turns: TranscriptTurn[]
}

export interface ParseOptions {
  /** Read ambiguous 01/02/2026 as 1 February. Defaults to the browser locale's order. */
  dayFirst?: boolean
}

const FRONTMATTER_DATE_KEYS = ['occurred_at', 'meeting_date', 'date', 'created', 'datetime']
const SPEAKER_LINE = /^\*\*(.+?)\*\*\s*(?:[·•|–-]\s*((?:\d+:)?\d{1,2}:\d{2}))?\s*[:：]?\s*(.*)$/
const CLOCK = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/
const PLACEHOLDER = /^_\(.*\)_$/

export function clockToSeconds(clock: string): number | undefined {
  const match = CLOCK.exec(clock.trim())
  if (!match) return undefined
  const [, hours, minutes, seconds] = match
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds)
}

function splitFrontmatter(markdown: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)
  if (!match) return { meta: {}, body: markdown }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w -]*):\s*(.*)$/.exec(line)
    if (pair) meta[pair[1].trim().toLowerCase()] = pair[2].trim().replace(/^["']|["']$/g, '')
  }
  return { meta, body: markdown.slice(match[0].length) }
}

function localeIsDayFirst(): boolean {
  const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2000, 10, 25))
  const order = parts.map((p) => p.type)
  return order.indexOf('day') < order.indexOf('month')
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const TIME_PART = String.raw`(?:(?:,|\s+at)?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?\.?[Mm]?\.?)?`
const DAY_MONTH_YEAR = new RegExp(String.raw`^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})` + TIME_PART)
const MONTH_DAY_YEAR = new RegExp(String.raw`^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})` + TIME_PART)

const pad = (n: number | string, width = 2) => String(n).padStart(width, '0')

function isoFrom(year: number, month: number, day: number, time?: { h: number; m: number; s: number }): string | undefined {
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined
  const clock = time ? `${pad(time.h)}:${pad(time.m)}:${pad(time.s)}` : '00:00:00'
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${clock}Z`
}

function to24h(hour: number, meridiem?: string): number {
  if (!meridiem) return hour
  const pm = meridiem.toLowerCase().startsWith('p')
  return (hour % 12) + (pm ? 12 : 0)
}

/** Wall-clock date and time as written in the note, as an ISO string (no timezone shifting). */
export function parseNoteDate(text: string, options: ParseOptions = {}): string | undefined {
  const value = text.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(value)
  if (iso) {
    const time = iso[4] ? { h: Number(iso[4]), m: Number(iso[5]), s: Number(iso[6] ?? 0) } : undefined
    return isoFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]), time)
  }
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}),?\s*(?:(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?\.?[Mm]?\.?)?/.exec(value)
  if (slash) {
    const [a, b] = [Number(slash[1]), Number(slash[2])]
    const dayFirst = a > 12 ? true : b > 12 ? false : (options.dayFirst ?? localeIsDayFirst())
    const [day, month] = dayFirst ? [a, b] : [b, a]
    const time = slash[4]
      ? { h: to24h(Number(slash[4]), slash[7]), m: Number(slash[5]), s: Number(slash[6] ?? 0) }
      : undefined
    return isoFrom(Number(slash[3]), month, day, time)
  }
  return parseWithMonthName(value)
}

function parseWithMonthName(value: string): string | undefined {
  const dmy = DAY_MONTH_YEAR.exec(value)
  const mdy = dmy ? null : MONTH_DAY_YEAR.exec(value)
  const match = dmy ?? mdy
  if (!match) return undefined
  const [day, monthName] = dmy ? [match[1], match[2]] : [match[2], match[1]]
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) + 1
  if (month === 0) return undefined
  const time = match[4]
    ? { h: to24h(Number(match[4]), match[7]), m: Number(match[5]), s: Number(match[6] ?? 0) }
    : undefined
  return isoFrom(Number(match[3]), month, Number(day), time)
}

// The date line usually carries the time of day; the frontmatter date wins only when the two disagree.
function findOccurredAt(meta: Record<string, string>, body: string, options: ParseOptions): string | undefined {
  const key = FRONTMATTER_DATE_KEYS.find((k) => meta[k] && parseNoteDate(meta[k], options))
  const fromMeta = key ? parseNoteDate(meta[key], options) : undefined
  const quote = body.split(/\r?\n/).find((line) => line.startsWith('>'))
  const first = quote?.replace(/^>\s*/, '').split(/\s+[·•]\s+/)[0]
  const fromLine = first ? parseNoteDate(first, options) : undefined
  if (fromMeta && fromLine && fromMeta.slice(0, 10) !== fromLine.slice(0, 10)) return fromMeta
  return fromLine ?? fromMeta
}

function transcriptLines(body: string): { lines: string[]; sectionFound: boolean } {
  const lines = body.split(/\r?\n/)
  const heading = lines.findIndex((line) => /^##\s+transcript\s*$/i.test(line.trim()))
  if (heading === -1) return { lines, sectionFound: false }
  const rest = lines.slice(heading + 1)
  const next = rest.findIndex((line) => /^##\s+\S/.test(line))
  return { lines: next === -1 ? rest : rest.slice(0, next), sectionFound: true }
}

// Without a Transcript section, text before the first speaker line is not part of the conversation.
function collectTurns(lines: string[], sectionFound: boolean): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  let current: { speaker: string; start?: number; parts: string[] } | null = null
  const flush = () => {
    const text = current?.parts.join(' ').replace(/\s+/g, ' ').trim()
    if (current && text) turns.push({ speaker: current.speaker, text, ...(current.start === undefined ? {} : { start: current.start }) })
    current = null
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || PLACEHOLDER.test(line)) continue
    const header = SPEAKER_LINE.exec(line)
    if (header) {
      flush()
      const clock = header[2] ? clockToSeconds(header[2]) : undefined
      current = { speaker: header[1].replace(/[:：]\s*$/, '').trim(), start: clock, parts: header[3] ? [header[3]] : [] }
    } else {
      if (!current && !sectionFound) continue
      current ??= { speaker: 'Unknown', parts: [] }
      current.parts.push(line)
    }
  }
  flush()
  return turns
}

export function parseTranscriptNote(markdown: string, options: ParseOptions = {}): ParsedTranscript {
  const { meta, body } = splitFrontmatter(markdown)
  const title = /^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1]?.trim() ?? ''
  const occurredAt = findOccurredAt(meta, body, options)
  const { lines, sectionFound } = transcriptLines(body)
  const turns = collectTurns(lines, sectionFound)
  return { title, ...(occurredAt ? { occurredAt } : {}), turns }
}
