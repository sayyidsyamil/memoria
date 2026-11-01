const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function parse(iso?: string | null) {
  const date = iso ? new Date(iso) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}
export function dayLabel(iso?: string | null) {
  const date = parse(iso)
  return date ? dayFormat.format(date) : ''
}
export function whenLabel(iso?: string | null) {
  const date = parse(iso)
  return date ? `${dayFormat.format(date)}, ${timeFormat.format(date)}` : ''
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
