import { hasConflict, merge3 } from './lineMerge.ts'

/**
 * What to do with a live document when its file changed underneath it (a desktop commit that
 * arrived through git). All three texts are in the serializer's form, frontmatter included.
 */
export interface ReconcileInput {
  /** The file the document was last in step with. */
  base: string
  /** The document now, including edits not yet written to the file. */
  live: string
  /** The file as it is now. */
  incoming: string
}

export type Reconciliation =
  /** The document already says what the file says. */
  | { kind: 'unchanged' }
  /** The document has no edits of its own: it takes the file's content. */
  | { kind: 'adopt'; markdown: string }
  /** Both changed, in different places: the document gets the file's changes and keeps its own. */
  | { kind: 'merged'; markdown: string }
  /** Both changed the same lines. The caller keeps both versions as separate files. */
  | { kind: 'conflict' }

function lines(text: string): string[] {
  return text.split('\n')
}

export function reconcile({ base, live, incoming }: ReconcileInput): Reconciliation {
  if (incoming === live) return { kind: 'unchanged' }
  if (live === base) return { kind: 'adopt', markdown: incoming }
  if (incoming === base) return { kind: 'merged', markdown: live }
  const chunks = merge3(lines(base), lines(live), lines(incoming))
  if (hasConflict(chunks)) return { kind: 'conflict' }
  const merged = chunks.flatMap((chunk) => (chunk.kind === 'conflict' ? [] : chunk.lines))
  return { kind: 'merged', markdown: merged.join('\n') }
}
