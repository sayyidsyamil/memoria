import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEdit } from './mobileWorkspaceEditing'

describe('mobile organized metadata parity', () => {
  it('treats non-underscored organized frontmatter as a desktop custom property', () => {
    const base = workspaceScenarioForId('default')
    const customOrganizedNote = {
      ...base.notes[0],
      archived: false,
      organized: false,
      rawContent: '---\ntype: Essay\norganized: true\n---\n# Custom Organized\n',
      title: 'Custom Organized',
      type: 'Essay',
    }

    const snapshot = applyMobileWorkspaceEdit({
      ...base,
      allNotes: [customOrganizedNote],
      notes: [customOrganizedNote],
      selectedNoteId: customOrganizedNote.id,
    }, {
      noteId: customOrganizedNote.id,
      rawContent: customOrganizedNote.rawContent,
      type: 'hydrateNoteContent',
    })

    expect(snapshot.notes[0]).toMatchObject({
      organized: false,
      properties: expect.arrayContaining([
        expect.objectContaining({ key: 'organized', value: true }),
      ]),
    })
    expect(snapshot.noteListSubtitle).toBe('1 open notes')
  })
})
