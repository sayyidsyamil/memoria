import { describe, expect, it } from 'vitest'
import { workspaceScenarios } from '../fixtures/workspaceFixtures'
import {
  addRelationshipEditFromForm,
  createRelationshipTargetEditFromForm,
  removeRelationshipEdit,
} from './tabletWorkspaceRelationshipActions'

describe('tablet workspace relationship actions', () => {
  it('saves selected relationship refs exactly so ambiguous titles resolve like desktop', () => {
    expect(addRelationshipEditFromForm({
      relationshipName: ' Related to ',
      relationshipNoteRef: ' [[Projects/Duplicate Reference]] ',
      relationshipNoteTitle: ' Duplicate Reference ',
    }, ' workflow-orchestration ')).toEqual({
      key: 'Related to',
      noteId: 'workflow-orchestration',
      targetRef: '[[Projects/Duplicate Reference]]',
      targetTitle: 'Duplicate Reference',
      type: 'addRelationship',
    })
  })

  it('rejects relationship edits without a note id, key, or target title', () => {
    const form = {
      relationshipName: 'Related to',
      relationshipNoteRef: '',
      relationshipNoteTitle: 'Duplicate Reference',
    }

    expect(addRelationshipEditFromForm(form, '')).toBeNull()
    expect(addRelationshipEditFromForm({ ...form, relationshipName: '' }, 'workflow-orchestration')).toBeNull()
    expect(addRelationshipEditFromForm({ ...form, relationshipNoteTitle: '' }, 'workflow-orchestration')).toBeNull()
  })

  it('leaves title-only relationship entries for desktop wikilink resolution', () => {
    expect(addRelationshipEditFromForm({
      relationshipName: 'Belongs to',
      relationshipNoteRef: '',
      relationshipNoteTitle: 'LLM Workflow',
    }, 'workflow-orchestration')).toEqual({
      key: 'Belongs to',
      noteId: 'workflow-orchestration',
      targetRef: '',
      targetTitle: 'LLM Workflow',
      type: 'addRelationship',
    })
  })

  it.each([
    [
      'creates relationship targets from the selected source note with trimmed key and title',
      {
        relationshipName: ' related_to ',
        relationshipNoteRef: ' [[Projects/New Project]] ',
        relationshipNoteTitle: '  New Project  ',
      },
      { targetRef: '[[Projects/New Project]]' },
    ],
    [
      'omits relationship target refs when no target note was selected',
      {
        relationshipName: 'related_to',
        relationshipNoteRef: '',
        relationshipNoteTitle: 'New Project',
      },
      {},
    ],
  ] as const)('%s', (_name, form, expectedRef) => {
    const selectedNote = sourceNoteFixture()

    expect(createRelationshipTargetEditFromForm(form, selectedNote)).toStrictEqual({
      ...expectedRef,
      key: 'related_to',
      sourceNoteId: selectedNote.id,
      targetTitle: 'New Project',
      type: 'createRelationshipTarget',
    })
  })

  it('rejects relationship target creation without a source note, key, or target title', () => {
    const selectedNote = sourceNoteFixture()

    expect(createRelationshipTargetEditFromForm({
      relationshipName: 'related_to',
      relationshipNoteRef: '',
      relationshipNoteTitle: 'New Project',
    }, null)).toBeNull()
    expect(createRelationshipTargetEditFromForm({
      relationshipName: '',
      relationshipNoteRef: '',
      relationshipNoteTitle: 'New Project',
    }, selectedNote)).toBeNull()
    expect(createRelationshipTargetEditFromForm({
      relationshipName: 'related_to',
      relationshipNoteRef: '',
      relationshipNoteTitle: '',
    }, selectedNote)).toBeNull()
  })

  it('builds guarded desktop remove-relationship edits', () => {
    expect(removeRelationshipEdit(' workflow-orchestration ', ' belongs_to ', ' [[Projects/Laputa]] ')).toEqual({
      key: 'belongs_to',
      noteId: 'workflow-orchestration',
      ref: '[[Projects/Laputa]]',
      type: 'removeRelationship',
    })
    expect(removeRelationshipEdit('', 'belongs_to', '[[Projects/Laputa]]')).toBeNull()
    expect(removeRelationshipEdit('workflow-orchestration', '', '[[Projects/Laputa]]')).toBeNull()
    expect(removeRelationshipEdit('workflow-orchestration', 'belongs_to', '')).toBeNull()
  })
})

function sourceNoteFixture() {
  const note = workspaceScenarios.default.notes.find(({ id }) => id === 'workflow-orchestration')
  if (!note) throw new Error('Expected the workflow source-note fixture')
  return note
}
