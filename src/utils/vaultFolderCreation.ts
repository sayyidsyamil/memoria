import { announceRemoteFolderChange } from '../lib/remoteFolderChanges'
import { createVaultBackend, hasRemoteVault } from '../lib/vaultBackend'
import type { FolderCreationParent } from '../types'

const PATH_SEPARATOR = /[/\\]/

/** Windows drops trailing dots and spaces, so `.. ` or `...` resolve like `..` there. */
function isDotOnlySegment(segment: string) {
  return /^[. ]*$/.test(segment) && segment.includes('.')
}

function isSinglePathSegment(name: string) {
  return name.trim().length > 0 && !isDotOnlySegment(name) && !PATH_SEPARATOR.test(name)
}

function isSafeRelativeFolderPath(path: string) {
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false
  return path.split(PATH_SEPARATOR).every((segment) => !isDotOnlySegment(segment))
}

export interface VaultFolderCreationRequest {
  name: string
  parent?: FolderCreationParent
  defaultVaultPath: string
}

function folderVaultPath({ parent, defaultVaultPath }: VaultFolderCreationRequest) {
  return parent?.rootPath?.trim() ? parent.rootPath : defaultVaultPath
}

function folderParentPath(parent: FolderCreationParent | undefined) {
  const parentPath = parent?.path && parent.path.length > 0 ? parent.path : null
  if (parentPath && !isSafeRelativeFolderPath(parentPath)) throw new Error('Invalid folder path')
  return parentPath
}

export function vaultFolderCreationArgs(request: VaultFolderCreationRequest) {
  if (!isSinglePathSegment(request.name)) throw new Error('Invalid folder name')
  return { vaultPath: folderVaultPath(request), folderName: request.name, parentPath: folderParentPath(request.parent) }
}

/** An error shown as the desktop shows a command's error: its message alone. */
class FolderCreationError extends Error {
  override toString(): string {
    return this.message
  }
}

function remoteFolderPath(folderName: string, parentPath: string | null): string {
  return parentPath ? `${parentPath}/${folderName}` : folderName
}

async function createFolder(request: VaultFolderCreationRequest): Promise<void> {
  const { vaultPath, folderName, parentPath } = vaultFolderCreationArgs(request)
  await createVaultBackend(vaultPath).files.createFolder({ parentPath, name: folderName })
  announceRemoteFolderChange({ kind: 'created', path: remoteFolderPath(folderName, parentPath) })
}

/**
 * Creates a folder in the vault through `createVaultBackend`: the native command on the
 * desktop, which re-validates the name and keeps the path inside the vault boundary; one
 * commit on a Memoria remote, whose refusals read like the desktop's; the browser mock
 * otherwise.
 */
export async function createVaultFolder(request: VaultFolderCreationRequest) {
  try {
    await createFolder(request)
  } catch (error) {
    if (hasRemoteVault() && error instanceof Error) throw new FolderCreationError(error.message)
    throw error
  }
}
