import { mobileNoteActionMode } from './mobileNoteActionMode'
import type { MobileWorkspaceEdit, MobileWorkspaceEditResult } from './mobileWorkspaceEditing'
import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import type { ReadOnlyWorkspaceRequest } from './readOnlyWorkspaceRepository'

type WorkspaceSource = ReadOnlyWorkspaceRequest['source']

export type MobileNoteReadState = {
  status: 'ready' | 'loading' | 'error'
  retry: () => void
}

export function mobileNoteNeedsRead(note: MobileNote | null, source: WorkspaceSource): boolean {
  if (!source || source === 'fixture' || !note) return false
  return note.rawContent === undefined && mobileNoteActionMode(note) !== 'binary-file'
}

export function mobileNoteValidationKey(note: MobileNote | null, rootUri?: string | null): string | null {
  return note ? `${rootUri ?? ''}:${note.path ?? note.id}` : null
}

export function mobileNoteNeedsDiskValidation(note: MobileNote | null, source: WorkspaceSource, validatedKey: string | null, noteKey: string | null): boolean {
  return Boolean(note && source === 'native' && mobileNoteActionMode(note) !== 'binary-file' && validatedKey !== noteKey)
}

export function mobileNoteNeedsLoad(note: MobileNote | null, source: WorkspaceSource, validatedKey: string | null, noteKey: string | null): boolean {
  return mobileNoteNeedsRead(note, source) || mobileNoteNeedsDiskValidation(note, source, validatedKey, noteKey)
}

export function markNoteDiskValidated({ note, source, validatedKey, noteKey, setValidated }: {
  note: MobileNote | null
  source: WorkspaceSource
  validatedKey: string | null
  noteKey: string | null
  setValidated: (key: string) => void
}): () => void {
  return () => {
    if (mobileNoteNeedsDiskValidation(note, source, validatedKey, noteKey) && noteKey) setValidated(noteKey)
  }
}

export function mobileDiskHydration(note: MobileNote, rawContent: string) {
  return note.fileKind === 'text'
    ? { noteId: note.id, rawContent, refresh: true as const, type: 'hydrateTextFileContent' as const }
    : { noteId: note.id, rawContent, refresh: true as const, type: 'hydrateNoteContent' as const }
}

export function startValidatedMobileNoteRead({ applyEdit, note, onError, onValidated, read }: {
  applyEdit: (edit: MobileWorkspaceEdit) => MobileWorkspaceEditResult | null | Promise<MobileWorkspaceEditResult | null>
  note: MobileNote
  onError: () => void
  onValidated: () => void
  read: () => Promise<string | null>
}) {
  return startMobileNoteRead({
    read,
    onError,
    onContent: async rawContent => {
      const applied = await applyEdit(mobileDiskHydration(note, rawContent))
      if (containsDiskContent(applied, note, rawContent)) onValidated()
    },
  })
}

function containsDiskContent(result: MobileWorkspaceEditResult | null, note: MobileNote, rawContent: string): boolean {
  if (!result) return false
  const notes = result.snapshot.allNotes
    ? [...result.snapshot.notes, ...result.snapshot.allNotes]
    : result.snapshot.notes
  return notes.some(candidate => candidate.id === note.id && candidate.path === note.path && candidate.rawContent === rawContent)
}

export function isMobileNoteHydration(edit: MobileWorkspaceEdit): boolean {
  return edit.type === 'hydrateNoteContent' || edit.type === 'hydrateTextFileContent'
}

export function mobileEditNeedsNoteRead(edit: MobileWorkspaceEdit, snapshot: MobileWorkspaceSnapshot, source: WorkspaceSource): boolean {
  return mobileEditReadNotes(edit, snapshot, source).length > 0
}

export function mobileEditReadNotes(edit: MobileWorkspaceEdit, snapshot: MobileWorkspaceSnapshot, source: WorkspaceSource): MobileNote[] {
  if (isMobileNoteHydration(edit)) return []
  if (edit.type === 'bulkEdit') {
    const notes = edit.edits.flatMap((child) => mobileEditReadNotes(child, snapshot, source))
    return [...new Map(notes.map((note) => [note.id, note])).values()]
  }
  if (edit.type === 'moveFavorite') {
    return (snapshot.allNotes ?? snapshot.notes).filter((note) => note.favorite && mobileNoteNeedsRead(note, source))
  }
  return singleEditReadNotes(edit, snapshot, source)
}

function singleEditReadNotes(edit: MobileWorkspaceEdit, snapshot: MobileWorkspaceSnapshot, source: WorkspaceSource): MobileNote[] {
  const noteId = edit.type === 'createRelationshipTarget' ? edit.sourceNoteId : noteEditId(edit)
  if (!noteId) return []
  const note = snapshot.notes.find((item) => item.id === noteId)
    ?? snapshot.allNotes?.find((item) => item.id === noteId)
  return note && mobileNoteNeedsRead(note, source) ? [note] : []
}

function noteEditId(edit: MobileWorkspaceEdit): string | null {
  return 'noteId' in edit ? edit.noteId : null
}

export function startMobileNoteRead({ read, onContent, onError, timeoutMs }: {
  read: () => Promise<string | null>
  onContent: (content: string) => void | Promise<void>
  onError: () => void
  timeoutMs?: number
}) {
  let cancelled = false
  let settled = false
  let timeout: ReturnType<typeof setTimeout>
  const isActive = () => !cancelled && !settled
  const finished = new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout)
      resolve()
    }
    timeout = setTimeout(() => {
      if (isActive()) {
        settled = true
        onError()
      }
      finish()
    }, timeoutMs ?? 10_000)
    void readSelectedNote({
      isActive,
      markSettled: () => { settled = true },
      onContent,
      onError,
      read,
    }).finally(finish)
  })
  return { cancel: () => { cancelled = true; clearTimeout(timeout) }, finished }
}

async function readSelectedNote({ isActive, markSettled, onContent, onError, read }: {
  isActive: () => boolean
  markSettled: () => void
  onContent: (content: string) => void | Promise<void>
  onError: () => void
  read: () => Promise<string | null>
}) {
  try {
    const content = await read()
    if (!isActive()) return
    if (content === null) {
      markSettled()
      onError()
      return
    }
    await onContent(content)
    if (isActive()) markSettled()
  } catch {
    reportReadFailure(isActive, markSettled, onError)
  }
}

function reportReadFailure(isActive: () => boolean, markSettled: () => void, onError: () => void) {
  if (!isActive()) return
  markSettled()
  onError()
}
