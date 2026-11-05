import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEdit } from './mobileWorkspaceEditing'

describe('mobile workspace relationship editing', () => {
  it('preserves free-form relationship key spelling like desktop', () => {
    const base = workspaceScenarioForId('default')
    const sourceNote = {
      ...base.notes[0],
      rawContent: '# Workflow Orchestration Essay\n\nSource body.\n',
    }
    const snapshot = applyMobileWorkspaceEdit({
      ...base,
      allNotes: [sourceNote, ...base.notes.slice(1)],
      notes: [sourceNote, ...base.notes.slice(1)],
    }, {
      key: 'Related to',
      noteId: 'workflow-orchestration',
      targetTitle: 'How I Run an Open Source Project',
      type: 'addRelationship',
    })
    const note = snapshot.notes.find((candidate) => candidate.id === 'workflow-orchestration')

    expect(note?.rawContent).toContain('Related to:')
    expect(note?.rawContent).not.toContain('related_to:')
    expect(note?.relationships.find((candidate) => candidate.key === 'Related to')?.values).toContainEqual(
      expect.objectContaining({ title: 'How I Run an Open Source Project' }),
    )
  })
})
