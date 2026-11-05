import type { MobileNote } from '../workspace/mobileWorkspaceModel'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'

type AddRelationshipEdit = Extract<MobileWorkspaceEdit, { type: 'addRelationship' }>
type CreateRelationshipTargetEdit = Extract<MobileWorkspaceEdit, { type: 'createRelationshipTarget' }>
type RemoveRelationshipEdit = Extract<MobileWorkspaceEdit, { type: 'removeRelationship' }>
type RelationshipForm = Pick<
  TabletReadOnlyForm,
  'relationshipName' | 'relationshipNoteRef' | 'relationshipNoteTitle'
>

export function addRelationshipEditFromForm(
  form: RelationshipForm,
  noteId: string,
): AddRelationshipEdit | null {
  const trimmedNoteId = noteId.trim()
  const key = form.relationshipName.trim()
  const targetTitle = form.relationshipNoteTitle.trim()
  if (!trimmedNoteId || !key || !targetTitle) return null

  return {
    key,
    noteId: trimmedNoteId,
    targetRef: form.relationshipNoteRef.trim(),
    targetTitle,
    type: 'addRelationship',
  }
}

export function createRelationshipTargetEditFromForm(
  form: RelationshipForm,
  selectedNote: MobileNote | null,
): CreateRelationshipTargetEdit | null {
  const key = form.relationshipName.trim()
  const title = form.relationshipNoteTitle.trim()
  const targetRef = form.relationshipNoteRef.trim()
  if (!selectedNote || !key || !title) return null

  return {
    key,
    sourceNoteId: selectedNote.id,
    ...(targetRef ? { targetRef } : {}),
    targetTitle: title,
    type: 'createRelationshipTarget',
  }
}

export function removeRelationshipEdit(
  noteId: string,
  key: string,
  ref: string,
): RemoveRelationshipEdit | null {
  const trimmedNoteId = noteId.trim()
  const trimmedKey = key.trim()
  const trimmedRef = ref.trim()
  return trimmedNoteId && trimmedKey && trimmedRef
    ? { key: trimmedKey, noteId: trimmedNoteId, ref: trimmedRef, type: 'removeRelationship' }
    : null
}
