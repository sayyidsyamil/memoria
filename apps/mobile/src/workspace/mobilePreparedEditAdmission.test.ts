import { expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { createMobilePreparedEdits } from './mobilePreparedEdits'
import { applyMobileWorkspaceEditWithWrites, type MobileWorkspaceEdit } from './mobileWorkspaceEditing'
import type { MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

function pendingBulkAction() {
  const base = workspaceScenarioForId('default')
  const notes = [0, 1].map(index => ({ ...base.notes[0], id: `note-${index}`, path: `note-${index}.md`, rawContent: undefined }))
  let snapshot: MobileWorkspaceSnapshot = { ...base, notes, allNotes: notes }
  let finishRead: (content: string) => void = () => undefined
  const pendingRead = new Promise<string>(resolve => { finishRead = resolve })
  const read = vi.fn().mockResolvedValueOnce('# First fresh source\n').mockImplementationOnce(() => pendingRead)
  const apply = vi.fn((edit: MobileWorkspaceEdit) => {
    const result = applyMobileWorkspaceEditWithWrites(snapshot, edit)
    snapshot = result.snapshot
    return result
  })
  const prepared = createMobilePreparedEdits({ apply, read, snapshot: () => snapshot, isCurrent: () => true, source: 'native' })
  const action = prepared.apply({ type: 'bulkEdit', edits: notes.map(note => ({ type: 'setArchived', noteId: note.id, archived: true })) })
  return { action, apply, gate: { resolve: finishRead }, snapshot: () => snapshot, replace: (next: MobileWorkspaceSnapshot) => { snapshot = next } }
}

it.each(['moved', 'deleted'])('rejects a %s later target before publishing any partial hydration', async change => {
  const state = pendingBulkAction()
  await Promise.resolve()
  const current = state.snapshot()
  const notes = change === 'moved'
    ? current.notes.map(note => note.id === 'note-1' ? { ...note, path: 'elsewhere.md' } : note)
    : current.notes.filter(note => note.id !== 'note-1')
  state.replace({ ...current, notes, allNotes: notes })
  state.gate.resolve('# Second fresh source\n')
  await expect(state.action).rejects.toThrow('mobileNoteReadFailed')
  expect(state.apply).not.toHaveBeenCalled()
  expect(state.snapshot().notes[0].rawContent).toBeUndefined()
})
