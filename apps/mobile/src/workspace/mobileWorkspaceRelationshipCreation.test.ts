import { describe, expect, it } from 'vitest'
import { requiredFixture } from '../fixtures/requiredFixture'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { buildLocalVaultWorkspaceSnapshot } from './localVaultSnapshot'
import type { MobileNote } from './mobileWorkspaceModel'
import { applyMobileWorkspaceEditWithWrites, type MobileWorkspaceEditResult } from './mobileWorkspaceEditing'

describe('mobile relationship target creation parity', () => {
  it('creates relationship targets beside the source note and links the exact created path', () => {
    const { result, target, updatedSource } = createRelationshipTargetResult()

    expect(result.snapshot.selectedNoteId).toBe('Memoria/Mobile UI/new-dependency.md')
    expect(target).toMatchObject({
      id: 'Memoria/Mobile UI/new-dependency.md',
      path: 'Memoria/Mobile UI/new-dependency.md',
      title: 'New Dependency',
      type: 'Note',
    })
    expect(updatedSource?.rawContent).toContain('Related to:\n  - "[[Memoria/Mobile UI/new-dependency]]"')
    expect(updatedSource?.rawContent).not.toContain('related_to:')
    expect(updatedSource?.relationships.find((relationship) => relationship.key === 'Related to')?.values).toContainEqual(
      expect.objectContaining({
        id: target?.id,
        title: 'New Dependency',
      }),
    )
    expect(result.writes).toEqual([
      {
        content: '---\ntitle: New Dependency\ntype: Note\n---\n',
        kind: 'createNote',
        path: 'Memoria/Mobile UI/new-dependency.md',
      },
      {
        content: updatedSource?.rawContent,
        kind: 'saveNote',
        path: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
      },
    ])
  })

  it('persists source relationship refs from local-vault relationship target creation', () => {
    const snapshot = buildLocalVaultWorkspaceSnapshot({
      files: [
        localVaultFile('Relationships/Source.md', [
          '---',
          'type: Essay',
          'status: Draft',
          '---',
          '# Relationship Source',
          '',
          'Create a relationship target from this note.',
          '',
        ].join('\n')),
      ],
      vaultLabel: 'Memoria Vault',
      vaultPath: '/tmp/memoria-vault',
    })
    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      key: 'related_to',
      sourceNoteId: 'Relationships/Source.md',
      targetTitle: 'Native Related Target',
      type: 'createRelationshipTarget',
    })

    expect(result.writes).toContainEqual({
      content: expect.stringContaining('related_to:\n  - "[[Relationships/native-related-target]]"'),
      kind: 'saveNote',
      path: 'Relationships/Source.md',
    })
  })

  it('creates same-workspace relationship target refs without adding the workspace alias prefix', () => {
    const base = workspaceScenarioForId('default')
    const sourceNote = {
      ...base.notes[0],
      rawContent: '# Workflow Orchestration Essay\n\nSource body.\n',
      workspaceAlias: 'laputa',
    }
    const result = applyMobileWorkspaceEditWithWrites({
      ...base,
      allNotes: [sourceNote, ...base.notes.slice(1)],
      notes: [sourceNote, ...base.notes.slice(1)],
      source: {
        alias: 'laputa',
        kind: 'localVault',
        label: 'Laputa',
        totalNotes: base.notes.length,
        visibleNotes: base.notes.length,
      },
    }, {
      key: 'Related to',
      sourceNoteId: sourceNote.id,
      targetTitle: 'New Dependency',
      type: 'createRelationshipTarget',
    })
    const target = result.snapshot.allNotes?.find((note) => note.path === 'Memoria/Mobile UI/new-dependency.md')
    const updatedSource = result.snapshot.allNotes?.find((note) => note.id === sourceNote.id)

    expect(target).toMatchObject({ workspaceAlias: 'laputa' })
    expect(updatedSource?.rawContent).toContain('Related to:\n  - "[[Memoria/Mobile UI/new-dependency]]"')
    expect(updatedSource?.rawContent).not.toContain('[[laputa/Memoria/Mobile UI/new-dependency]]')
  })

  it('creates relationship targets with the source Type relationship schema defaults', () => {
    expectSchemaBackedRelationshipTarget(
      applyMobileWorkspaceEditWithWrites(relationshipTargetSchemaSnapshot(), {
        key: 'has',
        sourceNoteId: 'workflow-orchestration',
        targetTitle: 'Launch Beta',
        type: 'createRelationshipTarget',
      }),
    )
  })

  it('blocks relationship target creation when the generated target path already exists', () => {
    const base = workspaceScenarioForId('default')
    const sourceNote = {
      ...base.notes[0],
      id: 'Writing/Launch/source.md',
      path: 'Writing/Launch/source.md',
      rawContent: '# Source\n\nSource body.\n',
      title: 'Source',
    }
    const existingTarget = {
      ...base.notes[1],
      id: 'Writing/Launch/launch-checklist.md',
      path: 'Writing/Launch/launch-checklist.md',
      title: 'Launch Checklist',
    }
    const snapshot = {
      ...base,
      allNotes: [sourceNote, existingTarget, ...base.notes.slice(2)],
      notes: [sourceNote, existingTarget, ...base.notes.slice(2)],
      selectedNoteId: sourceNote.id,
    }
    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      key: 'related_to',
      sourceNoteId: sourceNote.id,
      targetTitle: 'Launch Checklist',
      type: 'createRelationshipTarget',
    })

    expect(result.writes).toEqual([])
    expect(result.snapshot.notes).toHaveLength(snapshot.notes.length)
    expect(result.snapshot.notes[0]?.rawContent).toBe(sourceNote.rawContent)
    expect(result.snapshot.selectedNoteId).toBe(sourceNote.id)
  })

  it('links explicit existing wikilink relationship targets without creating duplicates', () => {
    const base = workspaceScenarioForId('default')
    const sourceNote = {
      ...base.notes[0],
      id: 'Writing/Launch/source.md',
      path: 'Writing/Launch/source.md',
      rawContent: '# Source\n\nSource body.\n',
      title: 'Source',
    }
    const existingTarget = {
      ...base.notes[1],
      id: 'Writing/Launch/launch-checklist.md',
      path: 'Writing/Launch/launch-checklist.md',
      title: 'Launch Checklist',
    }
    const snapshot = {
      ...base,
      allNotes: [sourceNote, existingTarget, ...base.notes.slice(2)],
      notes: [sourceNote, existingTarget, ...base.notes.slice(2)],
      selectedNoteId: sourceNote.id,
    }
    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      key: 'related_to',
      sourceNoteId: sourceNote.id,
      targetTitle: '[[Writing/Launch/launch-checklist]]',
      type: 'createRelationshipTarget',
    })
    const updatedSource = result.snapshot.allNotes?.find((note) => note.id === sourceNote.id)

    expect(result.snapshot.selectedNoteId).toBe(existingTarget.id)
    expect(result.snapshot.notes).toHaveLength(snapshot.notes.length)
    expect(updatedSource?.rawContent).toContain('related_to:\n  - "[[Writing/Launch/launch-checklist]]"')
    expect(result.writes).toEqual([{
      content: updatedSource?.rawContent,
      kind: 'saveNote',
      path: 'Writing/Launch/source.md',
    }])
  })
})

function createRelationshipTargetResult() {
  const base = workspaceScenarioForId('default')
  const sourceNote = {
    ...base.notes[0],
    rawContent: '# Workflow Orchestration Essay\n\nSource body.\n',
  }
  const result = applyMobileWorkspaceEditWithWrites({
    ...base,
    allNotes: [sourceNote, ...base.notes.slice(1)],
    notes: [sourceNote, ...base.notes.slice(1)],
    selectedNoteId: sourceNote.id,
  }, {
    key: 'Related to',
    sourceNoteId: sourceNote.id,
    targetTitle: 'New Dependency',
    type: 'createRelationshipTarget',
  })

  return {
    result,
    target: result.snapshot.allNotes?.find((note) => note.path === 'Memoria/Mobile UI/new-dependency.md'),
    updatedSource: result.snapshot.allNotes?.find((note) => note.id === sourceNote.id),
  }
}

function localVaultFile(relativePath: string, content: string) {
  return {
    absolutePath: `/tmp/memoria-vault/${relativePath}`,
    content,
    createdAt: null,
    modifiedAt: null,
    relativePath,
    size: content.length,
  }
}

function relationshipTargetSchemaSnapshot() {
  const base = workspaceScenarioForId('default')
  const sourceNote = {
    ...base.notes[0],
    rawContent: '# Workflow Orchestration Essay\n\nSource body.\n',
  }

  return {
    ...base,
    allNotes: [sourceNote, ...base.notes.slice(1)],
    notes: [sourceNote, ...base.notes.slice(1)],
    selectedNoteId: sourceNote.id,
    typeDefinitions: {
      ...base.typeDefinitions,
      Essay: {
        ...base.typeDefinitions?.Essay,
        properties: {
          ...base.typeDefinitions?.Essay?.properties,
          has: 'Milestone',
        },
      },
      Milestone: {
        properties: {
          Priority: 'High',
          status: 'Planned',
        },
        template: '## Outcome\n\n',
        tone: 'yellow' as const,
      },
    },
  }
}

function expectSchemaBackedRelationshipTarget(result: MobileWorkspaceEditResult) {
  const target = schemaTargetNote(result)
  const updatedSource = schemaUpdatedSourceNote(result)

  expectSchemaTargetNote(target)
  expectSchemaSourceNote(updatedSource)
  expectSchemaTargetWrites(result, target, updatedSource)
}

function schemaTargetNote(result: MobileWorkspaceEditResult): MobileNote {
  const note = result.snapshot.allNotes?.find((candidate) => candidate.path === 'Memoria/Mobile UI/launch-beta.md')
  expect(note).toBeDefined()
  return requiredFixture(note)
}

function schemaUpdatedSourceNote(result: MobileWorkspaceEditResult): MobileNote {
  const note = result.snapshot.allNotes?.find((candidate) => candidate.id === 'workflow-orchestration')
  expect(note).toBeDefined()
  return requiredFixture(note)
}

function expectSchemaTargetNote(target: MobileNote) {
  expect(target).toMatchObject({
    status: 'Planned',
    title: 'Launch Beta',
    type: 'Milestone',
    typeTone: 'yellow',
  })
  expect(target.rawContent).toContain('type: Milestone')
  expect(target.rawContent).toContain('Priority: High')
  expect(target.rawContent).toContain('status: Planned')
  expect(target.rawContent).toContain('## Outcome')
}

function expectSchemaSourceNote(updatedSource: MobileNote) {
  expect(updatedSource.rawContent).toContain('has:\n  - "[[Memoria/Mobile UI/launch-beta]]"')
}

function expectSchemaTargetWrites(
  result: MobileWorkspaceEditResult,
  target: MobileNote,
  updatedSource: MobileNote,
) {
  expect(result.writes).toEqual([
    {
      content: target.rawContent,
      kind: 'createNote',
      path: 'Memoria/Mobile UI/launch-beta.md',
    },
    {
      content: updatedSource.rawContent,
      kind: 'saveNote',
      path: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
    },
  ])
}
