import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import {
  applyMobileWorkspaceEdit,
  applyMobileWorkspaceEditWithWrites,
} from './mobileWorkspaceEditing'
import type { MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

const workflowNoteId = 'workflow-orchestration'
const workflowNotePath = 'Memoria/Mobile UI/Workflow Orchestration Essay.md'

describe('mobile raw workspace editing', () => {
  it('derives frontmatter metadata from complete markdown edits', () => {
    const result = applyMobileWorkspaceEditWithWrites(editableWorkflowScenario(), {
      content: rawFrontmatterContract(),
      noteId: workflowNoteId,
      type: 'updateNoteContent',
    })

    const note = workflowNote(result.snapshot)
    expect(note).toMatchObject({
      links: 1,
      outgoingLinks: ['Release Notes'],
      snippet: 'Body with Release Notes.',
      status: 'Active',
      tags: ['Mobile', 'Parity'],
      title: 'Raw Frontmatter Contract',
      type: 'Procedure',
      typeTone: 'purple',
    })
    expect(note.properties).toContainEqual({ key: 'Priority', label: 'Priority', value: 'High' })
    expect(note.relationships.find((relationship) => relationship.key === 'related_to')?.values).toContainEqual(
      expect.objectContaining({
        ref: '[[Memoria/Mobile UI/How I Run an Open Source Project]]',
        title: 'How I Run an Open Source Project',
        type: 'Procedure',
      }),
    )
    expect(result.writes).toEqual([{
      content: expect.stringContaining('type: Procedure'),
      kind: 'saveNote',
      path: workflowNotePath,
    }])
  })

  it('clears stale frontmatter metadata when complete markdown removes it', () => {
    const withMetadata = applyMobileWorkspaceEdit(editableWorkflowScenario(), {
      content: rawFrontmatterContract(),
      noteId: workflowNoteId,
      type: 'updateNoteContent',
    })
    const withoutMetadata = applyMobileWorkspaceEdit(withMetadata, {
      content: '# Body Only Contract\n\nPlain body.\n',
      noteId: workflowNoteId,
      type: 'updateNoteContent',
    })

    expect(workflowNote(withoutMetadata)).toMatchObject({
      favorite: false,
      properties: [],
      relationships: [],
      status: '',
      tags: [],
      title: 'Body Only Contract',
    })
  })

  it('initializes missing properties with the desktop Note type seed', () => {
    const withoutMetadata = applyMobileWorkspaceEdit(editableWorkflowScenario(), {
      content: '# Body Only Contract\n\nPlain body.\n',
      noteId: workflowNoteId,
      type: 'updateNoteContent',
    })
    const initialized = applyMobileWorkspaceEdit(withoutMetadata, {
      key: 'type',
      noteId: workflowNoteId,
      type: 'updateProperty',
      value: 'Note',
    })

    expect(workflowNote(initialized)).toMatchObject({
      title: 'Body Only Contract',
      type: 'Note',
    })
    expect(workflowNote(initialized).rawContent).toBe('---\ntype: Note\n---\n# Body Only Contract\n\nPlain body.\n')
  })
})

function editableWorkflowScenario(): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  const editableNote = {
    ...base.notes[0],
    rawContent: [
      '---',
      'type: Essay',
      'Status: Draft',
      '---',
      '# Workflow Orchestration Essay',
      '',
      'Original body.',
      '',
    ].join('\n'),
  }

  return {
    ...base,
    notes: [editableNote, ...base.notes.slice(1)],
  }
}

function rawFrontmatterContract() {
  return [
    '---',
    'type: Procedure',
    'Status: Active',
    'tags:',
    '  - Mobile',
    '  - Parity',
    'Priority: High',
    'related_to:',
    '  - [[Memoria/Mobile UI/How I Run an Open Source Project]]',
    '---',
    '# Raw Frontmatter Contract',
    '',
    'Body with [[Release Notes]].',
    '',
  ].join('\n')
}

function workflowNote(snapshot: MobileWorkspaceSnapshot) {
  const note = snapshot.notes.find((candidate) => candidate.id === workflowNoteId)
  if (!note) throw new Error(`Missing note ${workflowNoteId}`)
  return note
}
