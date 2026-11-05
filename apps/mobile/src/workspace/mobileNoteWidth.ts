import type { MobileNote, MobileNoteWidth } from './mobileWorkspaceModel'

export function normalizeMobileNoteWidth(value: unknown): MobileNoteWidth | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  return normalized === 'normal' || normalized === 'wide' ? normalized : null
}

export function toggleMobileNoteWidth(value: unknown): MobileNoteWidth {
  return normalizeMobileNoteWidth(value) === 'wide' ? 'normal' : 'wide'
}

export function resolveMobileNoteWidth(
  noteWidth: unknown,
  defaultNoteWidth: unknown,
): MobileNoteWidth {
  return normalizeMobileNoteWidth(noteWidth) ?? normalizeMobileNoteWidth(defaultNoteWidth) ?? 'normal'
}

export function mobileNoteWithResolvedWidth(
  note: MobileNote,
  defaultNoteWidth: unknown,
): MobileNote {
  return {
    ...note,
    noteWidth: resolveMobileNoteWidth(note.noteWidth, defaultNoteWidth),
  }
}
