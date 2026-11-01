import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeDeleteFolder, invokeRenameFolder } from './folder-actions/folderActionUtils'
import { performFilenameRename, performMoveNoteToFolder, performRename } from './useNoteRename'

/**
 * Title and filename renames pick their backend through createVaultBackend (TOL-22). Native
 * desktop QA is not possible on the Linux agent boxes, so these pin the Tauri payloads, which
 * must stay what the desktop sent before, and the request the web sends to a Memoria remote.
 */

const { tauriInvoke } = vi.hoisted(() => ({ tauriInvoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriInvoke }))

type RemoteWindow = { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

function setTauriRuntime(value: boolean | undefined) {
  ;(globalThis as { isTauri?: boolean }).isTauri = value
}

/** The arguments as Tauri serializes them. */
function sentArgs(callIndex = 0): unknown {
  return JSON.parse(JSON.stringify(tauriInvoke.mock.calls.at(callIndex)?.[1]))
}

afterEach(() => {
  setTauriRuntime(undefined)
  tauriInvoke.mockReset()
  delete (window as RemoteWindow).MEMORIA_REMOTE_URL
  delete (window as RemoteWindow).MEMORIA_REMOTE_TOKEN
  vi.unstubAllGlobals()
})

describe('renames on the desktop', () => {
  it('sends rename_note with the vault, the old path and both titles', async () => {
    setTauriRuntime(true)
    tauriInvoke.mockResolvedValue({ new_path: '/vault/sprint.md', updated_files: 2, failed_updates: 1 })

    const result = await performRename({ path: '/vault/weekly.md', newTitle: 'Sprint', vaultPath: '/vault', oldTitle: 'Weekly' })

    expect(tauriInvoke.mock.calls[0][0]).toBe('rename_note')
    expect(sentArgs()).toEqual({ args: { vaultPath: '/vault', oldPath: '/vault/weekly.md', newTitle: 'Sprint', oldTitle: 'Weekly' } })
    expect(result).toEqual({ new_path: '/vault/sprint.md', updated_files: 2, failed_updates: 1 })
  })

  it('sends a null old title when none is known, and rename_note_filename for a stem', async () => {
    setTauriRuntime(true)
    tauriInvoke.mockResolvedValue({ new_path: '/vault/x.md', updated_files: 0 })

    await performRename({ path: '/vault/weekly.md', newTitle: 'Sprint', vaultPath: '/vault' })
    const result = await performFilenameRename({ path: '/vault/weekly.md', newFilenameStem: 'x', vaultPath: '/vault' })

    expect(sentArgs(0)).toEqual({ args: { vaultPath: '/vault', oldPath: '/vault/weekly.md', newTitle: 'Sprint', oldTitle: null } })
    expect(tauriInvoke.mock.calls[1][0]).toBe('rename_note_filename')
    expect(sentArgs(1)).toEqual({ args: { vaultPath: '/vault', oldPath: '/vault/weekly.md', newFilenameStem: 'x' } })
    expect(result).toEqual({ new_path: '/vault/x.md', updated_files: 0, failed_updates: 0 })
  })
})

describe('moves and folder renames on the desktop (TOL-227)', () => {
  it('sends move_note_to_folder with the vault, the old path and the folder', async () => {
    setTauriRuntime(true)
    tauriInvoke.mockResolvedValue({ new_path: '/vault/archive/weekly.md', updated_files: 1 })

    const result = await performMoveNoteToFolder({ path: '/vault/weekly.md', folderPath: 'archive', vaultPath: '/vault' })

    expect(tauriInvoke.mock.calls[0][0]).toBe('move_note_to_folder')
    expect(sentArgs()).toEqual({ args: { vaultPath: '/vault', oldPath: '/vault/weekly.md', folderPath: 'archive' } })
    expect(result).toEqual({ new_path: '/vault/archive/weekly.md', updated_files: 1, failed_updates: 0 })
  })

  it('sends rename_vault_folder with the vault, the folder and the new name', async () => {
    setTauriRuntime(true)
    tauriInvoke.mockResolvedValue({ old_path: 'projects', new_path: 'work' })

    const result = await invokeRenameFolder({ vaultPath: '/vault', folderPath: 'projects', newName: 'work' })

    expect(tauriInvoke.mock.calls[0][0]).toBe('rename_vault_folder')
    expect(sentArgs()).toEqual({ vaultPath: '/vault', folderPath: 'projects', newName: 'work' })
    expect(result).toEqual({ old_path: 'projects', new_path: 'work' })
  })

  it('sends delete_vault_folder with the vault and the folder (TOL-233)', async () => {
    setTauriRuntime(true)
    tauriInvoke.mockResolvedValue('projects')

    await expect(invokeDeleteFolder({ vaultPath: '/vault', folderPath: 'projects' })).resolves.toBe('projects')

    expect(tauriInvoke.mock.calls[0][0]).toBe('delete_vault_folder')
    expect(sentArgs()).toEqual({ vaultPath: '/vault', folderPath: 'projects' })
  })
})

describe('moves and folder renames on the web with a Memoria remote (TOL-227)', () => {
  function serveRemote(answer: unknown) {
    Object.assign(window as RemoteWindow, { MEMORIA_REMOTE_URL: 'https://remote.test', MEMORIA_REMOTE_TOKEN: 'web-token-0123456789' })
    const fetchMock = vi.fn(async () => Response.json(answer))
    vi.stubGlobal('fetch', fetchMock)
    return () => {
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      return { url, body: JSON.parse(String(init.body)) }
    }
  }

  it('moves a note through the server rename with the links rewritten', async () => {
    const sent = serveRemote({ from: 'weekly.md', path: 'archive/weekly.md', rewritten: ['index.md'] })

    const result = await performMoveNoteToFolder({ path: 'weekly.md', folderPath: 'archive', vaultPath: '' })

    expect(sent()).toEqual({ url: 'https://remote.test/v1/rename', body: { from: 'weekly.md', to: 'archive/weekly.md', rewriteLinks: true } })
    expect(result).toEqual({ new_path: 'archive/weekly.md', updated_files: 1, failed_updates: 0 })
    expect(tauriInvoke).not.toHaveBeenCalled()
  })

  it('renames a folder through the server folder rename', async () => {
    const sent = serveRemote({ from: 'projects', path: 'work', moved: [], rewritten: [] })

    const result = await invokeRenameFolder({ vaultPath: '', folderPath: 'projects', newName: 'work' })

    expect(sent()).toEqual({ url: 'https://remote.test/v1/folders/rename', body: { from: 'projects', to: 'work', rewriteLinks: true } })
    expect(result).toEqual({ old_path: 'projects', new_path: 'work' })
  })
})

describe('renames on the web with a Memoria remote', () => {
  it('asks the server to rewrite the links and reports the notes it rewrote', async () => {
    Object.assign(window as RemoteWindow, { MEMORIA_REMOTE_URL: 'https://remote.test', MEMORIA_REMOTE_TOKEN: 'web-token-0123456789' })
    const fetchMock = vi.fn(async () => Response.json({ from: 'welcome.md', path: 'hello.md', rewritten: ['projects/alpha.md'] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await performFilenameRename({ path: 'welcome.md', newFilenameStem: 'hello', vaultPath: '' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://remote.test/v1/rename')
    expect(JSON.parse(String(init.body))).toEqual({ from: 'welcome.md', to: 'hello.md', rewriteLinks: true })
    expect(result).toEqual({ new_path: 'hello.md', updated_files: 1, failed_updates: 0 })
    expect(tauriInvoke).not.toHaveBeenCalled()
  })
})
