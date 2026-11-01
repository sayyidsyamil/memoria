import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'
import { sidebarItems } from './mobileWorkspaceEditingTestSupport'

const typeSchemaDefaultsPatch = {
  properties: {
    Priority: 'High',
    has: 'Milestone',
  },
  relationships: {
    belongs_to: ['[[Memoria MVP]]'],
    depends_on: ['[[Project Board]]'],
  },
}

describe('applyMobileWorkspaceEdit', () => {
  it('changes note type through the desktop type frontmatter key', () => {
    const base = workspaceScenarioForId('default')
    const editableNote = {
      ...base.notes[0],
      rawContent: '# Workflow Orchestration Essay\n\nChange my type.\n',
    }
    const result = applyMobileWorkspaceEditWithWrites({
      ...base,
      notes: [editableNote, ...base.notes.slice(1)],
      typeDefinitions: {
        Procedure: { tone: 'orange' },
      },
    }, {
      noteId: 'workflow-orchestration',
      type: 'changeNoteType',
      value: 'Procedure',
    })
    const note = result.snapshot.notes.find((candidate) => candidate.id === 'workflow-orchestration')

    expect(note).toMatchObject({
      type: 'Procedure',
      typeTone: 'orange',
    })
    expect(note?.rawContent).toContain('type: Procedure')
    expect(result.writes).toEqual([{
      content: expect.stringContaining('type: Procedure'),
      kind: 'saveNote',
      path: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
    }])
    expect(sidebarItems(result.snapshot, 'types')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: '2', id: 'procedures', label: 'Procedures' }),
        expect.objectContaining({ count: '1', label: 'Releases' }),
      ]),
    )
    expect(sidebarItems(result.snapshot, 'types')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'essays' })]),
    )
  })

  it('updates type definition metadata through the Type markdown document contract', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      patch: {
        icon: 'folder',
        label: 'Runbooks',
        listPropertiesDisplay: ['status', 'belongs_to'],
        sort: 'property:Priority:desc',
        tone: 'green',
      },
      type: 'updateTypeDefinition',
      typeName: 'Procedure',
    })
    const procedure = result.snapshot.typeDefinitions?.Procedure
    const procedureNote = result.snapshot.notes.find((note) => note.type === 'Procedure')

    expect(procedure).toMatchObject({
      label: 'Runbooks',
      icon: 'folder',
      listPropertiesDisplay: ['status', 'belongs_to'],
      path: 'procedure.md',
      sort: 'property:Priority:desc',
      tone: 'green',
    })
    expect(procedureNote?.typeTone).toBe('green')
    expect(sidebarItems(result.snapshot, 'types')).toEqual(
      expect.arrayContaining([expect.objectContaining({
        icon: 'folder',
        label: 'Runbooks',
        tone: 'green',
        typeName: 'Procedure',
      })]),
    )
    expect(result.writes).toEqual([{
      content: expect.stringContaining('_sidebar_label: Runbooks'),
      kind: 'saveNote',
      path: 'procedure.md',
    }])
    const typeWrite = result.writes.find((write) => write.kind === 'saveNote')
    const content = typeWrite?.content
    expect(content).toContain('color: green')
    expect(content).toContain('_icon: folder')
    expect(content).toContain('_sort: "property:Priority:desc"')
    expect(content).toContain('_list_properties_display:\n  - status\n  - belongs_to')
  })

  it('updates type definition schema defaults through the Type markdown document contract', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      patch: typeSchemaDefaultsPatch,
      type: 'updateTypeDefinition',
      typeName: 'Procedure',
    })

    expectProcedureSchemaDefaults(result)
    expectTypeSchemaDefaultWrite(result)
  })

  it('moves type sections and persists desktop-style dense order values', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      direction: 'up',
      type: 'moveTypeSection',
      typeName: 'Procedure',
    })

    expect(result.snapshot.typeDefinitions).toMatchObject({ Procedure: { order: 0 }, Essay: { order: 1 } })
    expect(result.writes).toEqual([
      {
        content: expect.stringContaining('order: 0'),
        kind: 'saveNote',
        path: 'procedure.md',
      },
      {
        content: expect.stringContaining('order: 1'),
        kind: 'saveNote',
        path: 'essay.md',
      },
    ])
    expect(sidebarItems(result.snapshot, 'types').map((item) => item.typeName)).toEqual([
      'Procedure',
      'Essay',
      'Release',
    ])
  })

  it('creates Type documents and exposes empty Type sections', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      type: 'createTypeDefinition',
      typeName: 'Decision',
    })

    expect(result.snapshot.typeDefinitions?.Decision).toMatchObject({
      path: 'decision.md',
      rawContent: expect.stringContaining('# Decision'),
    })
    expect(sidebarItems(result.snapshot, 'types')).toEqual(
      expect.arrayContaining([expect.objectContaining({
        count: '0',
        label: 'Decisions',
        typeName: 'Decision',
      })]),
    )
    expect(result.writes).toEqual([{
      content: expect.stringContaining('type: Type'),
      kind: 'createNote',
      path: 'decision.md',
    }])
  })

  it('deletes Type documents without deleting notes of that type', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      type: 'deleteTypeDefinition',
      typeName: 'Procedure',
    })

    expect(result.snapshot.typeDefinitions?.Procedure).toBeUndefined()
    expect(result.snapshot.notes.some((note) => note.type === 'Procedure')).toBe(true)
    expect(sidebarItems(result.snapshot, 'types')).toEqual(
      expect.arrayContaining([expect.objectContaining({
        count: '1',
        label: 'Procedures',
        typeName: 'Procedure',
      })]),
    )
    expect(result.writes).toEqual([{
      kind: 'deleteNote',
      path: 'procedure.md',
    }])
  })
})

function expectProcedureSchemaDefaults(
  result: ReturnType<typeof applyMobileWorkspaceEditWithWrites>,
) {
  expect(result.snapshot.typeDefinitions).toMatchObject({ Procedure: typeSchemaDefaultsPatch })
}

function expectTypeSchemaDefaultWrite(
  result: ReturnType<typeof applyMobileWorkspaceEditWithWrites>,
) {
  const typeWrite = result.writes.find((write) => write.kind === 'saveNote')
  const content = typeWrite?.content

  expect(typeWrite?.path).toBe('procedure.md')
  expect(content).toContain('Priority: High')
  expect(content).toContain('has: Milestone')
  expect(content).toContain('belongs_to:\n  - "[[Memoria MVP]]"')
  expect(content).toContain('depends_on:\n  - "[[Project Board]]"')
}
