import type { MobileWorkspaceAction } from '../components/workspace/MobileWorkspaceActionSheet'
import type { MobileSidebarItemSelection } from '../components/workspace/MobileWorkspaceSidebar'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import type { MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import { moveFavoriteEdit } from './tabletWorkspaceSidebarEditActions'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'

type ApplyWorkspaceEdit = (edit: MobileWorkspaceEdit) => void
type ReadOnlyFormUpdater = <Key extends keyof TabletReadOnlyForm>(key: Key, value: TabletReadOnlyForm[Key]) => void
type SetOpenAction = (action: MobileWorkspaceAction | null) => void

type FavoriteWorkspaceActionsInput = {
  applyEdit: ApplyWorkspaceEdit
  readOnlyForm: TabletReadOnlyForm
  workspaceSnapshot: MobileWorkspaceSnapshot
}

export function favoriteWorkspaceActions({
  applyEdit,
  readOnlyForm,
  workspaceSnapshot,
}: FavoriteWorkspaceActionsInput) {
  return {
    canMoveFavoriteDown: canMoveFavorite(workspaceSnapshot, readOnlyForm.editingFavoriteNoteId, 'down'),
    canMoveFavoriteUp: canMoveFavorite(workspaceSnapshot, readOnlyForm.editingFavoriteNoteId, 'up'),
    onMoveFavoriteDown: () => moveFavorite({
      applyEdit,
      direction: 'down',
      noteId: readOnlyForm.editingFavoriteNoteId,
    }),
    onMoveFavoriteUp: () => moveFavorite({
      applyEdit,
      direction: 'up',
      noteId: readOnlyForm.editingFavoriteNoteId,
    }),
  }
}

export function openFavoriteActions({
  selection,
  setOpenAction,
  snapshot,
  updateReadOnlyForm,
}: {
  selection: MobileSidebarItemSelection
  setOpenAction: SetOpenAction
  snapshot: MobileWorkspaceSnapshot
  updateReadOnlyForm: ReadOnlyFormUpdater
}) {
  if (selection.sectionId !== 'favorites') return
  const noteId = favoriteNoteIdForSidebarSelection(snapshot, selection)
  if (!noteId) return

  updateReadOnlyForm('editingFavoriteNoteId', noteId)
  setOpenAction('editFavorite')
}

function moveFavorite({
  applyEdit,
  direction,
  noteId,
}: {
  applyEdit: ApplyWorkspaceEdit
  direction: 'down' | 'up'
  noteId: string
}) {
  const edit = moveFavoriteEdit(noteId, direction)
  if (edit) applyEdit(edit)
}

function canMoveFavorite(
  snapshot: MobileWorkspaceSnapshot,
  noteId: string,
  direction: 'down' | 'up',
) {
  const favoriteItems = snapshot.sidebarSections.find((section) => section.id === 'favorites')?.items ?? []
  const sourceIndex = favoriteItems.findIndex((item) => (item.noteId ?? favoriteNoteIdFromItemId(item.id)) === noteId)
  const targetIndex = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1
  return sourceIndex !== -1 && targetIndex >= 0 && targetIndex < favoriteItems.length
}

function favoriteNoteIdForSidebarSelection(
  snapshot: MobileWorkspaceSnapshot,
  selection: MobileSidebarItemSelection,
): string | null {
  if (selection.noteId) return selection.noteId

  return snapshot.sidebarSections
    .find((section) => section.id === 'favorites')
    ?.items
    ?.find((item) => item.id === selection.id)
    ?.noteId ?? favoriteNoteIdFromItemId(selection.id)
}

function favoriteNoteIdFromItemId(itemId: string): string | null {
  const prefix = 'favorite-'
  return itemId.startsWith(prefix) ? itemId.slice(prefix.length) : null
}
