import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'

describe('applyMobileWorkspaceEdit frontmatter issue handling', () => {
  it('keeps the last derived note metadata while raw frontmatter is temporarily incomplete', () => {
    const base = workspaceScenarioForId('default')
    const result = applyMobileWorkspaceEditWithWrites(hydratedWorkflowSnapshot(base), {
      content: '---\ntype: Procedure\nStatus: Active\nrelated_to:\n  - [[Release Notes]]\n# Broken edit still in progress',
      noteId: 'workflow-orchestration',
      type: 'updateNoteContent',
    })

    const note = result.snapshot.notes.find((candidate) => candidate.id === 'workflow-orchestration')
    expect(note).toMatchObject({
      rawContent: expect.stringContaining('# Broken edit still in progress'),
      status: 'Draft',
      tags: ['Design', 'AI'],
      title: 'Workflow Orchestration Essay',
      type: 'Essay',
    })
    expect(note?.relationships.find((relationship) => relationship.kind === 'relatedTo')?.values).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Release Notes' })]),
    )
    expect(result.writes).toEqual([{
      content: expect.stringContaining('# Broken edit still in progress'),
      kind: 'saveNote',
      path: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
    }])
  })
})

function hydratedWorkflowSnapshot(base: ReturnType<typeof workspaceScenarioForId>) {
  return {
    ...base,
    notes: base.notes.map((note) => note.id === 'workflow-orchestration'
      ? {
          ...note,
          rawContent: '---\ntype: Essay\nStatus: Draft\ntags:\n  - Design\n  - AI\nrelated_to:\n  - [[Release Notes]]\n---\n# Workflow Orchestration Essay\n\nBody.',
        }
      : note),
  }
}
