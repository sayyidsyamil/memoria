import { buildMobileSidebarSections } from './mobileSidebarSections'
import { mobileAllNotesFileVisibilityFromVaultConfig } from './mobileVaultConfig'
import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import {
  folderPathsWithCreated,
  folderPathsWithDeleted,
  folderPathsWithRenamed,
  mobileFolderChildPath,
  mobileFolderParentPath,
  mobileFolderPathContains,
  mobileFolderPathsForNotes,
  normalizedMobileFolderPath,
  renamedFolderPath,
  uniqueMobileFolderPaths,
} from './mobileWorkspaceFolders'
import {
  movedNoteWikilinkRewrite,
  noteWithWritePath,
  noteWritePath,
  rewriteMovedNoteWikilinks,
  type MovedNoteWikilinkRewrite,
} from './mobileWorkspacePathRewrites'
import {
  mobileTypeDefinitionWikilinkWritesForWorkspaceWrites,
  rewriteMobileTypeDefinitionWikilinks,
} from './mobileTypeDefinitionPathRewrites'
import type {
  MobileWorkspaceEdit,
  MobileWorkspaceEditResult,
  MobileWorkspaceWrite,
} from './mobileWorkspaceEditing'

type FolderPath = string
type MobileFolderEdit = Extract<MobileWorkspaceEdit, { type: 'createFolder' | 'deleteFolder' | 'renameFolder' }>
type RebuildMobileWorkspaceSnapshot = (
  snapshot: MobileWorkspaceSnapshot,
  notes: MobileNote[],
  allNotes?: MobileNote[],
) => MobileWorkspaceSnapshot

export function applyMobileFolderEdit(
  snapshot: MobileWorkspaceSnapshot,
  edit: MobileFolderEdit,
  rebuildSnapshot: RebuildMobileWorkspaceSnapshot,
): MobileWorkspaceEditResult {
  if (edit.type === 'createFolder') return createMobileFolder(snapshot, edit)
  if (edit.type === 'renameFolder') return renameMobileFolder(snapshot, edit, rebuildSnapshot)
  return deleteMobileFolder(snapshot, edit.folderPath, rebuildSnapshot)
}

function createMobileFolder(
  snapshot: MobileWorkspaceSnapshot,
  edit: Extract<MobileWorkspaceEdit, { type: 'createFolder' }>,
): MobileWorkspaceEditResult {
  const path = mobileFolderChildPath(edit.parentPath, edit.name)
  if (!path || workspacePathExists(snapshot, path)) return { snapshot, writes: [] }

  return {
    snapshot: snapshotWithFolderPaths(snapshot, folderPathsWithCreated(workspaceFolderPaths(snapshot), path)),
    writes: [{ kind: 'createFolder', path }],
  }
}

function renameMobileFolder(
  snapshot: MobileWorkspaceSnapshot,
  edit: Extract<MobileWorkspaceEdit, { type: 'renameFolder' }>,
  rebuildSnapshot: RebuildMobileWorkspaceSnapshot,
): MobileWorkspaceEditResult {
  const previousPath = normalizedMobileFolderPath(edit.folderPath)
  const nextPath = mobileFolderChildPath(mobileFolderParentPath(previousPath), edit.name)
  if (!previousPath || !nextPath || previousPath === nextPath) return { snapshot, writes: [] }
  if (!workspaceFolderPathExists(snapshot, previousPath) || workspacePathExists(snapshot, nextPath)) return { snapshot, writes: [] }

  return renameFolderSubtree(snapshot, previousPath, nextPath, rebuildSnapshot)
}

function deleteMobileFolder(
  snapshot: MobileWorkspaceSnapshot,
  folderPath: FolderPath,
  rebuildSnapshot: RebuildMobileWorkspaceSnapshot,
): MobileWorkspaceEditResult {
  const path = normalizedMobileFolderPath(folderPath)
  if (!path || !workspaceFolderPathExists(snapshot, path)) return { snapshot, writes: [] }

  const notes = snapshot.notes.filter((note) => !noteBelongsToFolder(note, path))
  const allNotes = snapshot.allNotes?.filter((note) => !noteBelongsToFolder(note, path))
  const folderPaths = folderPathsWithDeleted(workspaceFolderPaths(snapshot), path)
  const nextSnapshot = rebuildSnapshot({ ...snapshot, allNotes, folderPaths }, notes, allNotes)

  return {
    snapshot: nextSnapshot,
    writes: [{ kind: 'deleteFolder', path }],
  }
}

function renameFolderSubtree(
  snapshot: MobileWorkspaceSnapshot,
  previousPath: FolderPath,
  nextPath: FolderPath,
  rebuildSnapshot: RebuildMobileWorkspaceSnapshot,
): MobileWorkspaceEditResult {
  const previousPool = workspaceNotePool(snapshot)
  const rewrites = folderMoveWikilinkRewrites(previousPool, previousPath, nextPath)
  const nextPool = renameFolderWorkspaceNotes(previousPool, previousPath, nextPath, rewrites)
  const nextNotes = renameFolderWorkspaceNotes(snapshot.notes, previousPath, nextPath, rewrites)
  const nextAllNotes = snapshot.allNotes ? nextPool : undefined
  const folderPaths = folderPathsWithRenamed(workspaceFolderPaths(snapshot), previousPath, nextPath)
  const nextTypeDefinitions = rewriteMobileTypeDefinitionWikilinks(snapshot.typeDefinitions, rewrites)
  const nextSnapshot = rebuildSnapshot(
    { ...snapshot, allNotes: nextAllNotes, folderPaths, typeDefinitions: nextTypeDefinitions },
    nextNotes,
    nextAllNotes,
  )
  const writes = renameFolderWrites(previousPool, nextPool, previousPath, nextPath)

  return {
    snapshot: nextSnapshot,
    writes: [
      ...writes,
      ...mobileTypeDefinitionWikilinkWritesForWorkspaceWrites(
        snapshot.typeDefinitions,
        nextTypeDefinitions,
        writes,
      ),
    ],
  }
}

function renameFolderWorkspaceNotes(
  notes: MobileNote[],
  previousPath: FolderPath,
  nextPath: FolderPath,
  rewrites: MovedNoteWikilinkRewrite[],
): MobileNote[] {
  return notes.map((note) => {
    const movedNote = noteBelongsToFolder(note, previousPath)
      ? renamedFolderNote(note, previousPath, nextPath)
      : note
    return rewrites.reduce(rewriteMovedNoteWikilinks, movedNote)
  })
}

function folderMoveWikilinkRewrites(
  notes: MobileNote[],
  previousPath: FolderPath,
  nextPath: FolderPath,
): MovedNoteWikilinkRewrite[] {
  return notes
    .filter((note) => noteBelongsToFolder(note, previousPath))
    .map((note) => movedNoteWikilinkRewrite(note, renamedFolderNote(note, previousPath, nextPath)))
}

function renamedFolderNote(note: MobileNote, previousPath: FolderPath, nextPath: FolderPath): MobileNote {
  return noteWithWritePath(note, renamedFolderPath(noteWritePath(note), previousPath, nextPath))
}

function renameFolderWrites(
  previousPool: MobileNote[],
  nextPool: MobileNote[],
  previousPath: FolderPath,
  nextPath: FolderPath,
): MobileWorkspaceWrite[] {
  return [
    { kind: 'renameFolder', path: previousPath, toPath: nextPath },
    ...folderRenameContentWrites(previousPool, nextPool, previousPath, nextPath),
  ]
}

function folderRenameContentWrites(
  previousPool: MobileNote[],
  nextPool: MobileNote[],
  previousPath: FolderPath,
  nextPath: FolderPath,
): MobileWorkspaceWrite[] {
  const previousRawContent = new Map(previousPool.map((note) => [noteWritePath(note), note.rawContent]))
  return nextPool.flatMap((note) => {
    const path = noteWritePath(note)
    const oldPath = renamedFolderPath(path, nextPath, previousPath)
    if (note.rawContent === undefined || previousRawContent.get(oldPath) === note.rawContent) return []
    return [{ content: note.rawContent, kind: 'saveNote', path }]
  })
}

function snapshotWithFolderPaths(
  snapshot: MobileWorkspaceSnapshot,
  folderPaths: FolderPath[],
): MobileWorkspaceSnapshot {
  return {
    ...snapshot,
    folderPaths,
    sidebarSections: buildMobileSidebarSections({
      allNotesFileVisibility: mobileAllNotesFileVisibilityFromVaultConfig(snapshot.vaultConfig),
      folderPaths,
      notes: workspaceNotePool(snapshot),
      previousSections: snapshot.sidebarSections,
      typeDefinitions: snapshot.typeDefinitions,
      views: snapshot.views,
    }),
  }
}

function workspaceFolderPathExists(snapshot: MobileWorkspaceSnapshot, folderPath: FolderPath): boolean {
  const normalizedPath = canonicalFolderPath(folderPath)
  return workspaceFolderPaths(snapshot).some((path) => canonicalFolderPath(path) === normalizedPath)
}

function workspacePathExists(snapshot: MobileWorkspaceSnapshot, path: FolderPath): boolean {
  const normalizedPath = canonicalFolderPath(path)
  return workspaceFolderPathExists(snapshot, normalizedPath)
    || workspaceNotePool(snapshot).some((note) => notePathExists(note, normalizedPath))
}

function notePathExists(note: MobileNote, path: FolderPath): boolean {
  return noteIdentityPaths(note).some((candidate) => canonicalFolderPath(candidate) === path)
}

function noteIdentityPaths(note: MobileNote): FolderPath[] {
  return [note.id, note.path ?? '', noteWritePath(note)]
}

function canonicalFolderPath(path: FolderPath): FolderPath {
  return normalizedMobileFolderPath(path).toLowerCase()
}

function workspaceFolderPaths(snapshot: MobileWorkspaceSnapshot): FolderPath[] {
  return uniqueMobileFolderPaths([
    ...(snapshot.folderPaths ?? []),
    ...mobileFolderPathsForNotes(workspaceNotePool(snapshot)),
  ])
}

function workspaceNotePool(snapshot: MobileWorkspaceSnapshot): MobileNote[] {
  return snapshot.allNotes ?? snapshot.notes
}

function noteBelongsToFolder(note: MobileNote, folderPath: FolderPath): boolean {
  return mobileFolderPathContains(folderPath, mobileFolderParentPath(noteWritePath(note)))
}
