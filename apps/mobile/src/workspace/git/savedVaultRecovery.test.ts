import { beforeEach, expect, it, vi } from 'vitest'
import { createWorkspaceSyncEditors } from '../workspaceSyncEditors'
import { recoverNativeWorkspaceText } from '../workspaceTextRecovery'
import { runSavedVaultOperation } from './savedVaultOperation'

vi.mock('../workspaceTextRecovery', () => ({ recoverNativeWorkspaceText: vi.fn() }))
beforeEach(() => { vi.mocked(recoverNativeWorkspaceText).mockReset().mockReturnValue(false) })

it.each(['unchanged', 'cancelled'] as const)('awaits fresh editors after native recovery even when the task is %s', async result => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  editors.register(async () => resume, 'notes/selected.md')
  vi.mocked(recoverNativeWorkspaceText).mockReturnValueOnce(true)
  let finish = () => {}
  const prepared = new Promise<void>(resolve => { finish = resolve })
  const refresh = vi.fn(async () => prepared)
  const run = vi.fn(async () => result)
  const operation = runSavedVaultOperation({ editors, rootUri: 'file:///recovered-operation', run, refresh })
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
  expect(refresh).toHaveBeenCalledExactlyOnceWith('notes/selected.md')
  expect(editors.generation()).toBe(1)
  expect(resume).not.toHaveBeenCalled()
  finish()
  await operation
  expect(resume).not.toHaveBeenCalled()

  const current = createWorkspaceSyncEditors()
  current.register(async () => resume, 'notes/selected.md')
  await runSavedVaultOperation({ editors: current, rootUri: 'file:///recovered-operation', run, refresh })
  expect(refresh).toHaveBeenCalledOnce()
  expect(current.generation()).toBe(0)
  expect(resume).toHaveBeenCalledOnce()
})

it('never revives the recovered editor when fresh indexing fails', async () => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  editors.register(async () => resume)
  vi.mocked(recoverNativeWorkspaceText).mockReturnValueOnce(true)
  const refresh = vi.fn(async () => { throw new Error('index failed') })
  await expect(runSavedVaultOperation({
    editors, rootUri: 'file:///failed-recovery-refresh', refresh, run: async () => 'unchanged',
  })).rejects.toThrow('index failed')
  expect(editors.generation()).toBe(1)
  expect(resume).not.toHaveBeenCalled()
})

it('resumes the original editor and does not start the task if native recovery fails', async () => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  editors.register(async () => resume)
  vi.mocked(recoverNativeWorkspaceText).mockImplementationOnce(() => { throw new Error('externalChange') })
  const refresh = vi.fn()
  const run = vi.fn(async () => 'unchanged' as const)
  await expect(runSavedVaultOperation({ editors, rootUri: 'file:///conflicted-recovery', refresh, run }))
    .rejects.toThrow('externalChange')
  expect(run).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  expect(editors.generation()).toBe(0)
  expect(resume).toHaveBeenCalledOnce()
})
