import { useEffect, useRef } from 'react'
import type { SidebarSelection, VaultEntry } from '../../types'

/** Category navigation opens a matching note through the normal save-safe path. */
export function useCategoryNoteSelection(options: {
  selection: SidebarSelection
  visible: VaultEntry[]
  selectedPath?: string
  loading: boolean
  openNote: (entry: VaultEntry) => unknown
}) {
  const { selection, visible, selectedPath, loading, openNote } = options
  const category = selection.kind === 'sectionGroup' ? selection.type : null
  const previous = useRef(category)
  const pending = useRef(false)

  useEffect(() => {
    if (previous.current !== category) {
      previous.current = category
      pending.current = category !== null
    }
    if (!pending.current || loading) return
    pending.current = false
    if (visible.some(entry => entry.path === selectedPath)) return
    const first = visible[0]
    if (first) void openNote(first)
  }, [category, loading, openNote, selectedPath, visible])
}
