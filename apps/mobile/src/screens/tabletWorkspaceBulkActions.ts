import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'

type ApplyWorkspaceEdit = (edit: MobileWorkspaceEdit) => void
type BulkEdit = Extract<MobileWorkspaceEdit, { type: 'bulkEdit' }>
type BulkNoteEdit = Extract<MobileWorkspaceEdit, { type: 'deleteNote' | 'setArchived' | 'setOrganized' }>
type BulkNoteEditFactory = (noteId: string) => BulkNoteEdit

export function tabletWorkspaceBulkNoteActions(applyEdit: ApplyWorkspaceEdit) {
  return {
    onBulkArchiveNotes: (noteIds: string[], archived: boolean) => {
      applyBulkNoteEdit(bulkArchiveNotesEdit(noteIds, archived), applyEdit)
    },
    onBulkDeleteNotes: (noteIds: string[]) => {
      applyBulkNoteEdit(bulkDeleteNotesEdit(noteIds), applyEdit)
    },
    onBulkOrganizeNotes: (noteIds: string[]) => {
      applyBulkNoteEdit(bulkOrganizeNotesEdit(noteIds), applyEdit)
    },
  }
}

export function bulkArchiveNotesEdit(noteIds: string[], archived: boolean): BulkEdit | null {
  return bulkNoteEdit(noteIds, (noteId) => ({ archived, noteId, type: 'setArchived' }))
}

export function bulkDeleteNotesEdit(noteIds: string[]): BulkEdit | null {
  return bulkNoteEdit(noteIds, (noteId) => ({ noteId, type: 'deleteNote' }))
}

export function bulkOrganizeNotesEdit(noteIds: string[]): BulkEdit | null {
  return bulkNoteEdit(noteIds, (noteId) => ({ noteId, organized: true, type: 'setOrganized' }))
}

function bulkNoteEdit(noteIds: string[], toEdit: BulkNoteEditFactory): BulkEdit | null {
  const edits = noteIds.flatMap((noteId) => {
    const trimmedNoteId = noteId.trim()
    return trimmedNoteId ? [toEdit(trimmedNoteId)] : []
  })

  return edits.length > 0
    ? {
      edits,
      type: 'bulkEdit',
    }
    : null
}

function applyBulkNoteEdit(edit: BulkEdit | null, applyEdit: ApplyWorkspaceEdit) {
  if (edit) {
    applyEdit(edit)
  }
}
