import { expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { mobileWorkspaceHistoryEntry } from '../screens/tabletWorkspaceHistory'
import { applyMobileWorkspaceEditWithWrites, type MobileWorkspaceEdit, type MobileWorkspaceWrite } from './mobileWorkspaceEditing'
import { createMobilePreparedEdits } from './mobilePreparedEdits'
import type { MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

const content = '---\ntitle: Original\ncustom: keep me\ntags: [one, two]\n---\n\nFull body, not the preview.\n'

function harness(count = 1) {
  const fixture = workspaceScenarioForId('default')
  const notes = Array.from({ length: count }, (_, index) => ({
    ...fixture.notes[0], id: `note-${index}`, path: `note-${index}.md`, rawContent: undefined,
  }))
  let snapshot: MobileWorkspaceSnapshot = { ...fixture, notes, allNotes: notes }
  let current = true
  const writes: MobileWorkspaceWrite[] = []
  const read = vi.fn<() => Promise<string | null>>(async () => content)
  const apply = vi.fn((edit: MobileWorkspaceEdit) => {
    const result = applyMobileWorkspaceEditWithWrites(snapshot, edit)
    snapshot = result.snapshot
    writes.push(...result.writes)
    return result
  })
  const prepared = createMobilePreparedEdits({
    apply, read, snapshot: () => snapshot, isCurrent: () => current, source: 'native',
  })
  return {
    apply, prepared, read, writes,
    snapshot: () => snapshot,
    replace: (next: MobileWorkspaceSnapshot) => { snapshot = next },
    invalidate: () => { current = false },
  }
}

it('loads an unselected note before archiving without losing frontmatter or body', async () => {
  const state = harness()
  await state.prepared.apply({ type: 'setArchived', noteId: 'note-0', archived: true })
  expect(state.read).toHaveBeenCalledTimes(1)
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0]).toMatchObject({ kind: 'saveNote', path: 'note-0.md' })
  expect(state.snapshot().notes[0].rawContent).toContain('custom: keep me')
  expect(state.snapshot().notes[0].rawContent).toContain('Full body, not the preview.')
  expect(state.snapshot().notes[0].archived).toBe(true)
})

it('hydrates a deleted note before recording the inverse, so Undo restores its bytes', async () => {
  const state = harness()
  let beforeDelete = state.snapshot()
  state.apply.mockImplementation((edit) => {
    const previous = state.snapshot()
    if (edit.type === 'deleteNote') beforeDelete = previous
    const result = applyMobileWorkspaceEditWithWrites(previous, edit)
    state.replace(result.snapshot)
    return result
  })
  const edit = { type: 'deleteNote' as const, noteId: 'note-0' }
  await state.prepared.apply(edit)
  const undo = mobileWorkspaceHistoryEntry(beforeDelete, state.snapshot(), edit)?.undoEdits[0]
  expect(undo).toBeDefined()
  if (!undo) throw new Error('Missing inverse edit')
  const restored = await state.prepared.apply(undo)
  expect(restored.writes).toEqual([{ kind: 'createNote', path: 'note-0.md', content }])
})

it('reads each bulk target once and writes nothing when any content read fails', async () => {
  const state = harness(2)
  state.read.mockResolvedValueOnce(content).mockRejectedValueOnce(new Error('Unavailable'))
  const edit: MobileWorkspaceEdit = { type: 'bulkEdit', edits: [
    { type: 'setArchived', noteId: 'note-0', archived: true },
    { type: 'setOrganized', noteId: 'note-0', organized: true },
    { type: 'deleteNote', noteId: 'note-1' },
  ] }
  await expect(state.prepared.apply(edit)).rejects.toThrow()
  expect(state.read).toHaveBeenCalledTimes(2)
  expect(state.apply).not.toHaveBeenCalled()
  expect(state.writes).toEqual([])
  expect(state.snapshot().notes).toHaveLength(2)
  await state.prepared.apply(edit)
  expect(state.snapshot().notes).toHaveLength(1)
})

it('does not turn a missing file into a writable empty note', async () => {
  const state = harness()
  state.read.mockResolvedValue(null)
  await expect(state.prepared.apply({ type: 'deleteNote', noteId: 'note-0' })).rejects.toThrow('mobileNoteReadFailed')
  expect(state.apply).not.toHaveBeenCalled()
})

it('accepts a genuinely empty file', async () => {
  const state = harness()
  state.read.mockResolvedValue('')
  await state.prepared.apply({ type: 'deleteNote', noteId: 'note-0' })
  expect(state.writes).toEqual([{ kind: 'deleteNote', path: 'note-0.md' }])
})

it('does not apply a delayed action after its vault generation changes', async () => {
  const state = harness()
  state.read.mockImplementation(async () => { state.invalidate(); return content })
  await state.prepared.apply({ type: 'deleteNote', noteId: 'note-0' })
  expect(state.apply).not.toHaveBeenCalled()
})

it('preserves a newer loaded draft when an older read completes', async () => {
  const state = harness()
  const draft = `${content}\nNew draft\n`
  state.read.mockImplementation(async () => {
    state.apply({ type: 'hydrateNoteContent', noteId: 'note-0', rawContent: draft })
    return content
  })
  await state.prepared.apply({ type: 'setArchived', noteId: 'note-0', archived: true })
  expect(state.snapshot().notes[0].rawContent).toContain('New draft')
})

it('keeps loaded editor saves synchronous and does not reread their contents', () => {
  const state = harness()
  state.apply({ type: 'hydrateNoteContent', noteId: 'note-0', rawContent: content })
  const result = state.prepared.apply({ type: 'updateNoteContent', noteId: 'note-0', content: `${content}Typed` })
  expect(result).not.toBeInstanceOf(Promise)
  expect(state.snapshot().notes[0].rawContent).toContain('Typed')
  expect(state.read).not.toHaveBeenCalled()
})

it('lets the sync boundary wait for pending preparations and their writes', async () => {
  const state = harness()
  let finish: (value: string) => void = () => {}
  state.read.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const action = state.prepared.apply({ type: 'setArchived', noteId: 'note-0', archived: true })
  const ready = vi.fn()
  const idle = state.prepared.whenIdle().then(ready)
  await Promise.resolve()
  expect(ready).not.toHaveBeenCalled()
  finish(content)
  await action
  await idle
  expect(state.writes).toHaveLength(1)
})
