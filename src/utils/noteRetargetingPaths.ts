import type { FolderNode, VaultEntry } from '../types'

export interface RetargetFolderOption {
  path: string
  label: string
}

function normalizePathSeparators(path: string): string {
  return path.trim().replace(/\\/g, '/')
}

export function normalizeRetargetFolderPath(folderPath: string): string {
  return normalizePathSeparators(folderPath).replace(/^\/+|\/+$/g, '')
}

function normalizeBasePath(path: string): string {
  return normalizePathSeparators(path).replace(/\/+$/g, '')
}

function folderPathForRelativePath(relativePath: string): string {
  const normalizedPath = normalizePathSeparators(relativePath).replace(/^\/+/g, '')
  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  return lastSlashIndex >= 0 ? normalizedPath.slice(0, lastSlashIndex) : ''
}

/** The desktop lists notes by absolute path; a Memoria remote by vault-relative path. */
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:\/)/

/** The note's path inside the vault; its bare file name when it lives outside it. */
function relativeEntryPath(entry: VaultEntry, vaultPath: string): string {
  const normalizedVaultPath = normalizeBasePath(vaultPath)
  const entryPath = normalizePathSeparators(entry.path)
  const vaultPrefix = `${normalizedVaultPath}/`
  if (normalizedVaultPath && entryPath.startsWith(vaultPrefix)) return entryPath.slice(vaultPrefix.length)
  return ABSOLUTE_PATH.test(entryPath) ? entry.filename : entryPath
}

export function folderPathForRetargetEntry({
  entry,
  vaultPath,
}: {
  entry: VaultEntry
  vaultPath: string
}): string {
  return folderPathForRelativePath(relativeEntryPath(entry, vaultPath))
}

export function flattenRetargetFolders(nodes: FolderNode[]): RetargetFolderOption[] {
  return nodes.flatMap((node) => [
    { path: normalizeRetargetFolderPath(node.path), label: node.name },
    ...flattenRetargetFolders(node.children),
  ])
}

export function vaultRootRetargetFolder(vaultPath: string): RetargetFolderOption | null {
  const normalizedVaultPath = normalizeBasePath(vaultPath)
  const rootLabel = normalizedVaultPath.split('/').filter(Boolean).pop()
  return rootLabel ? { path: '', label: rootLabel } : null
}

export function prependVaultRootFolderDestination(
  folders: RetargetFolderOption[],
  vaultPath: string,
): RetargetFolderOption[] {
  const rootFolder = vaultRootRetargetFolder(vaultPath)
  return rootFolder ? [rootFolder, ...folders] : folders
}
