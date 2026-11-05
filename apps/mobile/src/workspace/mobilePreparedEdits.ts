import { isMobileNoteHydration, mobileEditReadNotes, mobileNoteNeedsRead } from './mobileNoteRead'
import { mobileNoteActionMode } from './mobileNoteActionMode'
import type { MobileWorkspaceEdit, MobileWorkspaceEditResult } from './mobileWorkspaceEditing'
import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import type { ReadOnlyWorkspaceRequest } from './readOnlyWorkspaceRepository'

type PreparedEditServices = {
  apply: (edit: MobileWorkspaceEdit) => MobileWorkspaceEditResult
  isCurrent: () => boolean
  read: (note: MobileNote) => Promise<string | null>
  snapshot: () => MobileWorkspaceSnapshot
  source: ReadOnlyWorkspaceRequest['source']
}
type PreparedNote = { note: MobileNote; rawContent: string }

export function createMobilePreparedEdits(services: PreparedEditServices) {
  let pending: Promise<MobileWorkspaceEditResult> | null = null
  const unchanged = () => ({ snapshot: services.snapshot(), writes: [] })

  const run = (edit: MobileWorkspaceEdit, commit: () => MobileWorkspaceEditResult): MobileWorkspaceEditResult | Promise<MobileWorkspaceEditResult> => {
    if (!services.isCurrent()) return unchanged()
    const notes = mobileEditReadNotes(edit, services.snapshot(), services.source)
    if (!notes.length) return commit()
    return prepare(notes, services, commit)
  }

  return {
    apply: (edit: MobileWorkspaceEdit, commit = () => services.apply(edit)) => {
      // Editor saves must enqueue disk writes before the editor's save barrier returns.
      if (isImmediateContentEdit(edit)) return run(edit, commit)
      const result = pending ? pending.then(() => run(edit, commit), () => run(edit, commit)) : run(edit, commit)
      if (!(result instanceof Promise)) return result
      pending = result
      const clear = () => { if (pending === result) pending = null }
      void result.then(clear, clear)
      return result
    },
    whenIdle: async () => { while (pending) await pending },
  }
}

async function prepare(notes: MobileNote[], services: PreparedEditServices, commit: () => MobileWorkspaceEditResult) {
  const contents: PreparedNote[] = []
  for (const note of notes) {
    const rawContent = await services.read(note)
    if (!services.isCurrent()) return { snapshot: services.snapshot(), writes: [] }
    if (rawContent === null) throw new Error('mobileNoteReadFailed')
    contents.push({ note, rawContent })
  }
  // Do not publish a partial action when any required file is unavailable.
  for (const { note } of contents) requirePreparedNote(services.snapshot(), note)
  for (const content of contents) hydratePreparedNote(content, services)
  return commit()
}

function hydratePreparedNote({ note, rawContent }: PreparedNote, services: PreparedEditServices) {
  const current = requirePreparedNote(services.snapshot(), note)
  if (!mobileNoteNeedsRead(current, services.source)) return
  services.apply({
    type: mobileNoteActionMode(current) === 'text-file' ? 'hydrateTextFileContent' : 'hydrateNoteContent',
    noteId: note.id, rawContent,
  })
}

function requirePreparedNote(snapshot: MobileWorkspaceSnapshot, note: MobileNote) {
  const current = currentNote(snapshot, note.id)
  if (!current || current.path !== note.path) throw new Error('mobileNoteReadFailed')
  return current
}

function currentNote(snapshot: MobileWorkspaceSnapshot, id: string) {
  return snapshot.notes.find((note) => note.id === id) ?? snapshot.allNotes?.find((note) => note.id === id)
}

function isImmediateContentEdit(edit: MobileWorkspaceEdit) {
  return isMobileNoteHydration(edit) || edit.type === 'updateNoteContent' || edit.type === 'updateTextFileContent'
}
