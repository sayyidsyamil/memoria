import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'

type DeletePropertyEdit = Extract<MobileWorkspaceEdit, { type: 'deleteProperty' }>
type UpdatePropertyEdit = Extract<MobileWorkspaceEdit, { type: 'updateProperty' }>
type NoteIconForm = Pick<TabletReadOnlyForm, 'noteIcon'>

const noteIconPropertyKey = '_icon'

export function removeNoteIconEdit(noteId: string): DeletePropertyEdit | null {
  const trimmedNoteId = noteId.trim()
  return trimmedNoteId ? {
    key: noteIconPropertyKey,
    noteId: trimmedNoteId,
    type: 'deleteProperty',
  } : null
}

export function setNoteIconEditFromForm(
  form: NoteIconForm,
  noteId: string,
): UpdatePropertyEdit | null {
  const trimmedNoteId = noteId.trim()
  const value = form.noteIcon.trim()
  return trimmedNoteId && value ? {
    key: noteIconPropertyKey,
    noteId: trimmedNoteId,
    type: 'updateProperty',
    value,
  } : null
}
