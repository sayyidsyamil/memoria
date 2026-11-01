import { useEffect } from 'react'
import type * as Y from 'yjs'

/**
 * The live documents open on this page (the web build with a Memoria remote), so writes that
 * do not come from the editor, like property edits, go into the document instead of the file.
 */
export interface LiveNoteDocument {
  /** The note the document belongs to now: it follows a rename made from this page. */
  readonly path: string
  readonly doc: Y.Doc
}

const documents = new Set<LiveNoteDocument>()

/** Returns the unregister. */
export function registerLiveNoteDocument(document: LiveNoteDocument): () => void {
  documents.add(document)
  return () => {
    documents.delete(document)
  }
}

export function liveNoteDocument(path: string): LiveNoteDocument | null {
  for (const document of documents) {
    if (document.path === path) return document
  }
  return null
}

/** Keeps `document` registered while it is set. */
export function useLiveNoteDocument(document: LiveNoteDocument | null): void {
  useEffect(() => (document ? registerLiveNoteDocument(document) : undefined), [document])
}
