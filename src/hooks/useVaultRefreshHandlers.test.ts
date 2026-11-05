import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVaultBackend } from '../lib/vaultBackend'
import type { VaultEntry } from '../types'
import { refreshNoteWindowVaultChanges } from '../utils/noteWindowVaultRefresh'
import { refreshPulledVaultState } from '../utils/pulledVaultRefresh'
import type { Tab } from './useTabManagement'
import { useVaultRefreshHandlers } from './useVaultRefreshHandlers'

vi.mock('../lib/vaultBackend', () => ({
  createVaultBackend: vi.fn(),
}))

vi.mock('../utils/pulledVaultRefresh', () => ({
  refreshPulledVaultState: vi.fn(),
}))

vi.mock('../utils/noteWindowVaultRefresh', () => ({
  refreshNoteWindowVaultChanges: vi.fn(),
}))

const VAULT_PATH = '/vault'
const notePath = `${VAULT_PATH}/note.md`
const entry = { path: notePath, title: 'Note' } as VaultEntry

function renderHandlers(overrides: Partial<Parameters<typeof useVaultRefreshHandlers>[0]> = {}) {
  const options = {
    closeAllTabs: vi.fn(),
    handleReplaceActiveTab: vi.fn(async () => undefined),
    noteActiveTabPath: notePath,
    noteActiveTabPathRef: { current: notePath },
    noteWindowParams: null,
    refreshGitModifiedFiles: vi.fn(async () => undefined),
    resolvedPath: VAULT_PATH,
    tabs: [{ entry, content: '# Saved' }] as Tab[],
    vault: {
      addEntry: vi.fn(),
      reloadFolders: vi.fn(),
      reloadVault: vi.fn(async () => []),
      reloadViews: vi.fn(),
      unsavedPaths: new Set([notePath]),
      updateEntry: vi.fn(),
    },
    visibleEntries: [entry],
    ...overrides,
  }
  const { result } = renderHook(() => useVaultRefreshHandlers(options))
  return { options, handlers: result.current }
}

function pulledRefreshOptions() {
  return vi.mocked(refreshPulledVaultState).mock.calls[0][0]
}

function noteWindowRefreshOptions() {
  return vi.mocked(refreshNoteWindowVaultChanges).mock.calls[0][0]
}

describe('useVaultRefreshHandlers', () => {
  const mockRead = vi.fn()
  const mockReloadEntry = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(refreshPulledVaultState).mockResolvedValue([entry])
    vi.mocked(refreshNoteWindowVaultChanges).mockResolvedValue([entry])
    vi.mocked(createVaultBackend).mockReturnValue({
      files: { read: mockRead, reloadEntry: mockReloadEntry },
    } as never)
  })

  it('refreshes a pulled repository and then the git modified files', async () => {
    const { options, handlers } = renderHandlers()

    await handlers.handlePulledVaultUpdate(['note.md'], '/other-vault')

    const refresh = pulledRefreshOptions()
    expect(refresh).toMatchObject({ activeTabPath: notePath, updatedFiles: ['note.md'], vaultPath: '/other-vault' })
    expect(refresh.getActiveTabPath?.()).toBe(notePath)
    expect(refresh.hasUnsavedChanges(notePath)).toBe(true)
    expect(refresh.hasUnsavedChanges(`${VAULT_PATH}/other.md`)).toBe(false)
    expect(options.refreshGitModifiedFiles).toHaveBeenCalledTimes(1)
  })

  it('compares the active tab with the file on disk before replacing it', async () => {
    const { handlers } = renderHandlers()
    await handlers.handleFocusedVaultUpdate(['note.md'])
    const { isActiveTabContentCurrent } = pulledRefreshOptions()

    mockRead.mockResolvedValueOnce({ content: '# Saved' })
    await expect(isActiveTabContentCurrent?.(notePath)).resolves.toBe(true)
    mockRead.mockResolvedValueOnce({ content: '# Changed elsewhere' })
    await expect(isActiveTabContentCurrent?.(notePath)).resolves.toBe(false)
    await expect(isActiveTabContentCurrent?.(`${VAULT_PATH}/missing.md`)).resolves.toBe(false)
    expect(createVaultBackend).toHaveBeenCalledWith(VAULT_PATH)
  })

  it('treats an unreadable active tab file as changed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { handlers } = renderHandlers()
    await handlers.handleFocusedVaultUpdate([])
    mockRead.mockRejectedValueOnce(new Error('gone'))

    await expect(pulledRefreshOptions().isActiveTabContentCurrent?.(notePath)).resolves.toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('refreshes only the changed notes inside a note window', async () => {
    const { options, handlers } = renderHandlers({ noteWindowParams: { notePath, vaultPath: VAULT_PATH, noteTitle: 'Note' } })
    const added = { path: `${VAULT_PATH}/new.md`, title: 'New' } as VaultEntry

    await handlers.handleFocusedVaultUpdate(['note.md'])

    expect(refreshPulledVaultState).not.toHaveBeenCalled()
    const refresh = noteWindowRefreshOptions()
    expect(refresh).toMatchObject({ paths: ['note.md'], vaultPath: VAULT_PATH, currentEntries: [entry] })
    refresh.applyEntry(entry)
    refresh.applyEntry(added)
    expect(options.vault.updateEntry).toHaveBeenCalledWith(notePath, entry)
    expect(options.vault.addEntry).toHaveBeenCalledWith(added)
    mockReloadEntry.mockResolvedValueOnce(entry)
    await expect(refresh.reloadEntry(notePath)).resolves.toBe(entry)
    await refresh.refreshFullVault(['note.md'])
    expect(pulledRefreshOptions().vaultPath).toBe(VAULT_PATH)
  })

  it('refocuses the active editor through a window event', () => {
    const { handlers } = renderHandlers()
    const listener = vi.fn()
    window.addEventListener('laputa:focus-editor', listener)

    handlers.refocusActiveEditor(notePath)

    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: notePath })
    window.removeEventListener('laputa:focus-editor', listener)
  })
})
