import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'

type DeleteTypeDefinitionEdit = Extract<MobileWorkspaceEdit, { type: 'deleteTypeDefinition' }>
type DeleteViewEdit = Extract<MobileWorkspaceEdit, { type: 'deleteView' }>
type MoveFavoriteEdit = Extract<MobileWorkspaceEdit, { type: 'moveFavorite' }>
type MoveTypeSectionEdit = Extract<MobileWorkspaceEdit, { type: 'moveTypeSection' }>
type MoveViewEdit = Extract<MobileWorkspaceEdit, { type: 'moveView' }>
type SidebarMoveDirection = 'down' | 'up'

export function moveFavoriteEdit(
  noteId: string,
  direction: SidebarMoveDirection,
): MoveFavoriteEdit | null {
  const trimmedNoteId = noteId.trim()
  if (!trimmedNoteId) return null

  return {
    direction,
    noteId: trimmedNoteId,
    type: 'moveFavorite',
  }
}

export function moveViewEdit(
  viewId: string,
  direction: SidebarMoveDirection,
): MoveViewEdit | null {
  const trimmedViewId = viewId.trim()
  if (!trimmedViewId) return null

  return {
    direction,
    type: 'moveView',
    viewId: trimmedViewId,
  }
}

export function moveTypeSectionEdit(
  typeName: string,
  direction: SidebarMoveDirection,
): MoveTypeSectionEdit | null {
  const trimmedTypeName = typeName.trim()
  if (!trimmedTypeName) return null

  return {
    direction,
    type: 'moveTypeSection',
    typeName: trimmedTypeName,
  }
}

export function deleteViewEdit(viewId: string): DeleteViewEdit | null {
  const trimmedViewId = viewId.trim()
  if (!trimmedViewId) return null

  return {
    type: 'deleteView',
    viewId: trimmedViewId,
  }
}

export function deleteTypeDefinitionEdit(typeName: string): DeleteTypeDefinitionEdit | null {
  const trimmedTypeName = typeName.trim()
  if (!trimmedTypeName) return null

  return {
    type: 'deleteTypeDefinition',
    typeName: trimmedTypeName,
  }
}
