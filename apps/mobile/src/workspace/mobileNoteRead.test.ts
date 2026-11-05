import { describe, expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyWorkspaceEditToWritableSnapshot } from '../screens/tabletWorkspacePersistence'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'
import { mobileNoteNeedsRead, startMobileNoteRead } from './mobileNoteRead'

function metadataSnapshot() {
  const snapshot = workspaceScenarioForId('default')
  const note = { ...snapshot.notes[0], rawContent: undefined }
  return { ...snapshot, notes: [note], allNotes: [note] }
}

describe('selected note read recovery', () => {
  it.each([null, new Error('unavailable')])('reports unreadable content without hydrating a substitute: %s', async (failure) => {
    const onContent = vi.fn()
    const onError = vi.fn()
    const read = async () => { if (failure instanceof Error) throw failure; return failure }
    await startMobileNoteRead({ read, onContent, onError }).finished
    expect(onContent).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('accepts a genuinely empty file and supports a successful retry', async () => {
    const read = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('')
    const onContent = vi.fn()
    const onError = vi.fn()
    await startMobileNoteRead({ read, onContent, onError }).finished
    await startMobileNoteRead({ read, onContent, onError }).finished
    expect(onContent).toHaveBeenCalledExactlyOnceWith('')
    expect(onError).toHaveBeenCalledOnce()
  })

  it.each([false, true])('ignores late completion after navigating away, including errors: %s', async (reject) => {
    const onContent = vi.fn()
    const onError = vi.fn()
    let finish = () => {}
    const pending = new Promise<string | null>((resolve, fail) => {
      finish = () => { if (reject) fail(new Error('late error')); else resolve('old note body') }
    })
    const request = startMobileNoteRead({ read: () => pending, onContent, onError })
    request.cancel()
    finish()
    await request.finished
    expect(onContent).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a retryable failure when the file provider read never completes', async () => {
    vi.useFakeTimers()
    try {
      const onError = vi.fn()
      const request = startMobileNoteRead({
        read: () => new Promise<string | null>(() => {}),
        onContent: vi.fn(),
        onError,
        timeoutMs: 100,
      })

      await vi.advanceTimersByTimeAsync(100)
      await request.finished
      expect(onError).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never reads over an existing draft, but loads metadata-only native notes', () => {
    const note = metadataSnapshot().notes[0]
    expect(mobileNoteNeedsRead(note, 'native')).toBe(true)
    expect(mobileNoteNeedsRead({ ...note, rawContent: '' }, 'native')).toBe(false)
    expect(mobileNoteNeedsRead({ ...note, rawContent: 'unsaved draft' }, 'native')).toBe(false)
    expect(mobileNoteNeedsRead({ ...note, fileKind: 'binary' }, 'native')).toBe(false)
    expect(mobileNoteNeedsRead(note, 'fixture')).toBe(false)
    expect(mobileNoteNeedsRead(null, 'native')).toBe(false)
  })

  it.each(['hydrateNoteContent', 'hydrateTextFileContent'] as const)('does not replace newer content with a stale %s reply', (type) => {
    const snapshot = metadataSnapshot()
    const note = { ...snapshot.notes[0], fileKind: type === 'hydrateNoteContent' ? 'markdown' as const : 'text' as const, rawContent: 'newer draft' }
    const current = { ...snapshot, notes: [note], allNotes: [note] }
    const result = applyMobileWorkspaceEditWithWrites(current, { type, noteId: note.id, rawContent: 'old disk content' })
    expect(result.snapshot.notes[0].rawContent).toBe('newer draft')
    expect(result.writes).toEqual([])
  })

  it('blocks property and editor mutations before native content is loaded', () => {
    const snapshot = metadataSnapshot()
    const noteId = snapshot.notes[0].id
    for (const edit of [
      { type: 'toggleFavorite' as const, noteId },
      { type: 'updateNoteContent' as const, noteId, content: 'replacement' },
      { type: 'updateProperty' as const, noteId, key: 'Status', value: 'Done' },
      { type: 'createRelationshipTarget' as const, sourceNoteId: noteId, key: 'relatedTo', targetTitle: 'New target' },
      { type: 'bulkEdit' as const, edits: [{ type: 'setArchived' as const, noteId, archived: true }] },
    ]) {
      expect(applyWorkspaceEditToWritableSnapshot(snapshot, edit, 'native')).toEqual({ snapshot, writes: [] })
    }
  })

  it('still hydrates a read-only workspace without writing or editing it', () => {
    const snapshot = { ...metadataSnapshot(), sync: { kind: 'readOnly' as const } }
    const noteId = snapshot.notes[0].id
    const result = applyWorkspaceEditToWritableSnapshot(snapshot, { type: 'hydrateNoteContent', noteId, rawContent: '# Read only\n' }, 'host')
    expect(result.snapshot.notes[0].rawContent).toBe('# Read only\n')
    expect(result.writes).toEqual([])
    expect(applyWorkspaceEditToWritableSnapshot(result.snapshot, { type: 'updateNoteContent', noteId, content: 'changed' }, 'host').writes).toEqual([])
  })
})
