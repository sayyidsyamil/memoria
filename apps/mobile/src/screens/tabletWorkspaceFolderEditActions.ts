import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'

type CreateFolderEdit = Extract<MobileWorkspaceEdit, { type: 'createFolder' }>
type DeleteFolderEdit = Extract<MobileWorkspaceEdit, { type: 'deleteFolder' }>
type RenameFolderEdit = Extract<MobileWorkspaceEdit, { type: 'renameFolder' }>
type FolderEditForm = Pick<TabletReadOnlyForm, 'editingFolderPath' | 'folderName' | 'folderParentPath'>

export function createFolderEditFromForm(form: FolderEditForm): CreateFolderEdit {
  return {
    name: form.folderName,
    parentPath: form.folderParentPath,
    type: 'createFolder',
  }
}

export function renameFolderEditFromForm(form: FolderEditForm): RenameFolderEdit {
  return {
    folderPath: form.editingFolderPath,
    name: form.folderName,
    type: 'renameFolder',
  }
}

export function deleteFolderEdit(folderPath: string): DeleteFolderEdit | null {
  if (!folderPath) return null

  return {
    folderPath,
    type: 'deleteFolder',
  }
}
