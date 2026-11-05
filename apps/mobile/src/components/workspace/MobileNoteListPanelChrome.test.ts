import { describe, expect, it } from 'vitest'
import {
  mobileNoteListEmptyStateChrome,
  mobileNoteListCreateChrome,
  mobileNoteListFilterOptions,
  mobileNoteListToolbarChrome,
} from './MobileNoteListPanelChrome'

describe('mobile note-list panel chrome', () => {
  it('keeps search in the header and direct create in a separate large action', () => {
    expect(mobileNoteListToolbarChrome.actionTestIds).toEqual([
      'note-list-search-action',
    ])
    expect(mobileNoteListCreateChrome.testID).toBe('note-list-create-action')
    expect(mobileNoteListCreateChrome.diameter).toBeGreaterThanOrEqual(44)
  })

  it('does not reserve toolbar chrome for open/archive selectors', () => {
    expect(mobileNoteListToolbarChrome.actionTestIds.join(' ')).not.toMatch(/open|archive|filter|selector/u)
  })

  it('keeps the bottom filter pills aligned with desktop labels and order', () => {
    expect(mobileNoteListFilterOptions).toEqual([
      { labelKey: 'noteList.filter.open', value: 'open' },
      { labelKey: 'noteList.filter.archived', value: 'archived' },
    ])
  })

  it('offers the vault picker only for an empty workspace, not empty filters', () => {
    expect(mobileNoteListEmptyStateChrome({ emptyVault: true })).toEqual({
      action: 'openVault',
      detailKey: null,
      titleKey: 'noteList.empty.noNotes',
    })
    expect(mobileNoteListEmptyStateChrome({ emptyVault: false })).toEqual({
      action: null,
      detailKey: 'noteList.empty.noNotes',
      titleKey: 'noteList.empty.allOrganized',
    })
    expect(mobileNoteListEmptyStateChrome({ emptyVault: true, searchQuery: 'roadmap' })).toEqual({
      action: null,
      detailKey: 'noteList.empty.noNotes',
      titleKey: 'noteList.empty.noMatching',
    })
  })
})
