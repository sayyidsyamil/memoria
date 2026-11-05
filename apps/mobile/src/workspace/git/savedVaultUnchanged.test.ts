import { expect, it, vi } from 'vitest'
import { createWorkspaceSyncEditors } from '../workspaceSyncEditors'
import { runSavedVaultOperation } from './savedVaultOperation'

it('resumes the same editor after a commit or sync that did not change documents', async () => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  const refresh = vi.fn()
  editors.register(async () => resume, 'selected-note')
  await runSavedVaultOperation({ editors, refresh, run: async () => 'unchanged' })
  expect(resume).toHaveBeenCalledOnce()
  expect(refresh).not.toHaveBeenCalled()
  expect(editors.generation()).toBe(0)
})
