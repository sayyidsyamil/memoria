import type { VaultEntry, WorkspaceIdentity } from '../types'
import { notePathFilename } from '../utils/notePathIdentity'
import { filenameStemToTitle } from '../utils/noteTitle'
import { relativePathStem } from '../utils/wikilink'

/** The entry a note has after a rename or a move, built from the one it had. */

export function buildRenamedEntry(entry: VaultEntry, newTitle: string, newPath: string): VaultEntry {
  const filename = notePathFilename(newPath)
  return { ...entry, path: newPath, filename, title: newTitle }
}

export function buildFilenameRenamedEntry(entry: VaultEntry, newPath: string): VaultEntry {
  const filename = notePathFilename(newPath)
  const oldFallbackTitle = filenameStemToTitle(entry.filename)
  const title = !entry.hasH1 && entry.title === oldFallbackTitle ? filenameStemToTitle(filename) : entry.title
  return { ...entry, path: newPath, filename, title }
}

export function buildWorkspaceMovedEntry(entry: VaultEntry, newPath: string, workspace: WorkspaceIdentity): VaultEntry {
  return {
    ...buildFilenameRenamedEntry(entry, newPath),
    workspace,
  }
}

export function workspaceMoveReplacementTarget({
  entry,
  sourceVaultPath,
  destinationWorkspace,
}: {
  entry: VaultEntry
  sourceVaultPath: string
  destinationWorkspace: WorkspaceIdentity
}): string {
  const localTarget = relativePathStem(entry.path, sourceVaultPath)
  const sourceAlias = entry.workspace?.alias
  return destinationWorkspace.alias && destinationWorkspace.alias !== sourceAlias
    ? `${destinationWorkspace.alias}/${localTarget}`
    : localTarget
}
