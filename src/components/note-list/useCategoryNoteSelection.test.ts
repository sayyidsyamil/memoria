import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { VaultEntry, SidebarSelection } from '../../types'
import { useCategoryNoteSelection } from './useCategoryNoteSelection'

it('opens a matching note on category change without closing existing tabs', () => {
  const openNote = vi.fn()
  const entry = { path: 'meeting.md' } as VaultEntry
  const { rerender } = renderHook(({ selection, visible }) => useCategoryNoteSelection({
    selection, visible, selectedPath: 'person.md', loading: false, openNote,
  }), { initialProps: { selection: { kind: 'filter', filter: 'all' } as SidebarSelection, visible: [] as VaultEntry[] } })
  expect(openNote).not.toHaveBeenCalled()
  rerender({ selection: { kind: 'sectionGroup', type: 'Meeting' }, visible: [entry] })
  expect(openNote).toHaveBeenCalledExactlyOnceWith(entry)
})

it('keeps an already matching note selected and handles empty categories', () => {
  const openNote = vi.fn()
  const entry = { path: 'meeting.md' } as VaultEntry
  const { rerender } = renderHook(({ type, visible }) => useCategoryNoteSelection({
    selection: { kind: 'sectionGroup', type }, visible, selectedPath: entry.path, loading: false, openNote,
  }), { initialProps: { type: 'Person', visible: [entry] } })
  rerender({ type: 'Meeting', visible: [entry] })
  rerender({ type: 'Source', visible: [] })
  expect(openNote).not.toHaveBeenCalled()
})
