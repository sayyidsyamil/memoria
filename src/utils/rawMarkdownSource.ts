import type { ChangeSet } from '@codemirror/state'

type DocumentOffset = number

/** CodeMirror offsets count every line ending as one character. */
function sourceOffset(source: string, position: DocumentOffset): number {
  let extra = 0
  for (const match of source.matchAll(/\r\n/g)) {
    if (match.index - extra >= position) break
    extra++
  }
  return position + extra
}

/** Apply raw transactions to source bytes, retaining untouched mixed line endings. */
export function applyRawMarkdownChanges(source: string, changes: ChangeSet): string {
  const parts: string[] = []
  let cursor = 0
  const separator = source.match(/\r\n|\r|\n/)?.[0] ?? '\n'
  changes.iterChanges((from, to, _fromAfter, _toAfter, inserted) => {
    const start = sourceOffset(source, from)
    const end = sourceOffset(source, to)
    parts.push(source.slice(cursor, start), inserted.sliceString(0, inserted.length, separator))
    cursor = end
  })
  parts.push(source.slice(cursor))
  return parts.join('')
}
