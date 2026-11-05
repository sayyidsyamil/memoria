import { expect, it, vi } from 'vitest'
import { createGitEditorAccess } from './gitEditorAccess'
import { runSavedVaultOperation } from './savedVaultOperation'
import { createWorkspaceSyncEditors } from '../workspaceSyncEditors'
import { withWorkspaceOperation } from './workspaceOperationQueue'
import { withSavedWorkspace } from './workspaceWriteQueue'

it('holds the Git editor barrier until asynchronous refresh is published outside the disk lock', async () => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  editors.register(async () => resume, 'selected')
  let finish = () => {}
  const prepared = new Promise<void>(resolve => { finish = resolve })
  const events: string[] = []
  const access = createGitEditorAccess({ editors, rootUri: 'async-git-refresh', refresh: async selected => {
    expect(selected).toBe('selected')
    await withWorkspaceOperation('async-git-refresh', async () => { events.push('index') })
    await prepared
    events.push('publish')
  } })
  const operation = access(() => withSavedWorkspace('async-git-refresh', async () => ({ value: 'merged', workspaceChanged: true })))
  await vi.waitFor(() => expect(events).toEqual(['index']))
  expect(editors.isBlocked()).toBe(true)
  expect(editors.generation()).toBe(1)
  finish()
  expect(await operation).toBe('merged')
  expect(events).toEqual(['index', 'publish'])
  expect(editors.isBlocked()).toBe(false)
  expect(resume).not.toHaveBeenCalled()
})

it('awaits recovery after an uncertain mutation without reviving stale editor generation', async () => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  editors.register(async () => resume)
  const refresh = vi.fn(async () => { throw new Error('index failed') })
  await expect(runSavedVaultOperation({ editors, refresh, run: async () => {
    throw new Error('checkout interrupted')
  } })).rejects.toThrow('index failed')
  expect(refresh).toHaveBeenCalledOnce()
  expect(editors.generation()).toBe(1)
  expect(resume).not.toHaveBeenCalled()
})

it.each(['unchanged', 'cancelled'] as const)('does not reindex or replace editors after %s', async result => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  editors.register(async () => resume)
  const refresh = vi.fn()
  await runSavedVaultOperation({ editors, refresh, run: async () => result })
  expect(refresh).not.toHaveBeenCalled()
  expect(editors.generation()).toBe(0)
  expect(resume).toHaveBeenCalledOnce()
})
