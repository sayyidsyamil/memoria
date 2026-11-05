import { announceRemoteFolderChange } from '../../lib/remoteFolderChanges'
import { createVaultBackend, hasRemoteVault } from '../../lib/vaultBackend'
import type { SidebarSelection, VaultEntry } from '../../types'

export interface FolderRenameResult {
  old_path: string
  new_path: string
}

export interface FolderTab {
  entry: VaultEntry
  content: string
}

export interface ConfirmFolderDeleteState {
  path: string
  title: string
  message: string
  confirmLabel: string
}

export const DEFAULT_SELECTION: SidebarSelection = { kind: 'filter', filter: 'all' }

function trimTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}

export function folderAbsolutePath(params: { vaultPath: string; folderPath: string }): string {
  const normalizedVaultPath = trimTrailingSlash(params.vaultPath)
  const normalizedFolderPath = params.folderPath.replace(/^\/+/, '')
  return normalizedFolderPath ? `${normalizedVaultPath}/${normalizedFolderPath}` : normalizedVaultPath
}

/** Where a folder's notes live in entry paths: under the vault folder, or vault-relative on a remote (`vaultPath` ''). */
function entryFolderPath(params: { vaultPath: string; folderPath: string }): string {
  return params.vaultPath ? folderAbsolutePath(params) : params.folderPath
}

export function isWithinPrefix(params: { path: string; prefix: string }): boolean {
  return params.path === params.prefix || params.path.startsWith(`${params.prefix}/`)
}

export function replaceFolderPrefix(params: {
  path: string
  oldPrefix: string
  newPrefix: string
}): string {
  if (!isWithinPrefix({ path: params.path, prefix: params.oldPrefix })) return params.path
  return `${params.newPrefix}${params.path.slice(params.oldPrefix.length)}`
}

export function replaceRelativeFolderPrefix(params: {
  path: string
  oldPrefix: string
  newPrefix: string
}): string {
  if (!isWithinPrefix({ path: params.path, prefix: params.oldPrefix })) return params.path
  return `${params.newPrefix}${params.path.slice(params.oldPrefix.length)}`
}

export function folderLabel(params: { folderPath: string }): string {
  return params.folderPath.split('/').filter(Boolean).at(-1) ?? params.folderPath
}

export async function invokeRenameFolder(params: {
  vaultPath: string
  folderPath: string
  newName: string
}): Promise<FolderRenameResult> {
  const { vaultPath, folderPath, newName } = params
  const { oldPath, newPath } = await createVaultBackend(vaultPath).files.renameFolder({ folderPath, newName })
  return { old_path: oldPath, new_path: newPath }
}

/** Deletes a folder with everything in it; on a Memoria remote, the other tabs are told. */
export async function invokeDeleteFolder(params: { vaultPath: string; folderPath: string }): Promise<string> {
  const { vaultPath, folderPath } = params
  const deletedPath = await createVaultBackend(vaultPath).files.deleteFolder(folderPath)
  announceRemoteFolderChange({ kind: 'deleted', path: folderPath })
  return deletedPath
}

/** Where entry paths live: under the vault folder on the desktop, vault-relative (`''`) on a remote. */
export function entryVaultPath(vaultPath: string): string {
  return hasRemoteVault() ? '' : vaultPath
}

/** The remote's errors carry the desktop's wording in their message; the desktop's are shown as they are. */
export function folderActionError(error: unknown): string {
  return hasRemoteVault() && error instanceof Error ? error.message : String(error)
}

export function updateSelectionAfterFolderRename(params: {
  refreshedEntries: VaultEntry[]
  renameResult: FolderRenameResult
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  vaultPath: string
}) {
  const {
    refreshedEntries,
    renameResult,
    selection,
    setSelection,
    vaultPath,
  } = params

  if (selection.kind === 'folder') {
    if (!isWithinPrefix({ path: selection.path, prefix: renameResult.old_path })) return
    setSelection({
      kind: 'folder',
      path: replaceRelativeFolderPrefix({
        path: selection.path,
        oldPrefix: renameResult.old_path,
        newPrefix: renameResult.new_path,
      }),
    })
    return
  }

  if (selection.kind !== 'entity') return

  const oldPrefix = entryFolderPath({ vaultPath, folderPath: renameResult.old_path })
  if (!isWithinPrefix({ path: selection.entry.path, prefix: oldPrefix })) return

  const renamedPath = replaceFolderPrefix({
    path: selection.entry.path,
    oldPrefix,
    newPrefix: entryFolderPath({ vaultPath, folderPath: renameResult.new_path }),
  })
  const refreshedEntry = refreshedEntries.find((entry) => entry.path === renamedPath)
  setSelection(refreshedEntry ? { kind: 'entity', entry: refreshedEntry } : DEFAULT_SELECTION)
}

export function updateTabsAfterFolderRename(params: {
  activeTabPathRef: React.MutableRefObject<string | null>
  handleSwitchTab: (path: string) => void
  refreshedEntries: VaultEntry[]
  renameResult: FolderRenameResult
  setTabs: React.Dispatch<React.SetStateAction<FolderTab[]>>
  vaultPath: string
}) {
  const {
    activeTabPathRef,
    handleSwitchTab,
    refreshedEntries,
    renameResult,
    setTabs,
    vaultPath,
  } = params
  const oldPrefix = entryFolderPath({ vaultPath, folderPath: renameResult.old_path })
  const newPrefix = entryFolderPath({ vaultPath, folderPath: renameResult.new_path })

  setTabs((currentTabs) => currentTabs.map((tab) => {
    if (!isWithinPrefix({ path: tab.entry.path, prefix: oldPrefix })) return tab
    const nextPath = replaceFolderPrefix({ path: tab.entry.path, oldPrefix, newPrefix })
    const refreshedEntry = refreshedEntries.find((entry) => entry.path === nextPath)
    return refreshedEntry ? { ...tab, entry: refreshedEntry } : { ...tab, entry: { ...tab.entry, path: nextPath } }
  }))

  const activeTabPath = activeTabPathRef.current
  if (!activeTabPath || !isWithinPrefix({ path: activeTabPath, prefix: oldPrefix })) return
  handleSwitchTab(replaceFolderPrefix({ path: activeTabPath, oldPrefix, newPrefix }))
}

export function clearDeletedFolderTabs(params: {
  activeTabPathRef: React.MutableRefObject<string | null>
  closeAllTabs: () => void
  folderPath: string
  setTabs: React.Dispatch<React.SetStateAction<FolderTab[]>>
  vaultPath: string
}) {
  const {
    activeTabPathRef,
    closeAllTabs,
    folderPath,
    setTabs,
    vaultPath,
  } = params
  const folderPrefix = entryFolderPath({ vaultPath, folderPath })
  const hasActiveTabInFolder = !!activeTabPathRef.current
    && isWithinPrefix({ path: activeTabPathRef.current, prefix: folderPrefix })

  if (hasActiveTabInFolder) {
    closeAllTabs()
    return
  }

  setTabs((currentTabs) => currentTabs.filter((tab) => !isWithinPrefix({ path: tab.entry.path, prefix: folderPrefix })))
}

export function resetSelectionIfFolderDeleted(params: {
  folderPath: string
  refreshedEntries: VaultEntry[]
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  vaultPath: string
}) {
  const {
    folderPath,
    refreshedEntries,
    selection,
    setSelection,
    vaultPath,
  } = params

  if (selection.kind === 'folder' && isWithinPrefix({ path: selection.path, prefix: folderPath })) {
    setSelection(DEFAULT_SELECTION)
    return
  }

  if (selection.kind !== 'entity') return

  const folderPrefix = entryFolderPath({ vaultPath, folderPath })
  if (!isWithinPrefix({ path: selection.entry.path, prefix: folderPrefix })) return

  const replacement = refreshedEntries.find((entry) => entry.path === selection.entry.path)
  setSelection(replacement ? { kind: 'entity', entry: replacement } : DEFAULT_SELECTION)
}
