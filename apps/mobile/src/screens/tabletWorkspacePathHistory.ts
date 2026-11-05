import {
  mobileFilenameStemForTitle,
  movedMobileNoteFilePath,
  renamedMobileNoteFilePath,
} from '../workspace/mobileNotePaths'
import { mobileNoteEditableContent } from '../workspace/mobileDocumentContent'
import {
  mobileFolderChildPath,
  mobileFolderName,
  mobileFolderParentPath,
  mobileFolderPathsForNotes,
  normalizedMobileFolderPath,
} from '../workspace/mobileWorkspaceFolders'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import type { MobileNote, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import {
  noteFilename,
  noteWritePath,
} from '../workspace/mobileWorkspacePathRewrites'
import type { MobileWorkspaceHistoryEntry } from './tabletWorkspaceHistory'

type PathHistoryEdit = Extract<
  MobileWorkspaceEdit,
  { type: 'moveNoteToFolder' | 'renameFolder' | 'renameNoteFile' }
>
type TitlePropertyEdit = Extract<MobileWorkspaceEdit, { type: 'updateProperty' }> & { value: string }

export function mobileWorkspacePathHistoryEntry(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  sourceEdit: MobileWorkspaceEdit | undefined,
): MobileWorkspaceHistoryEntry | null {
  if (!sourceEdit) return null
  const titlePathEntry = titlePropertyPathHistoryEntry(previousSnapshot, nextSnapshot, sourceEdit)
  if (titlePathEntry) return titlePathEntry
  if (!isPathHistoryEdit(sourceEdit)) return null
  if (sourceEdit.type === 'moveNoteToFolder') return movedNoteHistoryEntry(previousSnapshot, nextSnapshot, sourceEdit)
  if (sourceEdit.type === 'renameNoteFile') return renamedNoteHistoryEntry(previousSnapshot, nextSnapshot, sourceEdit)
  return renamedFolderHistoryEntry(nextSnapshot, sourceEdit)
}

function titlePropertyPathHistoryEntry(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  sourceEdit: MobileWorkspaceEdit,
): MobileWorkspaceHistoryEntry | null {
  if (!isTitlePropertyEdit(sourceEdit)) return null

  const previousNote = noteById(previousSnapshot, sourceEdit.noteId)
  const nextPath = previousNote ? renamedMobileNoteFilePath(previousNote, mobileFilenameStemForTitle(sourceEdit.value)) : null
  const nextNote = nextPath ? noteByPath(nextSnapshot, nextPath) : null
  if (!previousNote || !nextNote || noteWritePath(previousNote) === noteWritePath(nextNote)) return null

  return renamedNoteContentHistoryEntry(previousSnapshot, nextSnapshot, previousNote, nextNote)
}

function contentRestoreEdits(
  fromSnapshot: MobileWorkspaceSnapshot,
  toSnapshot: MobileWorkspaceSnapshot,
  movedFromNote: MobileNote,
  movedToNote: MobileNote,
): MobileWorkspaceHistoryEntry['undoEdits'] {
  const fromNotesById = new Map(workspaceNotes(fromSnapshot).map((note) => [note.id, note]))
  return workspaceNotes(toSnapshot).flatMap((toNote) => {
    const fromNote = fromNotesById.get(toNote.id) ?? (toNote.id === movedToNote.id ? movedFromNote : null)
    if (!fromNote || mobileNoteEditableContent(fromNote) === mobileNoteEditableContent(toNote)) return []
    return [{ content: mobileNoteEditableContent(toNote), noteId: toNote.id, type: 'updateNoteContent' as const }]
  })
}

function movedNoteHistoryEntry(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  sourceEdit: Extract<PathHistoryEdit, { type: 'moveNoteToFolder' }>,
): MobileWorkspaceHistoryEntry | null {
  const previousNote = noteById(previousSnapshot, sourceEdit.noteId)
  const nextPath = previousNote ? movedMobileNoteFilePath(previousNote, sourceEdit.folderPath) : null
  const nextNote = nextPath ? noteByPath(nextSnapshot, nextPath) : null
  if (!previousNote || !nextNote) return null

  const previousFolderPath = mobileFolderParentPath(noteWritePath(previousNote))
  const nextFolderPath = mobileFolderParentPath(noteWritePath(nextNote))
  if (!previousFolderPath || !nextFolderPath) return null

  return {
    redoEdits: [
      ...restoreMissingFolderEdits(previousSnapshot, nextFolderPath),
      { folderPath: nextFolderPath, noteId: previousNote.id, type: 'moveNoteToFolder' },
      ...contentRestoreEdits(previousSnapshot, nextSnapshot, previousNote, nextNote),
    ],
    undoEdits: [
      ...restoreMissingFolderEdits(nextSnapshot, previousFolderPath),
      { folderPath: previousFolderPath, noteId: nextNote.id, type: 'moveNoteToFolder' },
      ...contentRestoreEdits(nextSnapshot, previousSnapshot, nextNote, previousNote),
    ],
  }
}

function renamedNoteHistoryEntry(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  sourceEdit: Extract<PathHistoryEdit, { type: 'renameNoteFile' }>,
): MobileWorkspaceHistoryEntry | null {
  const previousNote = noteById(previousSnapshot, sourceEdit.noteId)
  const nextPath = previousNote ? renamedMobileNoteFilePath(previousNote, sourceEdit.filenameStem) : null
  const nextNote = nextPath ? noteByPath(nextSnapshot, nextPath) : null
  if (!previousNote || !nextNote) return null

  return renamedNoteContentHistoryEntry(previousSnapshot, nextSnapshot, previousNote, nextNote)
}

function renamedNoteContentHistoryEntry(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  previousNote: MobileNote,
  nextNote: MobileNote,
): MobileWorkspaceHistoryEntry {
  return {
    redoEdits: [
      { filenameStem: filenameStem(nextNote), noteId: previousNote.id, type: 'renameNoteFile' },
      ...contentRestoreEdits(previousSnapshot, nextSnapshot, previousNote, nextNote),
    ],
    undoEdits: [
      { filenameStem: filenameStem(previousNote), noteId: nextNote.id, type: 'renameNoteFile' },
      ...contentRestoreEdits(nextSnapshot, previousSnapshot, nextNote, previousNote),
    ],
  }
}

function renamedFolderHistoryEntry(
  nextSnapshot: MobileWorkspaceSnapshot,
  sourceEdit: Extract<PathHistoryEdit, { type: 'renameFolder' }>,
): MobileWorkspaceHistoryEntry | null {
  const previousPath = normalizedMobileFolderPath(sourceEdit.folderPath)
  const nextPath = mobileFolderChildPath(mobileFolderParentPath(previousPath), sourceEdit.name)
  if (!previousPath || !nextPath || !folderPathExists(nextSnapshot, nextPath)) return null

  return {
    redoEdits: [{ folderPath: previousPath, name: mobileFolderName(nextPath), type: 'renameFolder' }],
    undoEdits: [{ folderPath: nextPath, name: mobileFolderName(previousPath), type: 'renameFolder' }],
  }
}

function restoreMissingFolderEdits(
  snapshot: MobileWorkspaceSnapshot,
  folderPath: string,
): MobileWorkspaceHistoryEntry['undoEdits'] {
  return folderPathExists(snapshot, folderPath) ? [] : [{ path: folderPath, type: 'restoreFolder' }]
}

function noteById(snapshot: MobileWorkspaceSnapshot, noteId: string): MobileNote | null {
  return workspaceNotes(snapshot).find((note) => note.id === noteId) ?? null
}

function noteByPath(snapshot: MobileWorkspaceSnapshot, path: string): MobileNote | null {
  const normalizedPath = normalizedMobileFolderPath(path)
  return workspaceNotes(snapshot).find((note) => normalizedMobileFolderPath(noteWritePath(note)) === normalizedPath) ?? null
}

function workspaceNotes(snapshot: MobileWorkspaceSnapshot): MobileNote[] {
  return snapshot.allNotes ?? snapshot.notes
}

function folderPathExists(snapshot: MobileWorkspaceSnapshot, folderPath: string): boolean {
  const normalizedPath = normalizedMobileFolderPath(folderPath)
  return workspaceFolderPaths(snapshot).some((path) => normalizedMobileFolderPath(path) === normalizedPath)
}

function workspaceFolderPaths(snapshot: MobileWorkspaceSnapshot): string[] {
  return [
    ...(snapshot.folderPaths ?? []),
    ...mobileFolderPathsForNotes(workspaceNotes(snapshot)),
  ]
}

function filenameStem(note: MobileNote): string {
  return noteFilename(noteWritePath(note)).replace(/\.md$/u, '')
}

function isPathHistoryEdit(edit: MobileWorkspaceEdit): edit is PathHistoryEdit {
  return edit.type === 'moveNoteToFolder' || edit.type === 'renameFolder' || edit.type === 'renameNoteFile'
}

function isTitlePropertyEdit(edit: MobileWorkspaceEdit): edit is TitlePropertyEdit {
  return edit.type === 'updateProperty'
    && normalizedFrontmatterKey(edit.key) === 'title'
    && typeof edit.value === 'string'
    && edit.value.trim().length > 0
}

function normalizedFrontmatterKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/gu, '_')
}
