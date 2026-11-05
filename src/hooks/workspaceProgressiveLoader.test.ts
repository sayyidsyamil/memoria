import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultOption } from '../components/status-bar/types'
import type { VaultEntry } from '../types'

const loadWorkspaceEntries = vi.hoisted(() => vi.fn(async (): Promise<VaultEntry[]> => []))
vi.mock('./vaultLoaderCommands', () => ({ loadWorkspaceEntries }))

const remoteGlobals = window as Window & { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }
const ACTIVE: VaultOption = { label: 'Active', path: '/vault', mounted: true, available: true }
const OTHER: VaultOption = { label: 'Other', path: '/other', mounted: true, available: true }

async function runProgressiveLoads(): Promise<string[]> {
  const { startProgressiveWorkspaceLoads } = await import('./workspaceProgressiveLoader')
  const loadingPaths = new Set<string>()
  startProgressiveWorkspaceLoads({
    desiredWorkspacePaths: [ACTIVE.path, OTHER.path],
    isCurrentVaultPath: () => true,
    loadedPaths: new Set(),
    loadingPaths,
    setEntries: vi.fn(),
    vaultPath: ACTIVE.path,
    vaults: [ACTIVE, OTHER],
  })
  await vi.waitFor(() => expect(loadingPaths.size).toBe(0))
  return loadWorkspaceEntries.mock.calls.map(([vault]) => (vault as VaultOption).path)
}

describe('progressive workspace loads', () => {
  beforeEach(() => {
    loadWorkspaceEntries.mockClear()
  })

  afterEach(() => {
    delete remoteGlobals.MEMORIA_REMOTE_URL
    delete remoteGlobals.MEMORIA_REMOTE_TOKEN
  })

  it('loads every desired workspace, the active vault included, on demo data', async () => {
    expect(await runProgressiveLoads()).toEqual(['/vault', '/other'])
  })

  it('does not list the active vault a second time on a Memoria remote (TOL-206)', async () => {
    remoteGlobals.MEMORIA_REMOTE_URL = 'https://memoria.example'
    remoteGlobals.MEMORIA_REMOTE_TOKEN = 'token-not-a-secret'

    expect(await runProgressiveLoads()).toEqual(['/other'])
  })
})
