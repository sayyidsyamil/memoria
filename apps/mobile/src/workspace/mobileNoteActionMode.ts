import type { MobileNote } from './mobileWorkspaceModel'

export type MobileNoteActionMode = 'binary-file' | 'markdown-note' | 'text-file'
type MobileNoteActionCandidate = Pick<MobileNote, 'fileKind'>

export function mobileNoteActionMode(note: MobileNoteActionCandidate): MobileNoteActionMode {
  if ((note.fileKind ?? 'markdown') === 'markdown') return 'markdown-note'
  if (note.fileKind === 'text') return 'text-file'
  return 'binary-file'
}

export function isMobileMarkdownActionNote(note: MobileNoteActionCandidate | null): boolean {
  return note !== null && mobileNoteActionMode(note) === 'markdown-note'
}

export function isMobileNonMarkdownActionNote(note: MobileNoteActionCandidate | null): boolean {
  return note !== null && mobileNoteActionMode(note) !== 'markdown-note'
}

export function isMobileTextLikeActionNote(note: MobileNoteActionCandidate | null): boolean {
  return note !== null && mobileNoteActionMode(note) !== 'binary-file'
}
