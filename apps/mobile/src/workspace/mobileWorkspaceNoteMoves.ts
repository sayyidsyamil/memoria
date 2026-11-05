import type { MobileNote } from './mobileWorkspaceModel'
import {
  movedMobileNoteFilePath,
  renamedMobileNoteFilePath,
} from './mobileNotePaths'
import {
  noteWithWritePath,
  noteWritePath,
  rewriteMovedNoteWikilinks,
  type MovedNoteWikilinkRewrite,
} from './mobileWorkspacePathRewrites'

type FilenameStem = string
type FolderPath = string
type MarkdownContent = string

export type MobileWorkspaceNoteMoveWrite =
  | { kind: 'moveNote'; path: string; toPath: string }
  | { content: MarkdownContent; kind: 'saveNote'; path: string }

export function moveWorkspaceNotes(
  notes: MobileNote[],
  previousNote: MobileNote,
  nextNote: MobileNote,
  rewrite: MovedNoteWikilinkRewrite,
): MobileNote[] {
  return notes.map((note) => {
    if (note.id === previousNote.id) return nextNote
    return rewriteMovedNoteWikilinks(note, rewrite)
  })
}

export function movedWorkspaceNote(note: MobileNote, folderPath: FolderPath): MobileNote {
  const nextPath = movedMobileNoteFilePath(note, folderPath) ?? noteWritePath(note)
  return noteWithWritePath(note, nextPath)
}

export function renamedWorkspaceNoteFile(note: MobileNote, filenameStem: FilenameStem): MobileNote {
  const nextPath = renamedMobileNoteFilePath(note, filenameStem) ?? noteWritePath(note)
  return noteWithWritePath(note, nextPath)
}

export function moveNoteWrites(
  previousNote: MobileNote,
  nextNote: MobileNote,
  previousPool: MobileNote[],
  nextPool: MobileNote[],
): MobileWorkspaceNoteMoveWrite[] {
  const previousPath = noteWritePath(previousNote)
  const nextPath = noteWritePath(nextNote)
  if (previousPath === nextPath) return []

  return [
    { kind: 'moveNote', path: previousPath, toPath: nextPath },
    ...movedWikilinkWrites(previousPool, nextPool, nextPath),
  ]
}

function movedWikilinkWrites(
  previousPool: MobileNote[],
  nextPool: MobileNote[],
  movedPath: string,
): MobileWorkspaceNoteMoveWrite[] {
  const previousRawContent = new Map(previousPool.map((note) => [noteWritePath(note), note.rawContent]))
  return nextPool.flatMap((note) => {
    const path = noteWritePath(note)
    if (path === movedPath || note.rawContent === undefined) return []
    if (previousRawContent.get(path) === note.rawContent) return []
    return [{ content: note.rawContent, kind: 'saveNote', path }]
  })
}
