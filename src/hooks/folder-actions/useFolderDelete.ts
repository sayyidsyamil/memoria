import { useCallback, useState } from 'react'
import type { SidebarSelection, VaultEntry } from '../../types'
import {
  clearDeletedFolderTabs,
  type ConfirmFolderDeleteState,
  entryVaultPath,
  folderActionError,
  type FolderTab,
  folderLabel,
  invokeDeleteFolder,
  resetSelectionIfFolderDeleted,
} from './folderActionUtils'

interface UseFolderDeleteInput {
  activeTabPathRef: React.MutableRefObject<string | null>
  clearFolderRename: () => void
  closeAllTabs: () => void
  reloadFolders: () => Promise<unknown>
  reloadVault: () => Promise<VaultEntry[]>
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  setTabs: React.Dispatch<React.SetStateAction<FolderTab[]>>
  setToastMessage: (message: string | null) => void
  vaultPath: string
}

type FollowFolderDeleteInput = Omit<UseFolderDeleteInput, 'clearFolderRename' | 'setToastMessage'>

/** Closes the folder's notes and reloads, after this tab or another one deleted the folder. */
function useFollowFolderDelete(options: FollowFolderDeleteInput) {
  const { activeTabPathRef, closeAllTabs, reloadFolders, reloadVault, selection, setSelection, setTabs, vaultPath } = options

  return useCallback(async (folderPath: string) => {
    const entriesPath = entryVaultPath(vaultPath)
    clearDeletedFolderTabs({
      activeTabPathRef,
      closeAllTabs,
      folderPath,
      setTabs,
      vaultPath: entriesPath,
    })
    await reloadFolders()
    const refreshedEntries = await reloadVault()
    resetSelectionIfFolderDeleted({
      folderPath,
      refreshedEntries,
      selection,
      setSelection,
      vaultPath: entriesPath,
    })
  }, [
    activeTabPathRef,
    closeAllTabs,
    reloadFolders,
    reloadVault,
    selection,
    setSelection,
    setTabs,
    vaultPath,
  ])
}

export function useFolderDelete(options: UseFolderDeleteInput) {
  const { clearFolderRename, selection, setToastMessage, vaultPath } = options
  const followFolderDelete = useFollowFolderDelete(options)
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<ConfirmFolderDeleteState | null>(null)

  const requestDeleteFolder = useCallback(
    (folderPath: string) => {
    clearFolderRename()
    setConfirmDeleteFolder({
      path: folderPath,
      title: `Delete "${folderLabel({ folderPath })}" and everything inside it?`,
        message:
          'This permanently removes the folder, all nested folders, and every note or file inside it. This cannot be undone.',
      confirmLabel: 'Delete folder',
    })
    },
    [clearFolderRename],
  )

  const cancelDeleteFolder = useCallback(() => setConfirmDeleteFolder(null), [])

  const confirmDeleteSelectedFolder = useCallback(async () => {
    if (!confirmDeleteFolder) return

    const folderPath = confirmDeleteFolder.path
    try {
      setConfirmDeleteFolder(null)
      await invokeDeleteFolder({ vaultPath, folderPath })
      await followFolderDelete(folderPath)
      setToastMessage(`Deleted folder "${folderLabel({ folderPath })}"`)
    } catch (error) {
      setToastMessage(`Failed to delete folder: ${folderActionError(error)}`)
    }
  }, [confirmDeleteFolder, followFolderDelete, setToastMessage, vaultPath])

  const deleteSelectedFolder = useCallback(() => {
    if (selection.kind !== 'folder' || !selection.path) return
    requestDeleteFolder(selection.path)
  }, [requestDeleteFolder, selection])

  return {
    cancelDeleteFolder,
    confirmDeleteFolder,
    confirmDeleteSelectedFolder,
    deleteSelectedFolder,
    followFolderDelete,
    requestDeleteFolder,
  }
}
