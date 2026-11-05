import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import type { MobileNote } from '../workspace/mobileWorkspaceModel'
import { mobileFilenameStemForTitle } from '../workspace/mobileNotePaths'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'

type ChangeNoteTypeEdit = Extract<MobileWorkspaceEdit, { type: 'changeNoteType' }>
type MoveNoteToFolderEdit = Extract<MobileWorkspaceEdit, { type: 'moveNoteToFolder' }>
type RenameNoteFileEdit = Extract<MobileWorkspaceEdit, { type: 'renameNoteFile' }>
type NoteRetargetForm = Pick<TabletReadOnlyForm, 'filenameStem' | 'folderPath' | 'noteType'>

export function changeNoteTypeEditFromForm(
  form: NoteRetargetForm,
  noteId: string,
): ChangeNoteTypeEdit | null {
  const trimmedNoteId = noteId.trim()
  const value = form.noteType.trim()
  return trimmedNoteId && value ? {
    noteId: trimmedNoteId,
    type: 'changeNoteType',
    value,
  } : null
}

export function moveNoteToFolderEditFromForm(
  form: NoteRetargetForm,
  noteId: string,
): MoveNoteToFolderEdit | null {
  const trimmedNoteId = noteId.trim()
  const folderPath = form.folderPath.trim()
  return trimmedNoteId && folderPath ? {
    folderPath,
    noteId: trimmedNoteId,
    type: 'moveNoteToFolder',
  } : null
}

export function renameNoteFileEditFromForm(
  form: NoteRetargetForm,
  noteId: string,
): RenameNoteFileEdit | null {
  const trimmedNoteId = noteId.trim()
  const filenameStem = form.filenameStem.trim()
  return trimmedNoteId && filenameStem ? {
    filenameStem,
    noteId: trimmedNoteId,
    type: 'renameNoteFile',
  } : null
}

export function renameNoteFileToTitleEdit(
  note: MobileNote | null,
): RenameNoteFileEdit | null {
  if (!note) return null
  const filenameStem = mobileFilenameStemForTitle(note.title)
  if (!filenameStem) return null

  return {
    filenameStem,
    noteId: note.id,
    type: 'renameNoteFile',
  }
}
