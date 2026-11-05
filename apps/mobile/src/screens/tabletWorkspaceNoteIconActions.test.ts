import { describe, expect, it } from 'vitest'
import {
  removeNoteIconEdit,
  setNoteIconEditFromForm,
} from './tabletWorkspaceNoteIconActions'

describe('tablet workspace note icon actions', () => {
  it('writes note icons through the desktop _icon frontmatter property', () => {
    expect(setNoteIconEditFromForm({
      noteIcon: '  sparkle  ',
    }, ' workflow-orchestration ')).toEqual({
      key: '_icon',
      noteId: 'workflow-orchestration',
      type: 'updateProperty',
      value: 'sparkle',
    })
    expect(setNoteIconEditFromForm({ noteIcon: ' ' }, 'workflow-orchestration')).toBeNull()
    expect(setNoteIconEditFromForm({ noteIcon: 'sparkle' }, ' ')).toBeNull()
  })

  it('removes note icons through the desktop _icon frontmatter property', () => {
    expect(removeNoteIconEdit(' workflow-orchestration ')).toEqual({
      key: '_icon',
      noteId: 'workflow-orchestration',
      type: 'deleteProperty',
    })
    expect(removeNoteIconEdit(' ')).toBeNull()
  })
})
