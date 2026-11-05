import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { type LiveNoteDocument, liveNoteDocument, registerLiveNoteDocument, useLiveNoteDocument } from './liveNoteDocuments'

const unregisters: (() => void)[] = []

function register(document: LiveNoteDocument): void {
  unregisters.push(registerLiveNoteDocument(document))
}

afterEach(() => {
  for (const unregister of unregisters.splice(0)) unregister()
})

describe('live note documents', () => {
  it('finds a registered document by its note path until it is unregistered', () => {
    const document = { path: 'a.md', doc: new Y.Doc() }
    const unregister = registerLiveNoteDocument(document)
    expect(liveNoteDocument('a.md')).toBe(document)
    expect(liveNoteDocument('b.md')).toBeNull()
    unregister()
    expect(liveNoteDocument('a.md')).toBeNull()
  })

  it('follows a document whose note was renamed', () => {
    const document = { path: 'untitled.md', doc: new Y.Doc() }
    register(document)
    document.path = 'renamed.md'
    expect(liveNoteDocument('untitled.md')).toBeNull()
    expect(liveNoteDocument('renamed.md')).toBe(document)
  })

  it('keeps a document registered while the hook holds it', () => {
    const first = { path: 'first.md', doc: new Y.Doc() }
    const second = { path: 'second.md', doc: new Y.Doc() }
    const { rerender, unmount } = renderHook(({ document }) => useLiveNoteDocument(document), {
      initialProps: { document: first as LiveNoteDocument | null },
    })
    expect(liveNoteDocument('first.md')).toBe(first)

    rerender({ document: second })
    expect(liveNoteDocument('first.md')).toBeNull()
    expect(liveNoteDocument('second.md')).toBe(second)

    rerender({ document: null })
    expect(liveNoteDocument('second.md')).toBeNull()

    rerender({ document: first })
    unmount()
    expect(liveNoteDocument('first.md')).toBeNull()
  })
})
