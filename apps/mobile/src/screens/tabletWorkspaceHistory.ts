import type {
  MobileAllNotesFileVisibility,
  MobileNote,
  MobileNoteWidth,
  MobileSavedView,
  MobileTypeDefinition,
  MobileWorkspaceSnapshot,
} from '../workspace/mobileWorkspaceModel'
import {
  normalizedDisplayProperties,
  type MobileWorkspaceEdit,
} from '../workspace/mobileWorkspaceEditing'
import { mobileNoteEditableContent } from '../workspace/mobileDocumentContent'
import {
  mobileAllNotesFileVisibilityFromVaultConfig,
  mobileDefaultNoteWidthFromVaultConfig,
} from '../workspace/mobileVaultConfig'
import { mobileNoteActionMode } from '../workspace/mobileNoteActionMode'
import { mobileWorkspacePathHistoryEntry } from './tabletWorkspacePathHistory'

type WorkspaceHistoryEdit = MobileWorkspaceEdit
type ViewHistoryComparison = {
  previousViews: MobileSavedView[]
  nextViews: MobileSavedView[]
}

export type MobileWorkspaceHistoryEntry = {
  redoEdits: WorkspaceHistoryEdit[]
  undoEdits: WorkspaceHistoryEdit[]
}

export type MobileWorkspaceHistoryState = {
  future: MobileWorkspaceHistoryEntry[]
  past: MobileWorkspaceHistoryEntry[]
}

const maxWorkspaceHistoryEntries = 100

export const emptyMobileWorkspaceHistory: MobileWorkspaceHistoryState = {
  future: [],
  past: [],
}

export function mobileWorkspaceHistoryEntry(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  sourceEdit?: MobileWorkspaceEdit,
): MobileWorkspaceHistoryEntry | null {
  if (sourceEdit && !historyRecordsEdit(sourceEdit)) return null
  const pathHistoryEntry = mobileWorkspacePathHistoryEntry(previousSnapshot, nextSnapshot, sourceEdit)
  if (pathHistoryEntry) return pathHistoryEntry
  const defaultNoteWidthHistory = defaultNoteWidthHistoryEntry(previousSnapshot, nextSnapshot, sourceEdit)
  if (defaultNoteWidthHistory) return defaultNoteWidthHistory
  const primaryListHistoryEntry = primaryNoteListPropertiesHistoryEntry(previousSnapshot, nextSnapshot, sourceEdit)
  if (primaryListHistoryEntry) return primaryListHistoryEntry

  const edits = emptyHistoryEntry()
  recordRemovedFolderHistory(edits, previousSnapshot, nextSnapshot)
  recordAddedFolderHistory(edits, previousSnapshot, nextSnapshot)
  recordViewHistory(edits, previousSnapshot, nextSnapshot)
  recordTypeDefinitionHistory(edits, previousSnapshot, nextSnapshot)
  recordContentHistory(edits, previousSnapshot, nextSnapshot)
  recordNoteHistory(edits, previousSnapshot, nextSnapshot)

  return edits.undoEdits.length > 0 ? edits : null
}

export function recordMobileWorkspaceHistory(
  history: MobileWorkspaceHistoryState,
  entry: MobileWorkspaceHistoryEntry | null,
): MobileWorkspaceHistoryState {
  if (!entry) return history

  return {
    future: [],
    past: [...history.past, entry].slice(-maxWorkspaceHistoryEntries),
  }
}

function recordContentHistory(
  entry: MobileWorkspaceHistoryEntry,
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
) {
  const nextNotesById = new Map(workspaceNotes(nextSnapshot).map((note) => [note.id, note]))
  for (const previousNote of workspaceNotes(previousSnapshot)) {
    const reversible = reversibleContentChange({
      nextNote: nextNotesById.get(previousNote.id),
      nextSnapshot,
      previousNote,
      previousSnapshot,
    })
    if (!reversible) continue

    entry.undoEdits.push(reversible.undoEdit)
    entry.redoEdits.push(reversible.redoEdit)
  }
}

function recordNoteHistory(
  entry: MobileWorkspaceHistoryEntry,
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
) {
  const previousNotesById = new Map(workspaceNotes(previousSnapshot).map((note) => [note.id, note]))
  const nextNotesById = new Map(workspaceNotes(nextSnapshot).map((note) => [note.id, note]))

  for (const note of workspaceNotes(nextSnapshot)) {
    if (previousNotesById.has(note.id)) continue
    entry.undoEdits.push({ noteId: note.id, type: 'deleteNote' })
    entry.redoEdits.push(restoreNoteEdit(note, nextSnapshot))
  }

  for (const note of workspaceNotes(previousSnapshot)) {
    if (nextNotesById.has(note.id)) continue
    entry.undoEdits.push(restoreNoteEdit(note, previousSnapshot))
    entry.redoEdits.push({ noteId: note.id, type: 'deleteNote' })
  }
}

function recordRemovedFolderHistory(
  entry: MobileWorkspaceHistoryEntry,
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
) {
  const nextPaths = normalizedFolderPathSet(nextSnapshot)
  for (const path of normalizedFolderPaths(previousSnapshot)) {
    if (nextPaths.has(path)) continue
    entry.undoEdits.unshift({ path, type: 'restoreFolder' })
    entry.redoEdits.push({ folderPath: path, type: 'deleteFolder' })
  }
}

function recordAddedFolderHistory(
  entry: MobileWorkspaceHistoryEntry,
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
) {
  const previousPaths = normalizedFolderPathSet(previousSnapshot)
  for (const path of normalizedFolderPaths(nextSnapshot)) {
    if (previousPaths.has(path)) continue
    entry.undoEdits.push({ folderPath: path, type: 'deleteFolder' })
    entry.redoEdits.unshift({ path, type: 'restoreFolder' })
  }
}

function recordViewHistory(
  entry: MobileWorkspaceHistoryEntry,
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
) {
  const previousViews = previousSnapshot.views ?? []
  const nextViews = nextSnapshot.views ?? []
  const previousViewsById = new Map(previousViews.map((view) => [view.id, view]))
  const nextViewsById = new Map(nextViews.map((view) => [view.id, view]))

  for (const view of nextViews) {
    const previousView = previousViewsById.get(view.id)
    recordNextViewHistory(entry, view, previousView, { previousViews, nextViews })
  }

  for (const view of previousViews) {
    if (nextViewsById.has(view.id)) continue
    entry.undoEdits.push(restoreViewEdit(view, previousViews))
    entry.redoEdits.push({ viewId: view.id, type: 'deleteView' })
  }
}

function recordNextViewHistory(
  entry: MobileWorkspaceHistoryEntry,
  view: MobileSavedView,
  previousView: MobileSavedView | undefined,
  views: ViewHistoryComparison,
) {
  if (!previousView) {
    entry.undoEdits.push({ viewId: view.id, type: 'deleteView' })
    entry.redoEdits.push(restoreViewEdit(view, views.nextViews))
  } else if (!sameJson(previousView, view)) {
    entry.undoEdits.push(restoreViewEdit(previousView, views.previousViews))
    entry.redoEdits.push(restoreViewEdit(view, views.nextViews))
  }
}

function recordTypeDefinitionHistory(
  entry: MobileWorkspaceHistoryEntry,
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
) {
  const { previousDefinitions, nextDefinitions } = historyTypeDefinitions(previousSnapshot, nextSnapshot)
  const typeNames = new Set([...Object.keys(previousDefinitions), ...Object.keys(nextDefinitions)])

  for (const typeName of typeNames) {
    const previousDefinition = previousDefinitions[typeName]
    const nextDefinition = nextDefinitions[typeName]
    if (previousDefinition && nextDefinition && sameJson(previousDefinition, nextDefinition)) continue

    entry.undoEdits.push(typeDefinitionHistoryEdit(typeName, previousDefinition))
    entry.redoEdits.push(typeDefinitionHistoryEdit(typeName, nextDefinition))
  }
}

function historyTypeDefinitions(previousSnapshot: MobileWorkspaceSnapshot, nextSnapshot: MobileWorkspaceSnapshot) {
  return {
    previousDefinitions: previousSnapshot.typeDefinitions ?? {},
    nextDefinitions: nextSnapshot.typeDefinitions ?? {},
  }
}

function typeDefinitionHistoryEdit(typeName: string, definition: MobileTypeDefinition | undefined): MobileWorkspaceEdit {
  return definition
    ? { definition, type: 'restoreTypeDefinition', typeName }
    : { type: 'deleteTypeDefinition', typeName }
}

function primaryNoteListPropertiesHistoryEntry(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  sourceEdit: MobileWorkspaceEdit | undefined,
): MobileWorkspaceHistoryEntry | null {
  if (sourceEdit?.type !== 'updatePrimaryNoteListProperties') return null

  const includeVisibility = shouldRecordAllNotesFileVisibility(previousSnapshot, nextSnapshot, sourceEdit)
  const previousSettings = primaryNoteListSettings(previousSnapshot, sourceEdit.target, includeVisibility)
  const nextSettings = primaryNoteListSettings(nextSnapshot, sourceEdit.target, includeVisibility)
  if (samePrimaryNoteListSettings(previousSettings, nextSettings)) return null

  return {
    redoEdits: [primaryNoteListHistoryEdit(sourceEdit.target, nextSettings)],
    undoEdits: [primaryNoteListHistoryEdit(sourceEdit.target, previousSettings)],
  }
}

function defaultNoteWidthHistoryEntry(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  sourceEdit: MobileWorkspaceEdit | undefined,
): MobileWorkspaceHistoryEntry | null {
  if (sourceEdit?.type !== 'setDefaultNoteWidth') return null

  const previousMode = defaultNoteWidthHistoryMode(previousSnapshot)
  const nextMode = defaultNoteWidthHistoryMode(nextSnapshot)
  if (previousMode === nextMode) return null

  return {
    redoEdits: [{ mode: nextMode, type: 'setDefaultNoteWidth' }],
    undoEdits: [{ mode: previousMode, type: 'setDefaultNoteWidth' }],
  }
}

function reversibleContentChange({
  nextNote,
  nextSnapshot,
  previousNote,
  previousSnapshot,
}: {
  nextNote: MobileNote | undefined
  nextSnapshot: MobileWorkspaceSnapshot
  previousNote: MobileNote
  previousSnapshot: MobileWorkspaceSnapshot
}): { redoEdit: WorkspaceHistoryEdit; undoEdit: WorkspaceHistoryEdit } | null {
  if (!nextNote || !stableEditableNote(previousNote, nextNote)) return null
  const previousContent = editableContent(previousNote, previousSnapshot)
  const nextContent = editableContent(nextNote, nextSnapshot)
  if (previousContent === null || nextContent === null) return null
  if (previousContent === nextContent) return null

  return reversibleContentEdits({
    contentKind: noteContentHistoryKind(previousNote, nextNote),
    nextContent,
    noteId: previousNote.id,
    previousContent,
  })
}

function reversibleContentEdits({
  contentKind,
  nextContent,
  noteId,
  previousContent,
}: {
  contentKind: 'markdown' | 'text' | null
  nextContent: string
  noteId: string
  previousContent: string
}): { redoEdit: WorkspaceHistoryEdit; undoEdit: WorkspaceHistoryEdit } | null {
  if (!contentKind) return null

  return contentKind === 'text'
    ? {
      redoEdit: { content: nextContent, noteId, type: 'updateTextFileContent' },
      undoEdit: { content: previousContent, noteId, type: 'updateTextFileContent' },
    }
    : {
      redoEdit: { content: nextContent, noteId, type: 'updateNoteContent' },
      undoEdit: { content: previousContent, noteId, type: 'updateNoteContent' },
    }
}

function stableEditableNote(previousNote: MobileNote, nextNote: MobileNote): boolean {
  return previousNote.id === nextNote.id
    && notePath(previousNote) === notePath(nextNote)
    && noteContentKind(previousNote) === noteContentKind(nextNote)
}

function noteContentHistoryKind(
  previousNote: MobileNote,
  nextNote: MobileNote,
): 'markdown' | 'text' | null {
  const kind = noteContentKind(previousNote)
  if (kind === 'binary' || noteContentKind(nextNote) === 'binary') return null
  return kind
}

function noteContentKind(note: MobileNote): 'binary' | 'markdown' | 'text' {
  const actionMode = mobileNoteActionMode(note)
  if (actionMode === 'binary-file') return 'binary'
  return actionMode === 'text-file' ? 'text' : 'markdown'
}

function editableContent(note: MobileNote, snapshot: MobileWorkspaceSnapshot): string | null {
  if (note.rawContent !== undefined) return note.rawContent
  if (noteContentKind(note) !== 'markdown') return null
  return mobileNoteEditableContent(noteWithSnapshotEditorContent(note, snapshot))
}

function historyRecordsEdit(edit: MobileWorkspaceEdit): boolean {
  return edit.type !== 'hydrateNoteContent'
    && edit.type !== 'hydrateTextFileContent'
    && edit.type !== 'restoreFolder'
    && edit.type !== 'restoreNote'
    && edit.type !== 'restoreTypeDefinition'
    && edit.type !== 'restoreView'
}

function noteWithSnapshotEditorContent(note: MobileNote, snapshot: MobileWorkspaceSnapshot): MobileNote {
  if (snapshot.selectedNoteId !== note.id) return note

  return {
    ...note,
    editorBlocks: note.editorBlocks ?? snapshot.editorBlocks,
    editorBullets: note.editorBullets ?? snapshot.editorBullets,
  }
}

function notePath(note: MobileNote): string {
  return note.path ?? note.id
}

function workspaceNotes(snapshot: MobileWorkspaceSnapshot): MobileNote[] {
  return snapshot.allNotes ?? snapshot.notes
}

function emptyHistoryEntry(): MobileWorkspaceHistoryEntry {
  return { redoEdits: [], undoEdits: [] }
}

function restoreNoteEdit(note: MobileNote, snapshot: MobileWorkspaceSnapshot): WorkspaceHistoryEdit {
  return {
    allNoteIndex: snapshot.allNotes?.findIndex((candidate) => candidate.id === note.id),
    note,
    noteIndex: snapshot.notes.findIndex((candidate) => candidate.id === note.id),
    type: 'restoreNote',
  }
}

function restoreViewEdit(view: MobileSavedView, views: MobileSavedView[]): WorkspaceHistoryEdit {
  return {
    type: 'restoreView',
    view,
    viewIndex: views.findIndex((candidate) => candidate.id === view.id),
  }
}

function normalizedFolderPaths(snapshot: MobileWorkspaceSnapshot): string[] {
  return [...new Set((snapshot.folderPaths ?? []).map(normalizedFolderPath).filter(Boolean))]
}

function normalizedFolderPathSet(snapshot: MobileWorkspaceSnapshot): Set<string> {
  return new Set(normalizedFolderPaths(snapshot))
}

function normalizedFolderPath(path: string): string {
  return path.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '').replace(/\/+/gu, '/')
}

function sameJson(left: MobileSavedView | MobileTypeDefinition, right: MobileSavedView | MobileTypeDefinition): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function primaryNoteListProperties(
  snapshot: MobileWorkspaceSnapshot,
  target: 'allNotes' | 'inbox',
): string[] {
  return normalizedDisplayProperties(snapshot.noteListPropertyOverrides?.[target] ?? [])
}

function defaultNoteWidthHistoryMode(snapshot: MobileWorkspaceSnapshot): MobileNoteWidth {
  return mobileDefaultNoteWidthFromVaultConfig(snapshot.vaultConfig) ?? 'normal'
}

function primaryNoteListSettings(
  snapshot: MobileWorkspaceSnapshot,
  target: 'allNotes' | 'inbox',
  includeVisibility: boolean,
) {
  return {
    allNotesFileVisibility: target === 'allNotes' && includeVisibility
      ? mobileAllNotesFileVisibilityFromVaultConfig(snapshot.vaultConfig)
      : undefined,
    listPropertiesDisplay: primaryNoteListProperties(snapshot, target),
  }
}

function primaryNoteListHistoryEdit(
  target: 'allNotes' | 'inbox',
  settings: ReturnType<typeof primaryNoteListSettings>,
): WorkspaceHistoryEdit {
  const edit: Extract<WorkspaceHistoryEdit, { type: 'updatePrimaryNoteListProperties' }> = {
    listPropertiesDisplay: settings.listPropertiesDisplay,
    target,
    type: 'updatePrimaryNoteListProperties',
  }
  if (settings.allNotesFileVisibility) edit.allNotesFileVisibility = settings.allNotesFileVisibility
  return edit
}

function shouldRecordAllNotesFileVisibility(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  sourceEdit: Extract<MobileWorkspaceEdit, { type: 'updatePrimaryNoteListProperties' }>,
) {
  return sourceEdit.target === 'allNotes'
    && (
      sourceEdit.allNotesFileVisibility !== undefined
      || previousSnapshot.vaultConfig?.allNotes?.fileVisibility !== undefined
      || nextSnapshot.vaultConfig?.allNotes?.fileVisibility !== undefined
    )
}

function samePrimaryNoteListSettings(
  left: ReturnType<typeof primaryNoteListSettings>,
  right: ReturnType<typeof primaryNoteListSettings>,
) {
  return sameList(left.listPropertiesDisplay, right.listPropertiesDisplay)
    && sameAllNotesFileVisibility(left.allNotesFileVisibility, right.allNotesFileVisibility)
}

function sameAllNotesFileVisibility(
  left: MobileAllNotesFileVisibility | undefined,
  right: MobileAllNotesFileVisibility | undefined,
) {
  if (!left || !right) return left === right
  return left.images === right.images && left.pdfs === right.pdfs && left.unsupported === right.unsupported
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
