import { describe, expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import * as savedViews from '../workspace/mobileSavedViews'
import { noteListFilterCountsForSelection, noteListPropertiesForSelection, notesForSidebarSelection } from './tabletWorkspaceNavigation'

describe('tablet navigation work', () => {
  it('counts open and archived type notes without sorting them', () => {
    const snapshot = workspaceScenarioForId('default')
    const sort = vi.spyOn(savedViews, 'sortMobileNotesBySort')
    const selection = { id: 'type-essay', kind: 'item', label: 'Essays', sectionId: 'types', typeName: 'Essay' } as const
    try {
      expect(noteListFilterCountsForSelection(snapshot, selection)).toEqual({ archived: 0, open: 1 })
      expect(sort).not.toHaveBeenCalled()
    } finally {
      sort.mockRestore()
    }
  })

  it('never resolves inherited object methods as section handlers', () => {
    const snapshot = workspaceScenarioForId('default')
    const selection = { id: 'all-notes', kind: 'item', label: 'All Notes', sectionId: 'constructor' } as const
    expect(notesForSidebarSelection(snapshot, selection)).toEqual(snapshot.notes)
    expect(noteListPropertiesForSelection(snapshot, selection)).toEqual([])
  })
})
