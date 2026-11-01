import type { VaultEntry } from '../types'
import { joinVaultPath, normalizeVaultRelativePath, notePathFilename } from '../utils/notePathIdentity'
import { createVaultBackend, hasRemoteVault } from './vaultBackend'
import { assertVaultWritable } from './offline/offlineMode'

/**
 * Note lifecycle on a Memoria remote (the web build with a server): the vault lives on the
 * server, so notes are created, renamed and deleted through its file API, with
 * vault-relative paths. Desktop and the mock browser build never reach this module.
 */

export { hasRemoteVault }

/** The server's file API for a change. Offline it refuses (TOL-198): nothing waits to be sent. */
function remoteFilesToChange(action: string) {
  assertVaultWritable(action)
  return createVaultBackend('').files
}

/** Where a new note goes: vault-relative on a remote, under the vault folder everywhere else. */
export function newNotePath(vaultPath: string, relativePath: string): string {
  return hasRemoteVault() ? normalizeVaultRelativePath(relativePath) : joinVaultPath(vaultPath, relativePath)
}

/**
 * Creates the note only if nothing is at `path` yet. Resolves with where its content was
 * stored: `path`, or the conflict copy the server keeps when another device created the
 * same path first. Nothing is overwritten and nothing is lost.
 */
export async function createRemoteNote(path: string, content: string): Promise<string> {
  const result = await remoteFilesToChange('creating a note').write(path, content, { baseRevision: null })
  return result.status === 'conflict' ? result.copyPath ?? path : path
}

/** The new entry, moved to where the store kept it. */
export function entryAtStoredPath(entry: VaultEntry, storedPath: string): VaultEntry {
  if (storedPath === entry.path) return entry
  return { ...entry, path: storedPath, filename: notePathFilename(storedPath) }
}

/** Resolves with the paths that were deleted. */
export async function deleteRemoteNotes(paths: string[]): Promise<string[]> {
  return remoteFilesToChange('deleting notes').delete(paths)
}

export interface RemoteAutoRename {
  newPath: string
  /** The renamed note's entry fields; the remote has no single-entry reload. */
  entry: Pick<VaultEntry, 'path' | 'filename' | 'title'>
}

/** Renames an untitled note after its first heading. Null when the name already fits. */
export async function autoRenameRemoteNote(path: string, title: string): Promise<RemoteAutoRename | null> {
  const { newPath } = await remoteFilesToChange('renaming a note').rename({ path, newTitle: title })
  if (newPath === path) return null
  return { newPath, entry: { path: newPath, filename: notePathFilename(newPath), title } }
}
