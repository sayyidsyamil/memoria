import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMobileEditorFocus } from '../../workspace/mobileEditorFocus'
import { beginNativeInitialContentSync, recoverUntouchedEditorAfterInitialSyncFailure, scheduleNativeCreatedNoteFocus, type NativeInitialContentSync } from './nativeInitialContentSync'

let active: NativeInitialContentSync[] = []
beforeEach(() => { vi.useFakeTimers(); active = [] })
afterEach(() => { active.forEach(sync => { sync.cancel() }); vi.clearAllTimers(); vi.useRealTimers() })

function deferred() {
  let resolve: (value: unknown) => void = () => { throw new Error('Reply not initialized') }
  const promise = new Promise<unknown>(done => { resolve = done })
  return { promise, resolve: (value: unknown = { type: 'doc' }) => resolve(value) }
}

function harness() {
  const flags = { ready: true, interrupted: false, absent: false }
  const reply = deferred()
  const editor = {
    getEditorState: () => ({ isReady: flags.ready }),
    setContentSilently: vi.fn(),
    getJSON: vi.fn(() => reply.promise),
  }
  const onError = vi.fn()
  const start = (content = '<h1>Initial</h1>') => {
    const sync = beginNativeInitialContentSync({
      content, editor: () => flags.absent ? null : editor,
      isReady: () => flags.ready,
      shouldSync: () => !flags.interrupted, onError,
    })
    active.push(sync)
    return sync
  }
  return { flags, reply, editor, onError, start }
}

it('becomes ready on acknowledgement instead of waiting 1250ms', async () => {
  const { start, editor, reply } = harness()
  const began = Date.now()
  const sync = start()
  expect(editor.setContentSilently).toHaveBeenCalledExactlyOnceWith('<h1>Initial</h1>')
  expect(sync.isReady()).toBe(false)
  reply.resolve()
  await sync.settled
  expect(sync.isReady()).toBe(true)
  expect(Date.now() - began).toBeLessThan(50)
  await vi.advanceTimersByTimeAsync(2500)
  expect(editor.setContentSilently).toHaveBeenCalledTimes(1)
})

it('waits for a cold bridge and only then sends content and its read acknowledgement', async () => {
  const { start, flags, editor, reply } = harness()
  flags.ready = false
  const sync = start()
  await vi.advanceTimersByTimeAsync(899)
  expect(editor.setContentSilently).not.toHaveBeenCalled()
  flags.ready = true
  await vi.advanceTimersByTimeAsync(25)
  expect(editor.setContentSilently).toHaveBeenCalledTimes(1)
  expect(editor.getJSON).toHaveBeenCalledTimes(1)
  reply.resolve()
  await sync.settled
  expect(sync.isReady()).toBe(true)
})

it('waits for the editor reference rather than treating method availability as readiness', async () => {
  const { start, flags, editor, reply } = harness()
  flags.absent = true
  const sync = start()
  await vi.advanceTimersByTimeAsync(100)
  expect(editor.getJSON).not.toHaveBeenCalled()
  flags.absent = false
  await vi.advanceTimersByTimeAsync(25)
  reply.resolve()
  await sync.settled
  expect(sync.isReady()).toBe(true)
})

it('cancels a waiting mount without sending old content later', async () => {
  const { start, flags, editor, onError } = harness()
  flags.ready = false
  const sync = start()
  sync.cancel()
  flags.ready = true
  await vi.advanceTimersByTimeAsync(25)
  await sync.settled
  expect(sync.isReady()).toBe(false)
  expect(editor.setContentSilently).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
})

it('ignores a cancelled acknowledgement, including one superseded by another document', async () => {
  const { start, editor } = harness()
  const old = deferred()
  const fresh = deferred()
  editor.getJSON.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  const previous = start('<h1>Previous</h1>')
  previous.cancel()
  const current = start('<h1>Current</h1>')
  old.resolve()
  await previous.settled
  expect(previous.isReady()).toBe(false)
  expect(current.isReady()).toBe(false)
  fresh.resolve()
  await current.settled
  expect(current.isReady()).toBe(true)
  expect(editor.setContentSilently.mock.calls.map(call => call[0])).toEqual(['<h1>Previous</h1>', '<h1>Current</h1>'])
})

it('does not reset a document after the user has already interacted', async () => {
  const { start, flags, editor } = harness()
  flags.interrupted = true
  const sync = start()
  await sync.settled
  expect(editor.setContentSilently).not.toHaveBeenCalled()
  expect(editor.getJSON).not.toHaveBeenCalled()
  expect(sync.isReady()).toBe(false)
})

it('does not overwrite manual input while waiting for a cold bridge', async () => {
  const { start, flags, editor } = harness()
  flags.ready = false
  const sync = start()
  flags.interrupted = true
  await vi.advanceTimersByTimeAsync(25)
  await sync.settled
  expect(editor.setContentSilently).not.toHaveBeenCalled()
})

it('fails closed if the native document read rejects', async () => {
  const { start, editor, onError } = harness()
  editor.getJSON.mockRejectedValue(new Error('Read failed'))
  const sync = start()
  await sync.settled
  expect(sync.isReady()).toBe(false)
  expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
})

it('bounds a bridge that never becomes ready', async () => {
  const { start, flags, editor, onError } = harness()
  flags.ready = false
  const sync = start()
  await vi.advanceTimersByTimeAsync(10_000)
  await sync.settled
  expect(sync.isReady()).toBe(false)
  expect(editor.setContentSilently).not.toHaveBeenCalled()
  expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'editorNotReady' }))
})

it('bounds an unacknowledged content write and ignores its late completion', async () => {
  const { start, reply, onError } = harness()
  const sync = start()
  await vi.advanceTimersByTimeAsync(10_000)
  await sync.settled
  expect(sync.isReady()).toBe(false)
  expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'editorReadTimedOut' }))
  reply.resolve()
  await vi.advanceTimersByTimeAsync(0)
  expect(sync.isReady()).toBe(false)
})

it.each([
  { hasInteracted: false, hasAcceptedChanges: false, shouldRecover: true },
  { hasInteracted: true, hasAcceptedChanges: false, shouldRecover: false },
  { hasInteracted: false, hasAcceptedChanges: true, shouldRecover: false },
])('recovers after an initial sync failure only while the editor is untouched (%o)', ({ hasInteracted, hasAcceptedChanges, shouldRecover }) => {
  const recover = vi.fn()
  expect(recoverUntouchedEditorAfterInitialSyncFailure({ hasInteracted, hasAcceptedChanges, recover })).toBe(shouldRecover)
  expect(recover).toHaveBeenCalledTimes(shouldRecover ? 1 : 0)
})

it('focuses a requested new note promptly after acknowledgement without any content retries', async () => {
  const { start, reply, editor } = harness()
  const sync = start()
  const requests = createMobileEditorFocus()
  requests.request('new')
  const focus = vi.fn()
  const cancel = scheduleNativeCreatedNoteFocus({
    requests, noteId: 'new', isReady: sync.isReady, focus,
    isBlocked: () => false, wasInteracted: () => false,
  })
  reply.resolve()
  await vi.advanceTimersByTimeAsync(50)
  expect(focus).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(2500)
  expect(editor.setContentSilently).toHaveBeenCalledTimes(1)
  expect(focus).toHaveBeenCalledTimes(1)
  cancel()
})

it('consumes a pending autofocus without moving a caret the user already placed', () => {
  const requests = createMobileEditorFocus()
  requests.request('new')
  const focus = vi.fn()
  const cancel = scheduleNativeCreatedNoteFocus({
    requests, noteId: 'new', isReady: () => false, focus,
    isBlocked: () => false, wasInteracted: () => true,
  })
  expect(requests.has('new')).toBe(false)
  expect(focus).not.toHaveBeenCalled()
  cancel()
})

it('does not autofocus existing notes or bypass an active write barrier', async () => {
  const requests = createMobileEditorFocus()
  const focus = vi.fn()
  const blocked = { current: true }
  scheduleNativeCreatedNoteFocus({
    requests, noteId: 'existing', isReady: () => true, focus,
    isBlocked: () => false, wasInteracted: () => false,
  })
  expect(focus).not.toHaveBeenCalled()
  requests.request('new')
  const cancel = scheduleNativeCreatedNoteFocus({
    requests, noteId: 'new', isReady: () => true, focus,
    isBlocked: () => blocked.current, wasInteracted: () => false,
  })
  await vi.advanceTimersByTimeAsync(100)
  expect(focus).not.toHaveBeenCalled()
  blocked.current = false
  await vi.advanceTimersByTimeAsync(50)
  expect(focus).toHaveBeenCalledTimes(1)
  cancel()
})
