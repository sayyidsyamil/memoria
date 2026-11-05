import { describe, expect, it } from 'vitest'
import { primaryNoteListPropertiesEditFromForm } from './tabletWorkspacePrimaryNoteListSave'

describe('tablet workspace primary note-list save', () => {
  it('saves All Notes columns and file visibility as a desktop vault-config edit', () => {
    expect(primaryNoteListPropertiesEditFromForm({
      allNotesShowImages: true,
      allNotesShowPdfs: false,
      allNotesShowUnsupported: true,
      primaryDisplayProperties: [' status ', 'belongs_to', 'Status', ''],
      primaryItemId: 'all-notes',
    })).toEqual({
      allNotesFileVisibility: {
        images: true,
        pdfs: false,
        unsupported: true,
      },
      listPropertiesDisplay: ['status', 'belongs_to'],
      target: 'allNotes',
      type: 'updatePrimaryNoteListProperties',
    })
  })

  it('saves Inbox columns without All Notes-only file visibility', () => {
    expect(primaryNoteListPropertiesEditFromForm({
      allNotesShowImages: true,
      allNotesShowPdfs: true,
      allNotesShowUnsupported: true,
      primaryDisplayProperties: ['Priority', 'Status'],
      primaryItemId: 'inbox',
    })).toEqual({
      allNotesFileVisibility: undefined,
      listPropertiesDisplay: ['Priority', 'Status'],
      target: 'inbox',
      type: 'updatePrimaryNoteListProperties',
    })
  })

  it('rejects unsupported primary sidebar items', () => {
    expect(primaryNoteListPropertiesEditFromForm({
      allNotesShowImages: false,
      allNotesShowPdfs: false,
      allNotesShowUnsupported: false,
      primaryDisplayProperties: ['Status'],
      primaryItemId: 'archive',
    })).toBeNull()
  })
})
