import { useCallback, useContext, useLayoutEffect, useRef, useState } from 'react'
import { WorkspaceSyncEditorsContext } from '../workspace/workspaceSyncEditors'

export function useEditorModeSwitch(noteId: string | undefined, changeMode: () => void) {
  const editors = useContext(WorkspaceSyncEditorsContext)
  const generation = useRef(Symbol(noteId))
  const busy = useRef(false)
  const [status, setStatus] = useState({ noteId, failed: false })
  if (status.noteId !== noteId) setStatus({ noteId, failed: false })
  useLayoutEffect(() => {
    generation.current = Symbol(noteId)
    return () => { generation.current = Symbol() }
  }, [noteId])

  const toggle = useCallback(() => {
    if (busy.current) return
    busy.current = true
    const requested = generation.current
    void (async () => {
      try {
        const resume = await editors?.prepare()
        try {
          if (requested === generation.current) { changeMode(); setStatus({ noteId, failed: false }) }
        } finally { resume?.() }
      } catch {
        if (requested === generation.current) setStatus({ noteId, failed: true })
      } finally { busy.current = false }
    })()
  }, [changeMode, editors, noteId])
  return { toggle, failed: status.noteId === noteId && status.failed }
}
