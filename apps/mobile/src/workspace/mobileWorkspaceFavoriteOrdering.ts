import { writeMobileFrontmatterContentValue } from './mobileFrontmatterWrites'
import { isMobileMarkdownNote } from './mobileNoteFilters'
import { noteWritePath } from './mobileWorkspacePathRewrites'
import type {
  MobileNote,
  MobileWorkspaceSnapshot,
} from './mobileWorkspaceModel'

type NoteId = string
type FavoriteMoveDirection = 'down' | 'up'
type RebuildSnapshot = (
  snapshot: MobileWorkspaceSnapshot,
  notes: MobileNote[],
  allNotes?: MobileNote[],
) => MobileWorkspaceSnapshot

export type MobileFavoriteOrderWrite = {
  content: string
  kind: 'saveNote'
  path: string
}

export type MobileFavoriteOrderResult = {
  snapshot: MobileWorkspaceSnapshot
  writes: MobileFavoriteOrderWrite[]
}

type MoveMobileFavoriteInput = {
  direction: FavoriteMoveDirection
  noteId: NoteId
  rebuildSnapshot: RebuildSnapshot
  snapshot: MobileWorkspaceSnapshot
}

export function moveMobileFavorite({
  direction,
  noteId,
  rebuildSnapshot,
  snapshot,
}: MoveMobileFavoriteInput): MobileFavoriteOrderResult {
  const favorites = orderedFavorites(snapshot)
  const sourceIndex = favorites.findIndex((note) => note.id === noteId)
  const targetIndex = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1
  if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= favorites.length) return { snapshot, writes: [] }

  const reorderedFavorites = [...favorites]
  const [favorite] = reorderedFavorites.splice(sourceIndex, 1)
  if (!favorite) return { snapshot, writes: [] }
  reorderedFavorites.splice(targetIndex, 0, favorite)

  return applyFavoriteOrder({
    orderedNoteIds: reorderedFavorites.map((note) => note.id),
    rebuildSnapshot,
    snapshot,
  })
}

function orderedFavorites(snapshot: MobileWorkspaceSnapshot): MobileNote[] {
  return workspaceNotePool(snapshot)
    .filter((note) => note.favorite && !note.archived && isMobileMarkdownNote(note))
    .sort(compareFavoriteOrder)
}

function compareFavoriteOrder(left: MobileNote, right: MobileNote): number {
  const leftIndex = left.favoriteIndex ?? Infinity
  const rightIndex = right.favoriteIndex ?? Infinity
  return leftIndex === rightIndex ? 0 : leftIndex - rightIndex
}

function applyFavoriteOrder({
  orderedNoteIds,
  rebuildSnapshot,
  snapshot,
}: {
  orderedNoteIds: NoteId[]
  rebuildSnapshot: RebuildSnapshot
  snapshot: MobileWorkspaceSnapshot
}): MobileFavoriteOrderResult {
  const indexByNoteId = new Map(orderedNoteIds.map((id, index) => [id, index]))
  const notes = snapshot.notes.map((note) => noteWithFavoriteIndex(note, indexByNoteId))
  const allNotes = snapshot.allNotes?.map((note) => noteWithFavoriteIndex(note, indexByNoteId))
  const nextSnapshot = rebuildSnapshot({ ...snapshot, allNotes, notes }, notes, allNotes)

  return {
    snapshot: nextSnapshot,
    writes: favoriteOrderWrites(snapshot, nextSnapshot, orderedNoteIds),
  }
}

function noteWithFavoriteIndex(
  note: MobileNote,
  indexByNoteId: Map<NoteId, number>,
): MobileNote {
  const index = indexByNoteId.get(note.id)
  if (index === undefined) return note
  if (note.favoriteIndex === index) return note
  if (note.rawContent === undefined) return { ...note, favoriteIndex: index }

  return {
    ...note,
    favoriteIndex: index,
    rawContent: writeMobileFrontmatterContentValue(note.rawContent, '_favorite_index', index),
  }
}

function favoriteOrderWrites(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  orderedNoteIds: NoteId[],
): MobileFavoriteOrderWrite[] {
  const writes: MobileFavoriteOrderWrite[] = []
  for (const noteId of orderedNoteIds) {
    const previousNote = workspaceNoteById(previousSnapshot, noteId)
    const nextNote = workspaceNoteById(nextSnapshot, noteId)
    if (previousNote?.rawContent === undefined || nextNote?.rawContent === undefined) continue
    if (previousNote.rawContent === nextNote.rawContent) continue
    writes.push({ content: nextNote.rawContent, kind: 'saveNote', path: noteWritePath(nextNote) })
  }
  return writes
}

function workspaceNotePool(snapshot: MobileWorkspaceSnapshot): MobileNote[] {
  return snapshot.allNotes ?? snapshot.notes
}

function workspaceNoteById(snapshot: MobileWorkspaceSnapshot, noteId: NoteId): MobileNote | null {
  return [
    ...snapshot.notes,
    ...(snapshot.allNotes ?? []),
  ].find((note) => note.id === noteId) ?? null
}
