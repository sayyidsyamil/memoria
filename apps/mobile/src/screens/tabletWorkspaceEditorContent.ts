import type { MobileNote, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import { isMobileMarkdownNote } from '../workspace/mobileNoteFilters'

function editorContentForSelection<T>(selectedNote: MobileNote | null, fallback: T[], content: T[] | undefined, complete: boolean) {
  if (!selectedNote) return fallback
  if (!isMobileMarkdownNote(selectedNote)) return []
  return content ?? (complete ? [] : fallback)
}

export function editorBlocksForSelection(snapshot: MobileWorkspaceSnapshot, selectedNote: MobileNote | null) {
  return editorContentForSelection(selectedNote, snapshot.editorBlocks, selectedNote?.editorBlocks, Boolean(snapshot.allNotes))
}

export function editorBulletsForSelection(snapshot: MobileWorkspaceSnapshot, selectedNote: MobileNote | null) {
  return editorContentForSelection(selectedNote, snapshot.editorBullets, selectedNote?.editorBullets, Boolean(snapshot.allNotes))
}
