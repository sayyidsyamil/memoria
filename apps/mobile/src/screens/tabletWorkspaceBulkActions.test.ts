import { describe, expect, it } from 'vitest'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import {
  bulkArchiveNotesEdit,
  bulkDeleteNotesEdit,
  bulkOrganizeNotesEdit,
  tabletWorkspaceBulkNoteActions,
} from './tabletWorkspaceBulkActions'

describe('tablet workspace bulk actions', () => {
  it('builds desktop-compatible archive edits for trimmed note ids', () => {
    expect(bulkArchiveNotesEdit([' note-a.md ', '', 'note-b.md'], true)).toEqual({
      edits: [
        { archived: true, noteId: 'note-a.md', type: 'setArchived' },
        { archived: true, noteId: 'note-b.md', type: 'setArchived' },
      ],
      type: 'bulkEdit',
    })
    expect(bulkArchiveNotesEdit([' ', ''], false)).toBeNull()
  })

  it('builds desktop-compatible delete and organize edits', () => {
    expect(bulkDeleteNotesEdit([' note-a.md ', 'note-b.md'])).toEqual({
      edits: [
        { noteId: 'note-a.md', type: 'deleteNote' },
        { noteId: 'note-b.md', type: 'deleteNote' },
      ],
      type: 'bulkEdit',
    })
    expect(bulkOrganizeNotesEdit([' note-a.md ', 'note-b.md'])).toEqual({
      edits: [
        { noteId: 'note-a.md', organized: true, type: 'setOrganized' },
        { noteId: 'note-b.md', organized: true, type: 'setOrganized' },
      ],
      type: 'bulkEdit',
    })
    expect(bulkDeleteNotesEdit([])).toBeNull()
    expect(bulkOrganizeNotesEdit([])).toBeNull()
  })

  it('does not dispatch empty bulk edits from the action wrapper', () => {
    const edits: MobileWorkspaceEdit[] = []
    const actions = tabletWorkspaceBulkNoteActions((edit) => edits.push(edit))

    actions.onBulkArchiveNotes([''], true)
    actions.onBulkDeleteNotes([' '])
    actions.onBulkOrganizeNotes([])

    expect(edits).toEqual([])
  })
})
