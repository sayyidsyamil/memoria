import {
  mobileFolderParentPath,
  normalizedMobileFilenameStem,
  normalizedMobileFolderPath,
  uniqueMobileFolderPaths,
} from './mobileWorkspaceFolders'
import type { MobileNote } from './mobileWorkspaceModel'
import { noteFilename, noteWritePath } from './mobileWorkspacePathRewrites'
import { slugifyNoteStem } from '../../../../src/utils/noteSlug'

type FolderPath = string
type NotePath = string

export type MobileNotePathValidationStatus =
  | 'collision'
  | 'empty'
  | 'invalid'
  | 'missingFolder'
  | 'ok'
  | 'same'

export function uniqueMobileNotePath(notes: MobileNote[], basePath: NotePath): NotePath {
  const existing = new Set(notes.flatMap(noteIdentityPaths).map(canonicalNotePath).filter(Boolean))
  if (!existing.has(canonicalNotePath(basePath))) return basePath

  const stem = basePath.replace(/\.md$/u, '')
  let index = 2
  while (existing.has(canonicalNotePath(`${stem}-${index}.md`))) index += 1
  return `${stem}-${index}.md`
}

export function validateMobileRenameNoteFilePath({
  filenameStem,
  note,
  notes,
}: {
  filenameStem: string
  note: MobileNote | null
  notes: MobileNote[]
}): MobileNotePathValidationStatus {
  if (!filenameStem.trim()) return 'empty'
  const nextPath = renamedMobileNoteFilePath(note, filenameStem)
  if (!nextPath) return 'invalid'

  return validateMobileNoteDestination({
    nextPath,
    note,
    notes,
  })
}

export function validateMobileMoveNoteFolderPath({
  folderPath,
  folderPaths,
  note,
  notes,
}: {
  folderPath: string
  folderPaths?: FolderPath[]
  note: MobileNote | null
  notes: MobileNote[]
}): MobileNotePathValidationStatus {
  const path = movedMobileNoteFilePath(note, folderPath)
  if (!path) return normalizedMobileFolderPath(folderPath) ? 'invalid' : 'empty'
  if (!mobileFolderPathExists(notes, folderPaths, folderPath)) return 'missingFolder'

  return validateMobileNoteDestination({ nextPath: path, note, notes })
}

export function renamedMobileNoteFilePath(note: MobileNote | null, filenameStem: string): NotePath | null {
  const stem = normalizedMobileFilenameStem(filenameStem)
  if (!note || !stem) return null

  const folderPath = mobileFolderParentPath(noteWritePath(note))
  const filename = `${stem}.md`
  return folderPath ? `${folderPath}/${filename}` : filename
}

export function mobileFilenameStemForTitle(title: string): string {
  return slugifyNoteStem(title)
}

export function movedMobileNoteFilePath(note: MobileNote | null, folderPath: string): NotePath | null {
  const folder = normalizedMobileFolderPath(folderPath)
  if (!note || !folder) return null

  return `${folder}/${noteFilename(noteWritePath(note))}`
}

export function mobileFolderPathExists(
  notes: MobileNote[],
  folderPaths: FolderPath[] | undefined,
  folderPath: FolderPath,
): boolean {
  const normalized = normalizedMobileFolderPath(folderPath)
  if (!normalized) return false

  return mobileWorkspaceFolderPaths(notes, folderPaths).some((path) => canonicalNotePath(path) === canonicalNotePath(normalized))
}

function validateMobileNoteDestination({
  nextPath,
  note,
  notes,
}: {
  nextPath: NotePath | null
  note: MobileNote | null
  notes: MobileNote[]
}): MobileNotePathValidationStatus {
  if (!note) return 'invalid'
  if (!nextPath) return 'empty'
  if (canonicalNotePath(nextPath) === canonicalNotePath(noteWritePath(note))) return 'same'

  return mobileNotePathExists(notes, note, nextPath) ? 'collision' : 'ok'
}

function mobileNotePathExists(notes: MobileNote[], currentNote: MobileNote, nextPath: NotePath): boolean {
  const next = canonicalNotePath(nextPath)
  return notes.some((note) => note.id !== currentNote.id && noteIdentityPaths(note).some((path) => canonicalNotePath(path) === next))
}

function mobileWorkspaceFolderPaths(notes: MobileNote[], folderPaths: FolderPath[] | undefined): FolderPath[] {
  return uniqueMobileFolderPaths([
    ...(folderPaths ?? []),
    ...notes.map((note) => mobileFolderParentPath(noteWritePath(note))),
  ])
}

function noteIdentityPaths(note: MobileNote): NotePath[] {
  return [note.id, note.path ?? ''].filter(Boolean)
}

function canonicalNotePath(path: NotePath): NotePath {
  return normalizedMobileFolderPath(path).toLowerCase()
}
