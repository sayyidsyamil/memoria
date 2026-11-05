import { describe, expect, it, vi } from 'vitest'
import { preloadNativeWorkspace } from './preloadNativeWorkspace'

const selection = { vaultAlias: 'local', vaultLabel: 'Vault', vaultRootUri: 'file:///vault' }
const index = { directories: ['notes'], files: [] }

describe('native workspace preload', () => {
  it('awaits the native index before exposing a restored vault', async () => {
    const readWorkspaceIndex = vi.fn(async () => JSON.stringify(index))
    expect(await preloadNativeWorkspace(selection, { readWorkspaceIndex })).toEqual({ ...selection, index })
    expect(readWorkspaceIndex).toHaveBeenCalledWith(selection.vaultRootUri)
  })

  it('keeps an existing import index without rescanning', async () => {
    const readWorkspaceIndex = vi.fn()
    const imported = { ...selection, index }
    expect(await preloadNativeWorkspace(imported, { readWorkspaceIndex })).toBe(imported)
    expect(readWorkspaceIndex).not.toHaveBeenCalled()
  })

  it('preserves compatibility with platforms without the native index bridge', async () => {
    expect(await preloadNativeWorkspace(selection, null)).toBe(selection)
    expect(await preloadNativeWorkspace(null, null)).toBeNull()
  })

  it('surfaces indexing failure instead of silently blocking on a JavaScript scan', async () => {
    const readWorkspaceIndex = vi.fn().mockRejectedValue(new Error('read failed'))
    await expect(preloadNativeWorkspace(selection, { readWorkspaceIndex })).rejects.toThrow('read failed')
  })

  it('rejects malformed native index results', async () => {
    await expect(preloadNativeWorkspace(selection, { readWorkspaceIndex: async () => '{}' }))
      .rejects.toThrow('invalidWorkspaceIndex')
  })
})
