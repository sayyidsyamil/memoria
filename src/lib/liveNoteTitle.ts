/**
 * The first H1 of a note edited as a live document (the web build with a Memoria remote).
 * Its edits are saved by the document, not through the shell's content-change path, so the
 * editor reports the title here and the untitled-note rename listens.
 */

export type LiveNoteTitleListener = (path: string, title: string | null) => void

const listeners = new Set<LiveNoteTitleListener>()

export function reportLiveNoteTitle(path: string, title: string | null): void {
  for (const listener of listeners) listener(path, title)
}

/** Returns the unsubscribe. */
export function onLiveNoteTitle(listener: LiveNoteTitleListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
