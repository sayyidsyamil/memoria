import { beforeEach, expect, it, vi } from 'vitest'
import { createWorkspaceSyncEditors } from '../workspace/workspaceSyncEditors'
import { withSavedWorkspace } from '../workspace/git/workspaceWriteQueue'
import { prepareMobileUpdateRestart } from './prepareMobileUpdateRestart'

vi.mock('../workspace/git/workspaceWriteQueue', () => ({ withSavedWorkspace: vi.fn(async (_root, run) => run()) }))
beforeEach(() => vi.clearAllMocks())

it('saves the editor and drains pending writes before allowing reload', async () => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  const save = vi.fn(async () => resume)
  editors.register(save, 'note')
  const release = await prepareMobileUpdateRestart({ editors, rootUri: 'isolated-test-vault', busy: false })
  expect(editors.isBlocked()).toBe(true)
  expect(save).toHaveBeenCalledOnce()
  expect(withSavedWorkspace).toHaveBeenCalledWith('isolated-test-vault', expect.any(Function))
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(withSavedWorkspace).mock.invocationCallOrder[0])
  release()
  expect(editors.isBlocked()).toBe(false)
  expect(resume).toHaveBeenCalledOnce()
})

it('restores editing and propagates a failed disk save instead of reloading', async () => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  editors.register(async () => resume)
  vi.mocked(withSavedWorkspace).mockRejectedValueOnce(new Error('disk full'))
  await expect(prepareMobileUpdateRestart({ editors, rootUri: 'isolated-test-vault', busy: false })).rejects.toThrow('disk full')
  expect(editors.isBlocked()).toBe(false)
  expect(resume).toHaveBeenCalledOnce()
})

it('refuses to overlap a vault operation and preserves an existing editing barrier', async () => {
  const editors = createWorkspaceSyncEditors()
  await expect(prepareMobileUpdateRestart({ editors, busy: true })).rejects.toThrow('vaultOperationInProgress')
  expect(editors.isBlocked()).toBe(false)
  editors.setBlocked(true)
  const release = await prepareMobileUpdateRestart({ editors, busy: false })
  release()
  expect(editors.isBlocked()).toBe(true)
})
