import type { FolderNode, SearchResult, VaultEntry, ViewFile } from '../../types'
import { contentRevision } from './contentRevision'
import {
  VAULT_BACKEND_INTERFACE_VERSION,
  type VaultAttachment,
  type VaultAttachmentUpload,
  type VaultBackend,
  type VaultBackendKind,
  type VaultChromeOps,
  type VaultFile,
  type VaultFileOps,
  type VaultFolderCreateRequest,
  type VaultFolderRenameRequest,
  type VaultFolderRenameResult,
  type VaultRenameRequest,
  type VaultRenameResult,
  type VaultRevision,
  type VaultSearchResponse,
  type VaultWriteResult,
} from './types'

/**
 * VaultBackend over the existing command surface: the same adapter serves the
 * Tauri `invoke` and the browser `mockInvoke`, which already share command
 * names. The two differ only in argument casing and a few command aliases,
 * captured by `CommandDialect`. Neither store versions files, so revisions are
 * content hashes and the base-revision check is compare-then-write in the
 * client (`atomicRevisions: false`).
 */

export type CommandInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type CommandDialect = Extract<VaultBackendKind, 'tauri' | 'mock'>

export interface CommandVaultBackendOptions {
  dialect: CommandDialect
  invoke: CommandInvoker
  /** Without one, desktop commands find the vault from the note's absolute path. */
  vaultPath?: string
}

interface NoteDraft {
  path: string
  content: string
}

interface RawRenameResult {
  new_path: string
  updated_files: number
  failed_updates?: number
}

interface RawSearchResult {
  title: string
  path: string
  snippet: string
  score: number
  note_type: string | null
}

interface RawSearchResponse {
  results: RawSearchResult[]
  elapsed_ms: number
}

const FILE_EXISTS_ERROR = /already exists/i
const BASE64_CHUNK_SIZE = 0x8000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toVaultFile({ path, content }: NoteDraft): VaultFile {
  return { path, content, revision: contentRevision(content) }
}

function written({ content }: NoteDraft): VaultWriteResult {
  return { status: 'written', revision: contentRevision(content) }
}

function toSearchResult(raw: RawSearchResult): SearchResult {
  return { title: raw.title, path: raw.path, snippet: raw.snippet, score: raw.score, noteType: raw.note_type }
}

function toRenameResult(raw: RawRenameResult): VaultRenameResult {
  return { newPath: raw.new_path, updatedFiles: raw.updated_files, failedUpdates: raw.failed_updates ?? 0 }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE))
  }
  return btoa(binary)
}

type RenameCommand = 'rename_note' | 'rename_note_filename' | 'move_note_to_folder'

function renameCommand(request: VaultRenameRequest): RenameCommand {
  if ('folderPath' in request) return 'move_note_to_folder'
  return 'newTitle' in request ? 'rename_note' : 'rename_note_filename'
}

type RenameArgsBuilder = (request: VaultRenameRequest, options: CommandVaultBackendOptions) => Record<string, unknown>

function tauriRenameTarget(request: VaultRenameRequest): Record<string, unknown> {
  if ('folderPath' in request) return { folderPath: request.folderPath }
  return 'newTitle' in request
    ? { newTitle: request.newTitle, oldTitle: request.oldTitle ?? null }
    : { newFilenameStem: request.newFilenameStem }
}

function mockRenameTarget(request: VaultRenameRequest): Record<string, unknown> {
  if ('folderPath' in request) return { folder_path: request.folderPath }
  return 'newTitle' in request
    ? { new_title: request.newTitle, old_title: request.oldTitle ?? null }
    : { new_filename_stem: request.newFilenameStem }
}

const tauriRenameArgs: RenameArgsBuilder = (request, { vaultPath }) =>
  ({ args: { vaultPath, oldPath: request.path, ...tauriRenameTarget(request) } })

const mockRenameArgs: RenameArgsBuilder = (request, { vaultPath }) =>
  ({ vault_path: vaultPath, old_path: request.path, ...mockRenameTarget(request) })

interface RawFolderRenameResult {
  old_path: string
  new_path: string
}

/** Both dialects take the same arguments; the desktop rewrites no links on a folder rename. */
async function renameFolderCommand(
  { invoke, vaultPath }: CommandVaultBackendOptions,
  { folderPath, newName }: VaultFolderRenameRequest,
): Promise<VaultFolderRenameResult> {
  const raw = await invoke<RawFolderRenameResult>('rename_vault_folder', { vaultPath, folderPath, newName })
  return { oldPath: raw.old_path, newPath: raw.new_path, updatedFiles: 0 }
}

/** Both dialects take the same arguments for creating and deleting a folder too. */
async function createFolderCommand(
  { invoke, vaultPath }: CommandVaultBackendOptions,
  { parentPath, name }: VaultFolderCreateRequest,
): Promise<void> {
  await invoke<string>('create_vault_folder', { vaultPath, folderName: name, parentPath })
}

function createFileOps(options: CommandVaultBackendOptions): VaultFileOps {
  const { dialect, invoke, vaultPath } = options
  const isTauri = dialect === 'tauri'

  const read = async (path: string): Promise<VaultFile> =>
    toVaultFile({ path, content: await invoke<string>('get_note_content', { path, vaultPath }) })

  const readOrNull = (path: string): Promise<VaultFile | null> => read(path).catch(() => null)

  const save = async (draft: NoteDraft): Promise<VaultWriteResult> => {
    await invoke<void>('save_note_content', { ...draft, vaultPath })
    return written(draft)
  }

  // The mock store has no create-exclusive command; the shell saves new notes directly there too.
  const create = async (draft: NoteDraft): Promise<VaultWriteResult> => {
    if (!isTauri) return save(draft)
    try {
      await invoke<void>('create_note_content', { ...draft, vaultPath })
      return written(draft)
    } catch (error) {
      if (!FILE_EXISTS_ERROR.test(errorMessage(error))) throw error
      return { status: 'conflict', current: await readOrNull(draft.path) }
    }
  }

  const saveIfUnchanged = async (draft: NoteDraft, baseRevision: VaultRevision): Promise<VaultWriteResult> => {
    const current = await readOrNull(draft.path)
    if (current?.revision !== baseRevision) return { status: 'conflict', current }
    return save(draft)
  }

  const write: VaultFileOps['write'] = (path, content, { baseRevision } = {}) => {
    const draft = { path, content }
    if (baseRevision === undefined) return save(draft)
    if (baseRevision === null) return create(draft)
    return saveIfUnchanged(draft, baseRevision)
  }

  const rename = async (request: VaultRenameRequest): Promise<VaultRenameResult> => {
    const args = (isTauri ? tauriRenameArgs : mockRenameArgs)(request, options)
    return toRenameResult(await invoke<RawRenameResult>(renameCommand(request), args))
  }

  const search: VaultFileOps['search'] = async (query, searchOptions = {}): Promise<VaultSearchResponse> => {
    const args = { vaultPath, query, mode: 'keyword', ...searchOptions }
    const raw = await invoke<RawSearchResponse>('search_vault', args)
    return { results: raw.results.map(toSearchResult), elapsedMs: raw.elapsed_ms }
  }

  const saveAttachment = async ({ filename, bytes }: VaultAttachmentUpload): Promise<VaultAttachment> => {
    const data = bytesToBase64(bytes)
    const args = isTauri ? { vaultPath, filename, data } : { vault_path: vaultPath, filename, data }
    return { path: await invoke<string>('save_image', args) }
  }

  return {
    list: () => invoke<VaultEntry[]>('list_vault', { path: vaultPath }),
    reload: () => invoke<VaultEntry[]>('reload_vault', { path: vaultPath }),
    reloadEntry: (path) => invoke<VaultEntry>('reload_vault_entry', { path, vaultPath }),
    read,
    write,
    rename,
    renameFolder: (request) => renameFolderCommand(options, request),
    createFolder: (request) => createFolderCommand(options, request),
    deleteFolder: (folderPath) => invoke<string>('delete_vault_folder', { vaultPath, folderPath }),
    delete: (paths) => invoke<string[]>(isTauri ? 'batch_delete_notes_async' : 'batch_delete_notes', { paths, vaultPath }),
    search,
    saveAttachment,
  }
}

function createChromeOps(options: CommandVaultBackendOptions): VaultChromeOps {
  const { invoke, vaultPath } = options

  return {
    listFolders: () => invoke<FolderNode[]>('list_vault_folders', { path: vaultPath }),
    listViews: () => invoke<ViewFile[]>('list_views', { vaultPath }),
  }
}

export function createCommandVaultBackend(options: CommandVaultBackendOptions): VaultBackend {
  const { dialect, invoke, vaultPath } = options
  const isTauri = dialect === 'tauri'
  
  return {
    kind: options.dialect,
    interfaceVersion: VAULT_BACKEND_INTERFACE_VERSION,
    capabilities: { collaboration: false, atomicRevisions: false, attachments: true },
    files: createFileOps(options),
    chrome: createChromeOps(options),
    collab: null,
    snapshot: isTauri
      ? () => invoke<VaultEntry[] | null>('read_vault_snapshot', { path: vaultPath })
      : undefined,
  }
}
