import { afterEach, expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyWorkspaceEditToWritableSnapshot } from '../screens/tabletWorkspacePersistence'
import { createMobileEditorFocus, requestCreatedNoteFocus, scheduleCreatedEditorFocus } from './mobileEditorFocus'
import { createWorkspaceSyncEditors } from './workspaceSyncEditors'

afterEach(() => vi.useRealTimers())

it('requests focus only after successfully creating a writable note', () => {
  const editors = createWorkspaceSyncEditors()
  const snapshot = workspaceScenarioForId('empty')
  const edit = { type: 'createNote' as const, title: '' }
  const result = applyWorkspaceEditToWritableSnapshot(snapshot, edit)
  const noteId = result.snapshot.selectedNoteId ?? ''
  expect(noteId).not.toBe('')
  requestCreatedNoteFocus(editors, edit, result)
  expect(editors.focus.has(noteId)).toBe(true)
  editors.beginReplacement()
  expect(editors.focus.has(noteId)).toBe(false)
  const blocked = applyWorkspaceEditToWritableSnapshot({ ...snapshot, sync: { kind: 'noVault' } }, edit)
  requestCreatedNoteFocus(editors, edit, blocked)
  expect(editors.focus.has(noteId)).toBe(false)
})

it('only consumes a request for the intended note, once', () => {
  const requests = createMobileEditorFocus()
  requests.request('new.md')
  expect(requests.consume('existing.md')).toBe(false)
  expect(requests.consume('new.md')).toBe(true)
  expect(requests.consume('new.md')).toBe(false)
})

it('waits for the new editor to be ready without repeatedly stealing focus', () => {
  vi.useFakeTimers()
  const requests = createMobileEditorFocus()
  const focus = vi.fn()
  let ready = false
  requests.request('new.md')
  scheduleCreatedEditorFocus({ requests, noteId: 'new.md', isReady: () => ready, focus })
  vi.advanceTimersByTime(500)
  expect(focus).not.toHaveBeenCalled()
  ready = true
  vi.advanceTimersByTime(50)
  expect(focus).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(5000)
  expect(focus).toHaveBeenCalledOnce()
})

it('cancels stale requests on unmount or workspace replacement', () => {
  vi.useFakeTimers()
  const requests = createMobileEditorFocus()
  const focus = vi.fn()
  requests.request('new.md')
  const cancel = scheduleCreatedEditorFocus({ requests, noteId: 'new.md', isReady: () => false, focus })
  cancel()
  vi.runAllTimers()
  expect(focus).not.toHaveBeenCalled()
  expect(requests.consume('new.md')).toBe(false)
  requests.request('new.md')
  requests.clear()
  expect(requests.consume('new.md')).toBe(false)
})

it('does not focus a previously opened note or keep polling forever', () => {
  vi.useFakeTimers()
  const requests = createMobileEditorFocus()
  const focus = vi.fn()
  scheduleCreatedEditorFocus({ requests, noteId: 'existing.md', isReady: () => true, focus })
  requests.request('new.md')
  scheduleCreatedEditorFocus({ requests, noteId: 'new.md', isReady: () => false, focus })
  vi.runAllTimers()
  expect(focus).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
