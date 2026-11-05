import type { MobileSidebarFolderSelection } from '../components/workspace/MobileWorkspaceSidebar'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import { deleteFolderEdit } from './tabletWorkspaceFolderEditActions'
import { copyMobileFolderPath, revealMobileFolder } from './tabletWorkspaceFolderActions'
import type { TabletSidebarSelection } from './tabletWorkspaceNavigation'

type ApplyWorkspaceEdit = (edit: MobileWorkspaceEdit) => void

export function selectedFolderCommandActions({
  applyEdit,
  sidebarSelection,
  vaultRootUri,
}: {
  applyEdit: ApplyWorkspaceEdit
  sidebarSelection: TabletSidebarSelection
  vaultRootUri?: string | null
}) {
  const folder = selectedFolderSelection(sidebarSelection)

  return {
    onCopySelectedFolderPath: () => {
      if (!folder) return
      copyMobileFolderPath({ folderPath: folder.id, vaultRootUri })
    },
    onDeleteSelectedFolder: () => {
      if (!folder) return
      const edit = deleteFolderEdit(folder.id)
      if (edit) applyEdit(edit)
    },
    onRevealSelectedFolder: () => {
      if (!folder) return
      revealMobileFolder({ folderPath: folder.id, vaultRootUri })
    },
  }
}

function selectedFolderSelection(selection: TabletSidebarSelection): MobileSidebarFolderSelection | null {
  if (selection.kind !== 'folder') return null
  return { id: selection.id, name: selection.label }
}
