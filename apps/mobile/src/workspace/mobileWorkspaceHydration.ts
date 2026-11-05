import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

export function preserveHydratedNoteTimestamps(
  snapshot: MobileWorkspaceSnapshot,
  previousNote: MobileNote | null,
): MobileWorkspaceSnapshot {
  if (!previousNote) return snapshot
  const preserve = (note: MobileNote) => note.id === previousNote.id
    ? { ...note, modified: previousNote.modified, modifiedAt: previousNote.modifiedAt }
    : note

  return {
    ...snapshot,
    allNotes: snapshot.allNotes?.map(preserve),
    notes: snapshot.notes.map(preserve),
  }
}
