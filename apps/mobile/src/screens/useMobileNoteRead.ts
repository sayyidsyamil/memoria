import { useCallback, useEffect, useRef, useState } from 'react'
import { markNoteDiskValidated, mobileNoteNeedsLoad, mobileNoteValidationKey, startValidatedMobileNoteRead, type MobileNoteReadState } from '../workspace/mobileNoteRead'
import type { MobileWorkspaceEdit, MobileWorkspaceEditResult } from '../workspace/mobileWorkspaceEditing'
import type { MobileNote } from '../workspace/mobileWorkspaceModel'
import type { ReadOnlyWorkspaceRepository, ReadOnlyWorkspaceRequest } from '../workspace/readOnlyWorkspaceRepository'

export function useMobileNoteRead({ applyEdit, note, repository, request }: {
  applyEdit: (edit: MobileWorkspaceEdit) => MobileWorkspaceEditResult | null | Promise<MobileWorkspaceEditResult | null>
  note: MobileNote | null
  repository: ReadOnlyWorkspaceRepository
  request?: ReadOnlyWorkspaceRequest
}): MobileNoteReadState {
  const [failedNoteKey, setFailedNoteKey] = useState<string | null>(null)
  const [validatedNoteKey, setValidatedNoteKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const applyEditRef = useRef(applyEdit)
  const noteRef = useRef(note)
  const noteKey = mobileNoteValidationKey(note, request?.vaultRootUri)
  const needsRead = mobileNoteNeedsLoad(note, request?.source, validatedNoteKey, noteKey)
  const applyLatestEdit = useCallback((edit: MobileWorkspaceEdit) => applyEditRef.current(edit), [])
  useEffect(() => {
    applyEditRef.current = applyEdit
    noteRef.current = note
  }, [applyEdit, note])
  useEffect(() => {
    const selectedNote = noteRef.current
    if (!selectedNote || !needsRead) return
    const operation = startValidatedMobileNoteRead({
      applyEdit: applyLatestEdit,
      note: selectedNote,
      onError: () => setFailedNoteKey(noteKey),
      onValidated: markNoteDiskValidated({ note: selectedNote, source: request?.source, validatedKey: validatedNoteKey, noteKey, setValidated: setValidatedNoteKey }),
      read: () => repository.readNoteContent(noteRef.current ?? selectedNote, request),
    })
    return operation.cancel
  }, [applyLatestEdit, attempt, needsRead, noteKey, repository, request, validatedNoteKey])

  const retry = useCallback(() => {
    setFailedNoteKey(null)
    setAttempt((current) => current + 1)
  }, [])
  if (!needsRead) return { status: 'ready', retry }
  return { status: failedNoteKey === noteKey ? 'error' : 'loading', retry }
}
