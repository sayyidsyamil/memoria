import type { MobileWorkspaceEdit, MobileWorkspaceEditResult } from './mobileWorkspaceEditing'

export function createMobileEditorFocus() {
  let pending: string | null = null
  return {
    request: (noteId: string) => { pending = noteId },
    has: (noteId: string) => pending === noteId,
    consume: (noteId: string) => {
      if (pending !== noteId) return false
      pending = null
      return true
    },
    clear: () => { pending = null },
  }
}

export function scheduleCreatedEditorFocus(options: {
  requests: ReturnType<typeof createMobileEditorFocus>
  noteId: string
  isReady: () => boolean
  focus: () => void
}) {
  const { requests, noteId, isReady, focus } = options
  const deadline = Date.now() + 10_000
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => { clearTimeout(timer); requests.consume(noteId) }
  const attempt = () => {
    if (!requests.has(noteId)) return
    if (Date.now() >= deadline) { cancel(); return }
    if (!isReady()) { timer = setTimeout(attempt, 50); return }
    if (requests.consume(noteId)) focus()
  }
  attempt()
  return cancel
}
export function requestCreatedNoteFocus(
  editors: { focus: ReturnType<typeof createMobileEditorFocus> } | null,
  edit: MobileWorkspaceEdit,
  result: MobileWorkspaceEditResult,
) {
  if (edit.type !== 'createNote' || result.writes.length === 0) return
  const noteId = result.snapshot.selectedNoteId
  if (noteId) editors?.focus.request(noteId)
}
