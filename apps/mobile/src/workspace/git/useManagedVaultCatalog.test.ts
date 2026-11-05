// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useManagedVaultCatalog } from './useManagedVaultCatalog'
import { managedGitSelection, readManagedGitCatalog } from './managedGitStorage'
import { initializeLocalVaultCatalog } from './managedLocalStorage'
import { preloadNativeWorkspace } from '../preloadNativeWorkspace'

vi.mock('./managedGitStorage', () => ({ managedGitSelection: vi.fn(), readManagedGitCatalog: vi.fn() }))
vi.mock('./managedLocalStorage', () => ({ initializeLocalVaultCatalog: vi.fn(), managedLocalSelection: vi.fn() }))
vi.mock('../preloadNativeWorkspace', () => ({ preloadNativeWorkspace: vi.fn() }))

const vault = { id: 'saved-vault', label: 'Saved vault', repositoryUrl: 'https://github.com/example/vault.git' }
const catalog = { vaults: [vault], activeId: vault.id, localVaults: [], activeLocalId: null }
const selection = { vaultAlias: vault.id, vaultLabel: vault.label, vaultRootUri: 'file:///saved-vault' }
const roots: ReturnType<typeof createRoot>[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.resetAllMocks()
  vi.mocked(initializeLocalVaultCatalog).mockResolvedValue(catalog)
  vi.mocked(readManagedGitCatalog).mockResolvedValue(catalog)
  vi.mocked(managedGitSelection).mockResolvedValue(selection)
  vi.mocked(preloadNativeWorkspace).mockResolvedValue(selection)
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

describe('saved vault startup recovery', () => {
  it('distinguishes an unreadable registry from an inaccessible saved vault', async () => {
    vi.mocked(initializeLocalVaultCatalog).mockRejectedValue(new Error('catalogUnreadable'))
    const current = await mountCatalog()
    expect(current().error).toBe('catalog')
    expect(current().pending).toBe(false)
    expect(managedGitSelection).not.toHaveBeenCalled()
  })

  it('retains all saved entries when the active working copy cannot be opened', async () => {
    vi.mocked(managedGitSelection).mockRejectedValue(new Error('recoveryRequired'))
    const current = await mountCatalog()
    expect(current().vaults).toEqual([vault])
    expect(current().error).toBe('selection')
    expect(current().restored).toBeNull()
    expect(current().pending).toBe(false)
  })

  it('does not label a failed native index as catalog corruption', async () => {
    vi.mocked(preloadNativeWorkspace).mockRejectedValue(new Error('invalidTextFile'))
    const current = await mountCatalog()
    expect(current().error).toBe('selection')
    expect(current().vaults).toEqual([vault])
    expect(current().restored).toBeNull()
  })

  it('retries the active vault without replacing its catalog or files', async () => {
    vi.mocked(managedGitSelection).mockRejectedValueOnce(new Error('temporarilyUnavailable'))
    const current = await mountCatalog()
    await act(async () => { await current().retry() })
    expect(current().restored).toEqual({ git: vault, selection })
    expect(current().error).toBeNull()
    expect(current().vaults).toEqual([vault])
    expect(managedGitSelection).toHaveBeenCalledTimes(2)
  })

  it('reloading the list does not dismiss a failed restoration', async () => {
    vi.mocked(managedGitSelection).mockRejectedValue(new Error('recoveryRequired'))
    const current = await mountCatalog()
    await act(async () => { await current().reload() })
    expect(current().error).toBe('selection')
    expect(current().restored).toBeNull()
  })
})

async function mountCatalog() {
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  let current: ReturnType<typeof useManagedVaultCatalog>
  function Probe() {
    const catalog = useManagedVaultCatalog()
    useEffect(() => { current = catalog }, [catalog])
    return null
  }
  await act(async () => root.render(createElement(Probe)))
  return () => current
}
