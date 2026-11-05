import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { loadContentForOpen, clearNoteContentCache, prefetchNoteContent } from './noteContentCache'
import { loadNoteContent } from './useNoteRename'
import { runFrontmatterAndApply, type FrontmatterApplyCallbacks } from './frontmatterOps'

/**
 * Note reads and property edits pick their backend through createVaultBackend (TOL-218).
 * Native desktop QA is not possible on the Linux agent boxes, so these pin the payloads the
 * desktop sends over Tauri `invoke` as well as the browser's mock store.
 */

const { tauriInvoke } = vi.hoisted(() => ({ tauriInvoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriInvoke }))

const NOTE = '/vault/notes/backend.md'

function setTauriRuntime(value: boolean | undefined) {
  ;(globalThis as { isTauri?: boolean }).isTauri = value
}

/** The arguments as Tauri serializes them: keys left undefined are not sent. */
function sentArgs(callIndex = 0): unknown {
  return JSON.parse(JSON.stringify(tauriInvoke.mock.calls.at(callIndex)?.[1]))
}

function callbacks(): FrontmatterApplyCallbacks {
  return { updateTab: vi.fn(), updateEntry: vi.fn(), toast: vi.fn() }
}

function noteEntry(overrides: Partial<VaultEntry>): VaultEntry {
  return { path: NOTE, filename: 'backend.md', title: 'Backend', ...overrides } as VaultEntry
}

afterEach(() => {
  setTauriRuntime(undefined)
  tauriInvoke.mockReset()
  clearNoteContentCache()
  window.history.replaceState(null, '', '/')
})

describe('note content on the desktop', () => {
  beforeEach(() => {
    setTauriRuntime(true)
    tauriInvoke.mockResolvedValue('# From disk')
  })

  it('opens a note without a vault path so Rust finds its registered vault', async () => {
    prefetchNoteContent(NOTE)

    await vi.waitFor(() => expect(tauriInvoke).toHaveBeenCalledTimes(1))
    expect(tauriInvoke.mock.calls[0][0]).toBe('get_note_content')
    expect(sentArgs()).toEqual({ path: NOTE })
  })

  it('opens a workspace note inside its own vault', async () => {
    const entry = noteEntry({ workspace: { alias: 'work', path: '/work-vault' } } as Partial<VaultEntry>)

    const content = await loadContentForOpen({ entry, forceReload: true, cachedEntry: null })

    expect(content).toBe('# From disk')
    expect(sentArgs()).toEqual({ path: NOTE, vaultPath: '/work-vault' })
  })

  it('reads a note window note from the vault the window was opened for', async () => {
    window.history.replaceState(null, '', `/?window=note&path=${encodeURIComponent(NOTE)}&vault=%2Fwindow-vault`)
    prefetchNoteContent(NOTE)

    await vi.waitFor(() => expect(tauriInvoke).toHaveBeenCalledTimes(1))
    expect(sentArgs()).toEqual({ path: NOTE, vaultPath: '/window-vault' })
  })

  it('reloads a renamed note by its path alone', async () => {
    await expect(loadNoteContent({ path: NOTE })).resolves.toBe('# From disk')
    expect(tauriInvoke.mock.calls[0][0]).toBe('get_note_content')
    expect(sentArgs()).toEqual({ path: NOTE })
  })

  it('edits frontmatter through the Rust frontmatter commands', async () => {
    tauriInvoke.mockResolvedValue('---\nstatus: Done\n---\n# Backend\n')

    await runFrontmatterAndApply({ op: 'update', path: NOTE, key: 'status', value: 'Done', callbacks: callbacks() })
    await runFrontmatterAndApply({ op: 'delete', path: NOTE, key: 'status', callbacks: callbacks() })

    expect(tauriInvoke.mock.calls.map(([command]) => command)).toEqual(['update_frontmatter', 'delete_frontmatter_property'])
    expect(sentArgs(0)).toEqual({ path: NOTE, key: 'status', value: 'Done' })
    expect(sentArgs(1)).toEqual({ path: NOTE, key: 'status' })
  })
})

describe('note content in the browser without a remote', () => {
  it('edits frontmatter in the mock store and never calls Tauri', async () => {
    const path = '/vault/notes/mock-frontmatter.md'
    window.__mockContent = { ...window.__mockContent, [path]: '# Mock\n' }
    const apply = callbacks()

    const content = await runFrontmatterAndApply({ op: 'update', path, key: 'status', value: 'Active', callbacks: apply })

    expect(content).toContain('status: Active')
    expect(await loadNoteContent({ path })).toBe(content)
    expect(apply.updateTab).toHaveBeenCalledWith(path, content)
    expect(tauriInvoke).not.toHaveBeenCalled()
  })
})
