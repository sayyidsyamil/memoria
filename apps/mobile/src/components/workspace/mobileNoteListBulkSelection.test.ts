import { describe, expect, it } from 'vitest'
import {
  addMobileNoteListSelection,
  mobileNoteListSelectionIsArchived,
  pruneMobileNoteListSelection,
  selectedMobileNoteListIds,
  toggleMobileNoteListSelection,
} from './mobileNoteListBulkSelection'
import type { MobileNote } from '../../workspace/mobileWorkspaceModel'

describe('mobile note-list bulk selection', () => {
  it('adds, toggles, and prunes selected note ids without mutating the source set', () => {
    const first = new Set(['workflow'])
    const added = addMobileNoteListSelection(first, 'open-source')
    const toggled = toggleMobileNoteListSelection(added, 'workflow')
    const pruned = pruneMobileNoteListSelection(toggled, ['workflow', 'release'])

    expect([...first]).toEqual(['workflow'])
    expect([...added]).toEqual(['workflow', 'open-source'])
    expect([...toggled]).toEqual(['open-source'])
    expect([...pruned]).toEqual([])
  })

  it('returns selected note ids in visible note order', () => {
    expect(selectedMobileNoteListIds([
      note({ id: 'workflow' }),
      note({ id: 'open-source' }),
      note({ id: 'release' }),
    ], new Set(['release', 'workflow']))).toEqual(['workflow', 'release'])
  })

  it('detects archive mode only when every selected note is archived', () => {
    expect(mobileNoteListSelectionIsArchived([
      note({ archived: true, id: 'workflow' }),
      note({ archived: true, id: 'open-source' }),
    ])).toBe(true)
    expect(mobileNoteListSelectionIsArchived([
      note({ archived: true, id: 'workflow' }),
      note({ id: 'open-source' }),
    ])).toBe(false)
  })
})

function note(input: Partial<MobileNote> & Pick<MobileNote, 'id'>): MobileNote {
  return {
    archived: false,
    created: 'today',
    date: 'today',
    favorite: false,
    links: 0,
    modified: 'today',
    path: input.id,
    properties: [],
    relationships: [],
    snippet: '',
    status: '',
    tags: [],
    title: input.id,
    type: 'Note',
    typeTone: 'gray',
    workspace: 'Memoria',
    ...input,
    id: input.id,
  }
}
