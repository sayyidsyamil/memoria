import type { MobileWorkspaceAction } from '../components/workspace/MobileWorkspaceActionSheet'
import type { MobileSidebarFolderSelection } from '../components/workspace/MobileWorkspaceSidebar'
import { writeMobileClipboardText } from '../workspace/mobileClipboard'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import { mobileFolderName, mobileFolderParentPath } from '../workspace/mobileWorkspaceFolders'
import { buildMobileFilePathForRelativePath } from '../workspace/mobileNoteFilePath'
import { revealMobileFolderPath } from '../workspace/mobileNoteFileReveal'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'
import type { TabletSidebarSelection } from './tabletWorkspaceNavigation'
import { createWorkspaceNoteInFolderEdit } from './tabletWorkspaceCreateActions'
import {
  createFolderEditFromForm,
  deleteFolderEdit,
  renameFolderEditFromForm,
} from './tabletWorkspaceFolderEditActions'

type ApplyWorkspaceEdit = (edit: MobileWorkspaceEdit) => void
type CloseWorkspaceAction = () => void
type ReadOnlyFormUpdater = <Key extends keyof TabletReadOnlyForm>(key: Key, value: TabletReadOnlyForm[Key]) => void
type SetOpenAction = (action: MobileWorkspaceAction | null) => void
type SelectFolder = (selection: MobileSidebarFolderSelection) => void
type ReadOnlyFormField = {
  [Key in keyof TabletReadOnlyForm]: { key: Key; value: TabletReadOnlyForm[Key] }
}[keyof TabletReadOnlyForm]

export function folderWorkspaceActions({
  applyEdit,
  closeAction,
  readOnlyForm,
  selectFolder,
  setOpenAction,
  updateReadOnlyForm,
  vaultRootUri,
}: {
  applyEdit: ApplyWorkspaceEdit
  closeAction: CloseWorkspaceAction
  readOnlyForm: TabletReadOnlyForm
  selectFolder: SelectFolder
  setOpenAction: SetOpenAction
  updateReadOnlyForm: ReadOnlyFormUpdater
  vaultRootUri?: string | null
}) {
  return {
    onCopyFolderPath: () => copyMobileFolderPath({
      folderPath: readOnlyForm.editingFolderPath,
      onCopied: closeAction,
      vaultRootUri,
    }),
    onRevealFolder: () => revealMobileFolder({
      folderPath: readOnlyForm.editingFolderPath,
      onRevealed: closeAction,
      vaultRootUri,
    }),
    onCreateFolder: () => commitFolderEdit({
      applyEdit,
      closeAction,
      edit: createFolderEditFromForm(readOnlyForm),
    }),
    onDeleteFolder: () => deleteFolder({
      applyEdit,
      closeAction,
      folderPath: readOnlyForm.editingFolderPath,
    }),
    onFolderNameChange: (value: string) => updateReadOnlyForm('folderName', value),
    onOpenCreateChildFolder: () => openCreateFolderAction({
      parentPath: readOnlyForm.editingFolderPath,
      setOpenAction,
      updateReadOnlyForm,
    }),
    onOpenCreateNoteInFolder: () => openCreateNoteInFolder({
      applyEdit,
      closeAction,
      folderPath: readOnlyForm.editingFolderPath,
      folderName: readOnlyForm.folderName,
      selectFolder,
    }),
    onRenameFolder: () => commitFolderEdit({
      applyEdit,
      closeAction,
      edit: renameFolderEditFromForm(readOnlyForm),
    }),
  }
}

export function createFolderFields(parentPath: string): ReadOnlyFormField[] {
  return [
    { key: 'editingFolderPath', value: '' },
    { key: 'folderName', value: '' },
    { key: 'folderParentPath', value: parentPath },
  ]
}

export function folderActionFields(selection: MobileSidebarFolderSelection): ReadOnlyFormField[] {
  return [
    { key: 'editingFolderPath', value: selection.id },
    { key: 'folderName', value: selection.name },
    { key: 'folderParentPath', value: mobileFolderParentPath(selection.id) },
  ]
}

export function folderParentPathForSelection(selection: TabletSidebarSelection): string {
  return selection.kind === 'folder' ? selection.id : ''
}

function openCreateFolderAction({
  parentPath,
  setOpenAction,
  updateReadOnlyForm,
}: {
  parentPath: string
  setOpenAction: SetOpenAction
  updateReadOnlyForm: ReadOnlyFormUpdater
}) {
  for (const field of createFolderFields(parentPath)) {
    updateReadOnlyForm(field.key, field.value)
  }
  setOpenAction('createFolder')
}

function openCreateNoteInFolder({
  applyEdit,
  closeAction,
  folderPath,
  folderName,
  selectFolder,
}: {
  applyEdit: ApplyWorkspaceEdit
  closeAction: CloseWorkspaceAction
  folderPath: string
  folderName: string
  selectFolder: SelectFolder
}) {
  if (!folderPath) return
  selectFolder({ id: folderPath, name: folderName || mobileFolderName(folderPath) })
  applyEdit(createWorkspaceNoteInFolderEdit(folderPath))
  closeAction()
}

export function copyMobileFolderPath({
  folderPath,
  onCopied,
  vaultRootUri,
}: {
  folderPath: string
  onCopied?: () => void
  vaultRootUri?: string | null
}) {
  const result = buildMobileFilePathForRelativePath({ path: folderPath, vaultRootUri })
  if (!result.ok) return

  onCopied?.()
  void writeMobileClipboardText(result.path).catch((error) => {
    console.warn('[mobile-folder-path] Failed to copy folder path:', error)
  })
}

export function revealMobileFolder({
  folderPath,
  onRevealed,
  vaultRootUri,
}: {
  folderPath: string
  onRevealed?: () => void
  vaultRootUri?: string | null
}) {
  void revealMobileFolderPath({ folderPath, vaultRootUri }).then((result) => {
    if (result.ok) onRevealed?.()
  }).catch((error) => {
    console.warn('[mobile-folder-reveal] Failed to reveal folder:', error)
  })
}

function commitFolderEdit({
  applyEdit,
  closeAction,
  edit,
}: {
  applyEdit: ApplyWorkspaceEdit
  closeAction: CloseWorkspaceAction
  edit: MobileWorkspaceEdit
}) {
  applyEdit(edit)
  closeAction()
}

function deleteFolder({
  applyEdit,
  closeAction,
  folderPath,
}: {
  applyEdit: ApplyWorkspaceEdit
  closeAction: CloseWorkspaceAction
  folderPath: string
}) {
  const edit = deleteFolderEdit(folderPath)
  if (!edit) return

  commitFolderEdit({ applyEdit, closeAction, edit })
}
