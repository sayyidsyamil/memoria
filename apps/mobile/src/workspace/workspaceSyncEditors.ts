import { createContext, useContext, useEffect, useRef } from 'react'
import { createMobileEditorFocus } from './mobileEditorFocus'

export type PrepareEditorForSync = (deferWhileFocused?: boolean) => Promise<() => void>

export function createWorkspaceSyncEditors() {
  const editors = new Map<PrepareEditorForSync, string | undefined>()
  const dirtyListeners = new Set<(paths: readonly string[]) => void>()
  const focus = createMobileEditorFocus()
  let blocked = false
  let generation = 0
  let replacementSequence = 0
  return {
    focus,
    isBlocked: () => blocked,
    setBlocked: (value: boolean) => { blocked = value },
    generation: () => generation,
    beginReplacement: () => {
      focus.clear()
      const previous = generation
      const replacement = ++replacementSequence
      generation = replacement
      // Only a confirmed no-change cancellation may revive the frozen editor.
      return () => { if (generation === replacement) generation = previous }
    },
    markDirty: (paths: readonly string[] = []) => { for (const listener of dirtyListeners) listener(paths) },
    subscribeDirty: (listener: (paths: readonly string[]) => void) => {
      dirtyListeners.add(listener)
      return () => { dirtyListeners.delete(listener) }
    },
    selectedNoteId: () => [...editors.values()].filter(Boolean).at(-1),
    register: (prepare: PrepareEditorForSync, noteId?: string) => {
      editors.set(prepare, noteId)
      return () => { editors.delete(prepare) }
    },
    prepare: async (deferWhileFocused = false) => {
      const resumes: (() => void)[] = []
      const resume = () => { for (const action of resumes.splice(0).reverse()) action() }
      try {
        for (const prepare of editors.keys()) resumes.push(await prepare(deferWhileFocused))
        return resume
      } catch (error) {
        resume()
        throw error
      }
    },
  }
}

export const WorkspaceSyncEditorsContext = createContext<ReturnType<typeof createWorkspaceSyncEditors> | null>(null)
export const WorkspaceSnapshotRevisionContext = createContext(0)

export function useWorkspaceSyncEditor(prepare: PrepareEditorForSync, noteId?: string) {
  const registry = useContext(WorkspaceSyncEditorsContext)
  const prepareRef = useRef(prepare)
  useEffect(() => { prepareRef.current = prepare }, [prepare])
  useEffect(() => registry?.register(defer => prepareRef.current(defer), noteId), [noteId, registry])
}
