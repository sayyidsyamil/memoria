import { describe, expect, it, vi } from 'vitest'
import { bytesToBase64, createCommandVaultBackend, type CommandDialect } from './commandVaultBackend'
import { contentRevision } from './contentRevision'
import { VAULT_BACKEND_INTERFACE_VERSION } from './types'

const VAULT = '/vault'
const NOTE = '/vault/note.md'

type Responder = (args: Record<string, unknown>) => unknown

/** Fake command surface: records calls and answers from a per-command table. */
function harness(dialect: CommandDialect, responders: Record<string, Responder> = {}) {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = []
  const table = new Map(Object.entries(responders))
  const invoke = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args })
    const responder = table.get(command)
    if (!responder) throw new Error(`Unexpected command: ${command}`)
    return responder(args)
  })
  const backend = createCommandVaultBackend({ dialect, invoke: invoke as never, vaultPath: VAULT })
  return { backend, calls, commands: () => calls.map((call) => call.command) }
}

/** A one-file store, enough to exercise read/write/revision behaviour. */
function fileStore(initial: string | null) {
  let content = initial
  const responders: Record<string, Responder> = {
    get_note_content: () => {
      if (content === null) throw new Error('File does not exist')
      return content
    },
    save_note_content: (args) => {
      content = String(args.content)
      return null
    },
    create_note_content: (args) => {
      if (content !== null) throw new Error(`File already exists: ${String(args.path)}`)
      content = String(args.content)
      return null
    },
  }
  return { responders, current: () => content }
}

describe('createCommandVaultBackend', () => {
  it('describes a file-only backend without a collaborative channel', () => {
    const { backend } = harness('tauri')

    expect(backend.kind).toBe('tauri')
    expect(backend.interfaceVersion).toBe(VAULT_BACKEND_INTERFACE_VERSION)
    expect(backend.capabilities).toEqual({ collaboration: false, atomicRevisions: false, attachments: true })
    expect(backend.collab).toBeNull()
  })

  it('lists the vault it is bound to', async () => {
    const entries = [{ path: NOTE, title: 'Note' }]
    const { backend, calls } = harness('tauri', { list_vault: () => entries })

    await expect(backend.files.list()).resolves.toBe(entries)
    expect(calls).toEqual([{ command: 'list_vault', args: { path: VAULT } }])
  })

  it('forces a full vault rescan', async () => {
    const entries = [{ path: NOTE, title: 'Note' }]
    const { backend, calls } = harness('tauri', { reload_vault: () => entries })

    await expect(backend.files.reload()).resolves.toBe(entries)
    expect(calls).toEqual([{ command: 'reload_vault', args: { path: VAULT } }])
  })

  it('reloads a single entry', async () => {
    const entry = { path: NOTE, title: 'Note' }
    const { backend, calls } = harness('tauri', { reload_vault_entry: () => entry })

    await expect(backend.files.reloadEntry(NOTE)).resolves.toBe(entry)
    expect(calls).toEqual([{ command: 'reload_vault_entry', args: { path: NOTE, vaultPath: VAULT } }])
  })

  it('reads a file with a revision derived from its content', async () => {
    const { backend, calls } = harness('mock', { get_note_content: () => '# Note' })

    await expect(backend.files.read(NOTE)).resolves.toEqual({
      path: NOTE,
      content: '# Note',
      revision: contentRevision('# Note'),
    })
    expect(calls[0].args).toEqual({ path: NOTE, vaultPath: VAULT })
  })

  describe('write', () => {
    it('overwrites unconditionally when no base revision is given', async () => {
      const store = fileStore('old')
      const { backend, commands } = harness('tauri', store.responders)

      const result = await backend.files.write(NOTE, 'new')

      expect(result).toEqual({ status: 'written', revision: contentRevision('new') })
      expect(store.current()).toBe('new')
      expect(commands()).toEqual(['save_note_content'])
    })

    it('writes when the stored file still matches the base revision', async () => {
      const store = fileStore('old')
      const { backend } = harness('tauri', store.responders)

      const result = await backend.files.write(NOTE, 'new', { baseRevision: contentRevision('old') })

      expect(result).toEqual({ status: 'written', revision: contentRevision('new') })
      expect(store.current()).toBe('new')
    })

    it('reports a conflict instead of overwriting a file that changed underneath', async () => {
      const store = fileStore('changed elsewhere')
      const { backend, commands } = harness('tauri', store.responders)

      const result = await backend.files.write(NOTE, 'mine', { baseRevision: contentRevision('old') })

      expect(result).toEqual({
        status: 'conflict',
        current: { path: NOTE, content: 'changed elsewhere', revision: contentRevision('changed elsewhere') },
      })
      expect(store.current()).toBe('changed elsewhere')
      expect(commands()).not.toContain('save_note_content')
    })

    it('reports a conflict when the base file no longer exists', async () => {
      const store = fileStore(null)
      const { backend } = harness('tauri', store.responders)

      const result = await backend.files.write(NOTE, 'mine', { baseRevision: contentRevision('old') })

      expect(result).toEqual({ status: 'conflict', current: null })
      expect(store.current()).toBeNull()
    })

    it('creates a new file exclusively on desktop', async () => {
      const store = fileStore(null)
      const { backend, commands } = harness('tauri', store.responders)

      const result = await backend.files.write(NOTE, 'fresh', { baseRevision: null })

      expect(result).toEqual({ status: 'written', revision: contentRevision('fresh') })
      expect(commands()).toEqual(['create_note_content'])
    })

    it('reports a conflict when creating over an existing file', async () => {
      const store = fileStore('already here')
      const { backend } = harness('tauri', store.responders)

      const result = await backend.files.write(NOTE, 'fresh', { baseRevision: null })

      expect(result).toMatchObject({ status: 'conflict', current: { content: 'already here' } })
      expect(store.current()).toBe('already here')
    })

    it('rethrows create failures that are not an existing-file conflict', async () => {
      const { backend } = harness('tauri', {
        create_note_content: () => {
          throw 'Permission denied'
        },
      })

      await expect(backend.files.write(NOTE, 'fresh', { baseRevision: null })).rejects.toBe('Permission denied')
    })

    it('creates through a plain save on the mock store', async () => {
      const store = fileStore(null)
      const { backend, commands } = harness('mock', store.responders)

      const result = await backend.files.write(NOTE, 'fresh', { baseRevision: null })

      expect(result.status).toBe('written')
      expect(commands()).toEqual(['save_note_content'])
    })
  })

  describe('rename', () => {
    const renamed = () => ({ new_path: '/vault/new.md', updated_files: 2 })

    it('sends a structured title rename on desktop', async () => {
      const { backend, calls } = harness('tauri', { rename_note: renamed })

      const result = await backend.files.rename({ path: NOTE, newTitle: 'New' })

      expect(result).toEqual({ newPath: '/vault/new.md', updatedFiles: 2, failedUpdates: 0 })
      expect(calls[0].args).toEqual({ args: { vaultPath: VAULT, oldPath: NOTE, newTitle: 'New', oldTitle: null } })
    })

    it('sends a structured filename rename on desktop', async () => {
      const { backend, calls } = harness('tauri', {
        rename_note_filename: () => ({ ...renamed(), failed_updates: 1 }),
      })

      const result = await backend.files.rename({ path: NOTE, newFilenameStem: 'new' })

      expect(result.failedUpdates).toBe(1)
      expect(calls[0].args).toEqual({ args: { vaultPath: VAULT, oldPath: NOTE, newFilenameStem: 'new' } })
    })

    it('uses the snake_case argument shape of the mock handlers', async () => {
      const { backend, calls } = harness('mock', { rename_note: renamed, rename_note_filename: renamed })

      await backend.files.rename({ path: NOTE, newTitle: 'New', oldTitle: 'Old' })
      await backend.files.rename({ path: NOTE, newFilenameStem: 'new' })

      expect(calls.map((call) => call.args)).toEqual([
        { vault_path: VAULT, old_path: NOTE, new_title: 'New', old_title: 'Old' },
        { vault_path: VAULT, old_path: NOTE, new_filename_stem: 'new' },
      ])
    })
  })

  describe('moves and folder renames (TOL-227)', () => {
    it('moves a note into a folder in each dialect', async () => {
      const moved = () => ({ new_path: '/vault/archive/note.md', updated_files: 1 })
      const tauri = harness('tauri', { move_note_to_folder: moved })
      const mock = harness('mock', { move_note_to_folder: moved })

      const result = await tauri.backend.files.rename({ path: NOTE, folderPath: 'archive' })
      await mock.backend.files.rename({ path: NOTE, folderPath: 'archive' })

      expect(tauri.calls[0].args).toEqual({ args: { vaultPath: VAULT, oldPath: NOTE, folderPath: 'archive' } })
      expect(mock.calls[0].args).toEqual({ vault_path: VAULT, old_path: NOTE, folder_path: 'archive' })
      expect(result).toEqual({ newPath: '/vault/archive/note.md', updatedFiles: 1, failedUpdates: 0 })
    })

    it.each(['tauri', 'mock'] as const)('renames a folder through rename_vault_folder in the %s dialect', async (dialect) => {
      const { backend, calls } = harness(dialect, { rename_vault_folder: () => ({ old_path: 'projects', new_path: 'work' }) })

      const result = await backend.files.renameFolder({ folderPath: 'projects', newName: 'work' })

      expect(calls).toEqual([{ command: 'rename_vault_folder', args: { vaultPath: VAULT, folderPath: 'projects', newName: 'work' } }])
      expect(result).toEqual({ oldPath: 'projects', newPath: 'work', updatedFiles: 0 })
    })

    it.each(['tauri', 'mock'] as const)('creates a folder through create_vault_folder in the %s dialect', async (dialect) => {
      const { backend, calls } = harness(dialect, { create_vault_folder: () => 'Drafts' })

      await backend.files.createFolder({ parentPath: 'projects', name: 'Drafts' })

      expect(calls).toEqual([{ command: 'create_vault_folder', args: { vaultPath: VAULT, folderName: 'Drafts', parentPath: 'projects' } }])
    })

    it.each(['tauri', 'mock'] as const)('deletes a folder through delete_vault_folder in the %s dialect', async (dialect) => {
      const { backend, calls } = harness(dialect, { delete_vault_folder: () => 'projects' })

      await expect(backend.files.deleteFolder('projects')).resolves.toBe('projects')

      expect(calls).toEqual([{ command: 'delete_vault_folder', args: { vaultPath: VAULT, folderPath: 'projects' } }])
    })
  })

  it('deletes through the dialect-specific batch command', async () => {
    const echo: Responder = (args) => args.paths
    const desktop = harness('tauri', { batch_delete_notes_async: echo })
    const browser = harness('mock', { batch_delete_notes: echo })

    await expect(desktop.backend.files.delete([NOTE])).resolves.toEqual([NOTE])
    await expect(browser.backend.files.delete([NOTE])).resolves.toEqual([NOTE])
    expect(desktop.calls[0].args).toEqual({ paths: [NOTE], vaultPath: VAULT })
  })

  it('searches the bound vault and normalises the response', async () => {
    const { backend, calls } = harness('tauri', {
      search_vault: () => ({
        results: [{ title: 'Note', path: NOTE, snippet: 'hit', score: 0.5, note_type: 'Project' }],
        elapsed_ms: 7,
      }),
    })

    const response = await backend.files.search('hit', { limit: 5, excludeFrontmatter: true })

    expect(response).toEqual({
      results: [{ title: 'Note', path: NOTE, snippet: 'hit', score: 0.5, noteType: 'Project' }],
      elapsedMs: 7,
    })
    expect(calls[0].args).toEqual({
      vaultPath: VAULT,
      query: 'hit',
      mode: 'keyword',
      limit: 5,
      excludeFrontmatter: true,
    })
  })

  it('uploads attachments as base64 in each dialect', async () => {
    const stored: Responder = (args) => `/vault/attachments/${String(args.filename)}`
    const bytes = new Uint8Array([104, 105])
    const desktop = harness('tauri', { save_image: stored })
    const browser = harness('mock', { save_image: stored })

    await expect(desktop.backend.files.saveAttachment({ filename: 'a.png', bytes })).resolves.toEqual({
      path: '/vault/attachments/a.png',
    })
    await browser.backend.files.saveAttachment({ filename: 'a.png', bytes })

    expect(desktop.calls[0].args).toEqual({ vaultPath: VAULT, filename: 'a.png', data: 'aGk=' })
    expect(browser.calls[0].args).toEqual({ vault_path: VAULT, filename: 'a.png', data: 'aGk=' })
  })
})

describe('bytesToBase64', () => {
  it('round-trips payloads larger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 251)

    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (char) => char.charCodeAt(0))

    expect(decoded).toEqual(bytes)
  })

  it('encodes an empty payload', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })
})

describe('snapshot', () => {
  it('is available for Tauri backends', async () => {
    const entries = [{ path: NOTE, title: 'Note' }]
    const { backend, calls } = harness('tauri', { read_vault_snapshot: () => entries })

    expect(backend.snapshot).toBeDefined()
    await expect(backend.snapshot?.()).resolves.toBe(entries)
    expect(calls).toEqual([{ command: 'read_vault_snapshot', args: { path: VAULT } }])
  })

  it('is unavailable for mock backends', () => {
    const { backend } = harness('mock')

    expect(backend.snapshot).toBeUndefined()
  })
})

describe('chrome operations', () => {
  it('lists folders from the vault', async () => {
    const folders = [{ name: 'Inbox', path: 'Inbox', children: [] }]
    const { backend, calls } = harness('tauri', { list_vault_folders: () => folders })

    await expect(backend.chrome.listFolders()).resolves.toBe(folders)
    expect(calls).toEqual([{ command: 'list_vault_folders', args: { path: VAULT } }])
  })

  it('lists views from the vault', async () => {
    const views = [{ filename: 'active.yml', definition: { name: 'Active', filters: {} } }]
    const { backend, calls } = harness('tauri', { list_views: () => views })

    await expect(backend.chrome.listViews()).resolves.toBe(views)
    expect(calls).toEqual([{ command: 'list_views', args: { vaultPath: VAULT } }])
  })
})
