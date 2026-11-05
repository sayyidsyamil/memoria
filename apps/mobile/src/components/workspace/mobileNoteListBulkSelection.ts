import type { MobileNote } from '../../workspace/mobileWorkspaceModel'

type NoteId = MobileNote['id']

export function addMobileNoteListSelection(current: ReadonlySet<NoteId>, noteId: NoteId): Set<NoteId> {
  if (current.has(noteId)) return new Set(current)
  return new Set([...current, noteId])
}

export function toggleMobileNoteListSelection(current: ReadonlySet<NoteId>, noteId: NoteId): Set<NoteId> {
  const next = new Set(current)
  if (next.has(noteId)) next.delete(noteId)
  else next.add(noteId)
  return next
}

export function pruneMobileNoteListSelection(
  current: ReadonlySet<NoteId>,
  visibleNoteIds: readonly NoteId[],
): Set<NoteId> | ReadonlySet<NoteId> {
  if (current.size === 0) return current

  const visible = new Set(visibleNoteIds)
  const next = new Set([...current].filter((noteId) => visible.has(noteId)))
  return next.size === current.size ? current : next
}

export function selectedMobileNoteListNotes(
  notes: readonly MobileNote[],
  selectedNoteIds: ReadonlySet<NoteId>,
): MobileNote[] {
  return notes.filter((note) => selectedNoteIds.has(note.id))
}

export function selectedMobileNoteListIds(
  notes: readonly MobileNote[],
  selectedNoteIds: ReadonlySet<NoteId>,
): NoteId[] {
  return selectedMobileNoteListNotes(notes, selectedNoteIds).map((note) => note.id)
}

export function mobileNoteListSelectionIsArchived(notes: readonly MobileNote[]) {
  return notes.length > 0 && notes.every((note) => note.archived)
}
