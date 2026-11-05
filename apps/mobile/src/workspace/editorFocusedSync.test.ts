import { afterEach, expect, it, vi } from 'vitest'
import { createEditorSaveGate } from './editorSaveGate'
import { createWorkspaceSyncEditors } from './workspaceSyncEditors'
import { createGitEditorAccess } from './git/gitEditorAccess'
import { createMobileAutoGit } from './git/mobileAutoGit'

afterEach(() => vi.useRealTimers())

it('defers automatic synchronization without disabling or blurring a focused editor', async () => {
  const adapter = { read: async () => 'draft', commit: vi.fn(), setEditable: vi.fn(), isFocused: () => true }
  const gate = createEditorSaveGate(adapter)
  await expect(gate.prepare(true)).rejects.toThrow('editorSyncDeferred')
  expect(adapter.setEditable).not.toHaveBeenCalled()
  await gate.save()
  expect(adapter.commit).toHaveBeenCalledWith('draft')
  const resume = await gate.prepare(false)
  expect(adapter.setEditable).toHaveBeenCalledWith(false)
  resume()
  expect(adapter.setEditable).toHaveBeenLastCalledWith(true)
})

it('rechecks focus at each Git write boundary, including after a network wait', async () => {
  const editors = createWorkspaceSyncEditors()
  let focused = false
  const adapter = { read: async () => 'draft', commit: vi.fn(), setEditable: vi.fn(), isFocused: () => focused }
  const gate = createEditorSaveGate(adapter)
  editors.register(gate.prepare, 'draft.md')
  let foreground = true
  const refresh = vi.fn()
  const access = createGitEditorAccess({ editors, refresh, deferWhileFocused: () => foreground })
  const operation = vi.fn(async () => ({ value: 'saved', workspaceChanged: false }))
  await access(operation)
  focused = true
  await expect(access(operation)).rejects.toThrow('editorSyncDeferred')
  expect(operation).toHaveBeenCalledOnce()
  expect(refresh).not.toHaveBeenCalled()
  expect(editors.isBlocked()).toBe(false)
  foreground = false
  await access(operation)
  expect(operation).toHaveBeenCalledTimes(2)
})

it('retries editor deferral at the idle interval without escalating network backoff', async () => {
  vi.useFakeTimers()
  let focused = true
  const run = vi.fn(async () => focused ? { deferred: true } : undefined)
  const scheduler = createMobileAutoGit(run, 100)
  scheduler.update({ enabled: true, foreground: true, blocked: false })
  scheduler.dirty()
  await vi.advanceTimersByTimeAsync(300)
  expect(run).toHaveBeenCalledTimes(3)
  focused = false
  await vi.advanceTimersByTimeAsync(100)
  expect(run).toHaveBeenCalledTimes(4)
  await vi.advanceTimersByTimeAsync(1000)
  expect(run).toHaveBeenCalledTimes(4)
  scheduler.dispose()
})
