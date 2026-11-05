import { afterEach, expect, it, vi } from 'vitest'
import { createWorkspaceSnapshotFrame } from './workspaceSnapshotFrame'
import { buildLocalVaultWorkspaceSnapshot } from '../workspace/localVaultSnapshot'
import { applyMobileWorkspaceEditWithWrites } from '../workspace/mobileWorkspaceEditing'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import type { MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'

afterEach(() => vi.restoreAllMocks())

function snapshot(contents: Record<string, string> = { 'one.md': '# One', 'two.md': '# Two', 'three.md': '# Three' }) {
  return buildLocalVaultWorkspaceSnapshot({
    files: Object.entries(contents).map(([relativePath, content]) => ({
      absolutePath: `/qa/${relativePath}`, relativePath, content, createdAt: 1, modifiedAt: 1, size: content.length,
    })),
    vaultAlias: 'qa', vaultLabel: 'QA', vaultPath: 'file:///qa',
  })
}

function editFrame(frame: ReturnType<typeof createWorkspaceSnapshotFrame>, edit: MobileWorkspaceEdit) {
  const result = applyMobileWorkspaceEditWithWrites(frame.getSnapshot().workspaceSnapshot, edit)
  frame.setWorkspaceSnapshot(result.snapshot)
  return result
}

function viewDefinition(name: string) {
  return { name, icon: null, color: null, sort: null, filters: { all: [] } }
}

it('merges scan results without overwriting edits, creations, moves or deletions made during the scan', async () => {
  const frame = createWorkspaceSnapshotFrame(snapshot(), 4)
  const reload = frame.beginBackgroundReload()
  editFrame(frame, { type: 'updateNoteContent', noteId: 'one.md', content: '# Local draft\n\nUnsaved input' })
  editFrame(frame, { type: 'renameNoteFile', noteId: 'two.md', filenameStem: 'renamed' })
  editFrame(frame, { type: 'deleteNote', noteId: 'three.md' })
  const created = editFrame(frame, { type: 'createNote', title: 'Created during scan' })
  const current = frame.getSnapshot().workspaceSnapshot
  const localNote = current.notes.find(note => note.id === 'one.md')
  const history = { past: [{ undoEdits: [], redoEdits: [] }], future: [] }
  frame.setWorkspaceHistory(history)
  const listener = vi.fn()
  frame.subscribe(listener)

  expect(await reload.complete(snapshot({ 'one.md': '# Stale scan', 'two.md': '# Two', 'three.md': '# Three', 'remote.md': '# Added externally' }))).toBe(true)
  const merged = frame.getSnapshot().workspaceSnapshot
  expect(merged.allNotes?.map(note => note.id)).toEqual(expect.arrayContaining(['one.md', 'renamed.md', 'created-during-scan.md', 'remote.md']))
  expect(merged.allNotes?.map(note => note.id)).not.toEqual(expect.arrayContaining(['two.md', 'three.md']))
  expect(merged.notes.find(note => note.id === 'one.md')).toBe(localNote)
  expect(merged.selectedNoteId).toBe(current.selectedNoteId)
  expect(frame.getSnapshot().workspaceHistory).toBe(history)
  expect(frame.generation).toBe(4)
  expect(listener).toHaveBeenCalledOnce()
  expect(created.writes).toHaveLength(1)
})

it('accepts external source changes for unchanged notes instead of preserving incidental re-derived objects', async () => {
  const base = snapshot()
  const frame = createWorkspaceSnapshotFrame(base)
  const reload = frame.beginBackgroundReload()
  editFrame(frame, { type: 'updateNoteContent', noteId: 'one.md', content: '# Local' })
  const fresh = snapshot({ 'one.md': '# Old', 'two.md': '# Changed externally' })
  expect(await reload.complete(fresh)).toBe(true)
  expect(frame.getSnapshot().workspaceSnapshot.notes.find(note => note.id === 'two.md')?.rawContent).toBe('# Changed externally')
  expect(frame.getSnapshot().workspaceSnapshot.allNotes?.some(note => note.id === 'three.md')).toBe(false)
})

it('rejects a local creation colliding with a different newly scanned file without publishing any partial result', async () => {
  const frame = createWorkspaceSnapshotFrame(snapshot())
  const reload = frame.beginBackgroundReload()
  editFrame(frame, { type: 'createNote', title: 'Collision' })
  const current = frame.getSnapshot()
  const listener = vi.fn()
  frame.subscribe(listener)
  await expect(reload.complete(snapshot({ 'collision.md': '# Someone else' }))).rejects.toThrow('workspaceReloadConflict')
  expect(frame.getSnapshot()).toBe(current)
  expect(listener).not.toHaveBeenCalled()
})

it('does not apply cancelled, superseded or already-completed reloads', async () => {
  const frame = createWorkspaceSnapshotFrame(snapshot())
  const old = frame.beginBackgroundReload()
  const next = frame.beginBackgroundReload()
  expect(await old.complete(snapshot({ 'old.md': '# Old' }))).toBe(false)
  expect(await next.complete(snapshot({ 'new.md': '# New' }))).toBe(true)
  expect(await next.complete(snapshot({ 'old.md': '# Old' }))).toBe(false)
  const cancelled = frame.beginBackgroundReload()
  cancelled.cancel()
  expect(await cancelled.complete(snapshot())).toBe(false)
  expect(frame.getSnapshot().workspaceSnapshot.notes[0].id).toBe('new.md')
})

it('rejects a different vault and leaves a retired frame isolated from its replacement', async () => {
  const retired = createWorkspaceSnapshotFrame(snapshot())
  const reload = retired.beginBackgroundReload()
  const replacement = createWorkspaceSnapshotFrame(snapshot(), 2)
  const current = replacement.getSnapshot()
  const otherVault: MobileWorkspaceSnapshot = { ...snapshot(), source: {
    kind: 'localVault', alias: 'qa', label: 'Other', vaultPath: 'file:///other', totalNotes: 3, visibleNotes: 3,
  } }
  await expect(reload.complete(otherVault)).rejects.toThrow('workspaceReloadIdentityMismatch')
  expect(replacement.getSnapshot()).toBe(current)
})

it('retries a cooperative 6000-note merge when input arrives during a real timer turn', async () => {
  const base = snapshot({ 'one.md': '# One' })
  const note = base.notes[0]
  const notes = Array.from({ length: 6000 }, (_, index) => ({ ...note, id: `note-${index}.md`, path: `note-${index}.md` }))
  const large = { ...base, notes, allNotes: notes, selectedNoteId: notes[0].id }
  const frame = createWorkspaceSnapshotFrame(large)
  const reload = frame.beginBackgroundReload()
  let clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => ++clock)
  const input = vi.fn(() => frame.setWorkspaceSnapshot(current => ({ ...current, searchQuery: 'input received', sync: { kind: 'writeFailed' } })))
  setTimeout(input, 0)
  expect(await reload.complete({ ...large, notes: [...notes], allNotes: [...notes] })).toBe(true)
  expect(input).toHaveBeenCalledOnce()
  expect(frame.getSnapshot().workspaceSnapshot).toMatchObject({ searchQuery: 'input received', sync: { kind: 'writeFailed' } })
  expect(frame.getSnapshot().workspaceSnapshot.allNotes).toHaveLength(6000)
})

it('keeps a selected metadata-only note outside the recent-note window selected after merging', async () => {
  const base = snapshot()
  const current = { ...base, notes: [base.notes[0]], selectedNoteId: base.notes[2].id }
  const frame = createWorkspaceSnapshotFrame(current)
  const reload = frame.beginBackgroundReload()
  expect(await reload.complete({ ...base, notes: [base.notes[0]] })).toBe(true)
  expect(frame.getSnapshot().workspaceSnapshot.selectedNoteId).toBe(base.notes[2].id)
  expect(frame.getSnapshot().workspaceSnapshot.notes.some(note => note.id === base.notes[2].id)).toBe(true)
})

it('merges local type/view/folder changes while accepting new external definitions and preserving failures', async () => {
  const base = { ...snapshot(), folderPaths: ['before', 'removed', 'untouched'],
    typeDefinitions: { Note: { rawContent: 'old template' }, Removed: { rawContent: 'removed' } },
    views: [{ id: 'local', filename: 'local.yml', definition: viewDefinition('Before') },
      { id: 'removed', filename: 'removed.yml', definition: viewDefinition('Removed') }],
  }
  const frame = createWorkspaceSnapshotFrame(base)
  const reload = frame.beginBackgroundReload()
  const current = { ...base, folderPaths: ['before', 'untouched', 'created'],
    typeDefinitions: { Note: { rawContent: 'local template' } },
    views: [{ ...base.views[0], definition: viewDefinition('Local change') }],
    vaultConfig: { defaultNoteWidth: 'wide' as const }, sync: { kind: 'writeFailed' as const },
  }
  frame.setWorkspaceSnapshot(current)
  const fresh = { ...base, folderPaths: ['before', 'removed', 'removed/child', 'remote'],
    typeDefinitions: { ...base.typeDefinitions, Remote: { rawContent: 'fresh template' } },
    views: [...base.views, { id: 'remote', filename: 'remote.yml', definition: viewDefinition('Remote') }],
  }
  expect(await reload.complete(fresh)).toBe(true)
  const merged = frame.getSnapshot().workspaceSnapshot
  expect(merged.typeDefinitions).toEqual({ Note: { rawContent: 'local template' }, Remote: { rawContent: 'fresh template' } })
  expect(merged.views?.map(view => view.id)).toEqual(['local', 'remote'])
  expect(merged.views?.[0]).toBe(current.views[0])
  expect(merged.folderPaths).toEqual(['before', 'created', 'remote'])
  expect(merged.vaultConfig).toBe(current.vaultConfig)
  expect(merged.sync.kind).toBe('writeFailed')
})

it('allows a created file already observed by the scan only when exact source and identity agree', async () => {
  const frame = createWorkspaceSnapshotFrame(snapshot())
  const reload = frame.beginBackgroundReload()
  const created = editFrame(frame, { type: 'createNote', title: 'Created' })
  const written = created.writes.find(write => write.kind === 'createNote')
  if (written?.kind !== 'createNote') throw new Error('missing test creation')
  expect(await reload.complete(snapshot({ [written.path]: written.content }))).toBe(true)
  expect(frame.getSnapshot().workspaceSnapshot.allNotes?.filter(note => note.id === written.path)).toHaveLength(1)
})

it('cancels an in-flight merge before notification when a newer reload takes ownership', async () => {
  const base = snapshot()
  const notes = Array.from({ length: 6000 }, (_, index) => ({ ...base.notes[0], id: `${index}.md`, path: `${index}.md` }))
  const large = { ...base, notes, allNotes: notes }
  const frame = createWorkspaceSnapshotFrame(large)
  const reload = frame.beginBackgroundReload()
  let clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => ++clock)
  const listener = vi.fn()
  frame.subscribe(listener)
  setTimeout(() => frame.beginBackgroundReload(), 0)
  expect(await reload.complete(large)).toBe(false)
  expect(listener).not.toHaveBeenCalled()
  expect(frame.getSnapshot().workspaceSnapshot).toBe(large)
})

it('does not treat missing scanned source as proof that a colliding creation has the same bytes', async () => {
  const frame = createWorkspaceSnapshotFrame(snapshot())
  const reload = frame.beginBackgroundReload()
  editFrame(frame, { type: 'createNote', title: 'Collision' })
  const fresh = snapshot({ 'collision.md': '# Collision' })
  const summary = { ...fresh.notes[0], rawContent: undefined }
  await expect(reload.complete({ ...fresh, notes: [], allNotes: [summary] })).rejects.toThrow('workspaceReloadConflict')
  expect(frame.getSnapshot().workspaceSnapshot.notes[0].rawContent).toContain('Collision')
})

it.each(['readOnly', 'noVault'] as const)('rejects %s metadata instead of giving it mutation authority', async kind => {
  const frame = createWorkspaceSnapshotFrame(snapshot())
  const reload = frame.beginBackgroundReload()
  const current = frame.getSnapshot()
  await expect(reload.complete({ ...snapshot(), sync: { kind } })).rejects.toThrow('workspaceReloadAuthorityRequired')
  expect(frame.getSnapshot()).toBe(current)
})

it.each(['duplicate-id', 'case-alias', 'mismatched-detail'] as const)('rejects malformed %s scan results before publication', async kind => {
  const fresh = snapshot()
  const first = fresh.notes[0]
  const duplicate = kind === 'duplicate-id' ? first : { ...first, id: 'alias.md', path: first.path?.toUpperCase() }
  const invalid = kind === 'mismatched-detail'
    ? { ...fresh, notes: [{ ...first, path: 'different.md' }] }
    : { ...fresh, allNotes: [...fresh.allNotes ?? [], duplicate] }
  const frame = createWorkspaceSnapshotFrame(snapshot())
  const current = frame.getSnapshot()
  await expect(frame.beginBackgroundReload().complete(invalid)).rejects.toThrow('workspaceReloadDuplicateNote')
  expect(frame.getSnapshot()).toBe(current)
})
