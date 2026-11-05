import { expect, it, vi } from 'vitest'
import { createWorkspaceSyncEditors } from '../workspaceSyncEditors'
import { runSavedVaultOperation } from './savedVaultOperation'

it('resumes the current editor without reloading a cancelled folder selection', async () => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  const refresh = vi.fn()
  editors.register(async () => resume, 'selected-note')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await runSavedVaultOperation({ editors, refresh, run: async () => 'cancelled' })
    expect(editors.generation()).toBe(0)
  }
  expect(refresh).not.toHaveBeenCalled()
  expect(resume).toHaveBeenCalledTimes(2)
})

it('never reuses a cancelled replacement generation or rolls back a newer replacement', () => {
  const editors = createWorkspaceSyncEditors()
  const cancelFirst = editors.beginReplacement()
  const cancelledGeneration = editors.generation()
  cancelFirst()
  editors.beginReplacement()
  const nextGeneration = editors.generation()
  expect(nextGeneration).not.toBe(cancelledGeneration)
  cancelFirst()
  expect(editors.generation()).toBe(nextGeneration)
})
