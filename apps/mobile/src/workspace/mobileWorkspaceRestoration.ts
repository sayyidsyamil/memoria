import {
  mobileSavedViewPath,
  orderedMobileSavedViews,
  serializeMobileSavedViewDefinition,
} from './mobileSavedViews'
import { buildMobileSidebarSections } from './mobileSidebarSections'
import { mobileAllNotesFileVisibilityFromVaultConfig } from './mobileVaultConfig'
import {
  mobileTypeDefinitionContent,
  mobileTypeDefinitionPath,
} from './mobileTypeDefinitions'
import { normalizedMobileFolderPath } from './mobileWorkspaceFolders'
import type { MobileWorkspaceEdit, MobileWorkspaceEditResult } from './mobileWorkspaceEditing'
import type {
  MobileNote,
  MobileSavedView,
  MobileWorkspaceSnapshot,
} from './mobileWorkspaceModel'
import { noteWritePath } from './mobileWorkspacePathRewrites'

type MobileRestorationEdit = Extract<
  MobileWorkspaceEdit,
  { type: 'restoreFolder' | 'restoreNote' | 'restoreTypeDefinition' | 'restoreView' }
>
type RebuildSnapshot = (
  snapshot: MobileWorkspaceSnapshot,
  notes: MobileNote[],
  allNotes?: MobileNote[],
) => MobileWorkspaceSnapshot

export function applyMobileRestorationEdit(
  snapshot: MobileWorkspaceSnapshot,
  edit: MobileRestorationEdit,
  rebuildSnapshot: RebuildSnapshot,
): MobileWorkspaceEditResult {
  switch (edit.type) {
    case 'restoreFolder':
      return restoreMobileFolder(snapshot, edit.path)
    case 'restoreNote':
      return restoreMobileNote(snapshot, edit, rebuildSnapshot)
    case 'restoreTypeDefinition':
      return restoreMobileTypeDefinition(snapshot, edit, rebuildSnapshot)
    case 'restoreView':
      return restoreMobileView(snapshot, edit)
  }
}

function restoreMobileNote(
  snapshot: MobileWorkspaceSnapshot,
  edit: Extract<MobileRestorationEdit, { type: 'restoreNote' }>,
  rebuildSnapshot: RebuildSnapshot,
): MobileWorkspaceEditResult {
  const nextNotes = noteListWithRestoredNote(snapshot.notes, edit.note, edit.noteIndex)
  const nextAllNotes = snapshot.allNotes
    ? noteListWithRestoredNote(snapshot.allNotes, edit.note, edit.allNoteIndex)
    : undefined
  const nextSnapshot = rebuildSnapshot(
    { ...snapshot, allNotes: nextAllNotes, selectedNoteId: edit.note.id },
    nextNotes,
    nextAllNotes,
  )
  const existingNote = workspaceNoteById(snapshot, edit.note.id)
  const write = edit.note.rawContent === undefined
    ? null
    : {
      content: edit.note.rawContent,
      kind: existingNote ? 'saveNote' as const : 'createNote' as const,
      path: noteWritePath(edit.note),
    }

  return { snapshot: nextSnapshot, writes: write ? [write] : [] }
}

function restoreMobileFolder(
  snapshot: MobileWorkspaceSnapshot,
  folderPath: string,
): MobileWorkspaceEditResult {
  const path = normalizedMobileFolderPath(folderPath)
  if (!path) return { snapshot, writes: [] }

  const folderPaths = folderPathsWithRestoredPath(path, snapshot.folderPaths ?? [])
  return {
    snapshot: {
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
    },
    writes: [{ kind: 'createFolder', path }],
  }
}

function restoreMobileView(
  snapshot: MobileWorkspaceSnapshot,
  edit: Extract<MobileRestorationEdit, { type: 'restoreView' }>,
): MobileWorkspaceEditResult {
  const existingViews = (snapshot.views ?? []).filter((view) => view.id !== edit.view.id)
  const insertionIndex = boundedInsertionIndex(edit.viewIndex, existingViews.length)
  const views = orderedMobileSavedViews([
    ...existingViews.slice(0, insertionIndex),
    edit.view,
    ...existingViews.slice(insertionIndex),
  ])

  return {
    snapshot: snapshotWithViews(snapshot, views),
    writes: [{
      content: serializeMobileSavedViewDefinition(edit.view.definition),
      kind: 'saveView',
      path: mobileSavedViewPath(edit.view.filename),
    }],
  }
}

function restoreMobileTypeDefinition(
  snapshot: MobileWorkspaceSnapshot,
  edit: Extract<MobileRestorationEdit, { type: 'restoreTypeDefinition' }>,
  rebuildSnapshot: RebuildSnapshot,
): MobileWorkspaceEditResult {
  const existingDefinition = snapshot.typeDefinitions?.[edit.typeName]
  const typeDefinitions = {
    ...(snapshot.typeDefinitions ?? {}),
    [edit.typeName]: edit.definition,
  }

  return {
    snapshot: rebuildSnapshot({ ...snapshot, typeDefinitions }, snapshot.notes, snapshot.allNotes),
    writes: [{
      content: edit.definition.rawContent ?? mobileTypeDefinitionContent(edit.typeName, edit.definition, {}),
      kind: existingDefinition ? 'saveNote' : 'createNote',
      path: mobileTypeDefinitionPath(edit.typeName, edit.definition),
    }],
  }
}

function noteListWithRestoredNote(
  notes: MobileNote[],
  note: MobileNote,
  index: number | undefined,
): MobileNote[] {
  const withoutNote = notes.filter((candidate) => candidate.id !== note.id)
  const insertionIndex = boundedInsertionIndex(index, withoutNote.length)
  return [
    ...withoutNote.slice(0, insertionIndex),
    note,
    ...withoutNote.slice(insertionIndex),
  ]
}

function snapshotWithViews(
  snapshot: MobileWorkspaceSnapshot,
  views: MobileSavedView[],
): MobileWorkspaceSnapshot {
  return {
    ...snapshot,
    sidebarSections: buildMobileSidebarSections({
      allNotesFileVisibility: mobileAllNotesFileVisibilityFromVaultConfig(snapshot.vaultConfig),
      folderPaths: snapshot.folderPaths,
      notes: workspaceNotePool(snapshot),
      previousSections: snapshot.sidebarSections,
      typeDefinitions: snapshot.typeDefinitions,
      views,
    }),
    views,
  }
}

function workspaceNotePool(snapshot: MobileWorkspaceSnapshot): MobileNote[] {
  return snapshot.allNotes ?? snapshot.notes
}

function workspaceNoteById(snapshot: MobileWorkspaceSnapshot, noteId: string): MobileNote | null {
  return [
    ...snapshot.notes,
    ...(snapshot.allNotes ?? []),
  ].find((note) => note.id === noteId) ?? null
}

function folderPathsWithRestoredPath(path: string, folderPaths: string[]): string[] {
  const normalizedPaths = new Set(folderPaths.map(normalizedMobileFolderPath).filter(Boolean))
  normalizedPaths.add(path)
  return [...normalizedPaths]
}

function boundedInsertionIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isFinite(index)) return length
  return Math.max(0, Math.min(index, length))
}
