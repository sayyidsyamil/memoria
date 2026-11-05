import type * as Y from 'yjs'

/** Replaces the text with the smallest edit: what is shared at both ends is left alone. */
export function patchText(text: Y.Text, next: string): void {
  const current = text.toString()
  if (current === next) return
  let start = 0
  while (start < current.length && start < next.length && current[start] === next[start]) start++
  let end = 0
  const limit = Math.min(current.length, next.length) - start
  while (end < limit && current[current.length - 1 - end] === next[next.length - 1 - end]) end++
  text.delete(start, current.length - start - end)
  text.insert(start, next.slice(start, next.length - end))
}
