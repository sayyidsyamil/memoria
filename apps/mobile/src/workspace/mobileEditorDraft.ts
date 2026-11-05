export const mobileEditorDraftCommitDelayMs = 250

export type MobileEditorDraftState = {
  dirty: boolean
  draftContent: string
  noteId: string
  savedContent: string
}

export function createMobileEditorDraft(noteId: string, content: string): MobileEditorDraftState {
  return {
    dirty: false,
    draftContent: content,
    noteId,
    savedContent: content,
  }
}

export function editMobileEditorDraft(
  state: MobileEditorDraftState,
  draftContent: string,
): MobileEditorDraftState {
  if (draftContent === state.draftContent) return state

  return {
    ...state,
    dirty: draftContent !== state.savedContent,
    draftContent,
  }
}

export function syncMobileEditorDraft(
  state: MobileEditorDraftState,
  incoming: { content: string; noteId: string },
): MobileEditorDraftState {
  if (incoming.noteId !== state.noteId) return createMobileEditorDraft(incoming.noteId, incoming.content)

  if (state.dirty) {
    return {
      ...state,
      dirty: state.draftContent !== incoming.content,
      savedContent: incoming.content,
    }
  }

  if (state.savedContent === incoming.content && state.draftContent === incoming.content) return state

  return createMobileEditorDraft(incoming.noteId, incoming.content)
}

export function commitMobileEditorDraft(state: MobileEditorDraftState): MobileEditorDraftState {
  if (!mobileEditorDraftNeedsCommit(state)) return state

  return {
    ...state,
    dirty: false,
    savedContent: state.draftContent,
  }
}

export function mobileEditorDraftNeedsCommit(state: MobileEditorDraftState): boolean {
  return state.dirty && state.draftContent !== state.savedContent
}
