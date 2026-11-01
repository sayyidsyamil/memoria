import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import type { MobileNote, MobileTypeDefinition } from './mobileWorkspaceModel'
import {
  addTypeSchemaProperty,
  addTypeSchemaRelationshipRef,
  mobileTypeSchemaRelationshipValueText,
  typeDefinitionSchemaPatch,
  typeSchemaPropertiesForForm,
  typeSchemaRelationshipTargetSuggestions,
  typeSchemaRelationshipsForForm,
} from './mobileTypeDefinitionSchema'

describe('mobile type definition schema helpers', () => {
  it('splits Type scalar defaults from relationship schema rows', () => {
    const definition: MobileTypeDefinition = {
      properties: {
        Priority: 'High',
        has: 'Milestone',
      },
      relationships: {
        depends_on: ['[[Project Board]]'],
      },
    }

    expect(typeSchemaPropertiesForForm(definition)).toEqual([
      { key: 'Priority', value: 'High' },
    ])
    expect(typeSchemaRelationshipsForForm(definition)).toEqual([
      { key: 'depends_on', refs: ['[[Project Board]]'] },
      { key: 'has', placeholderValue: 'Milestone', refs: [] },
    ])
  })

  it('writes schema rows back to the desktop Type frontmatter contract', () => {
    expect(typeDefinitionSchemaPatch([
      { key: 'Priority', value: 'High' },
    ], [
      { key: 'depends_on', refs: ['[[Project Board]]'] },
      { key: 'has', placeholderValue: 'Milestone', refs: [] },
    ])).toEqual({
      properties: {
        Priority: 'High',
        has: 'Milestone',
      },
      relationships: {
        depends_on: ['[[Project Board]]'],
      },
    })
  })

  it('parses property defaults and resolves relationship targets from notes', () => {
    const notes = workspaceScenarioForId('default').notes
    const properties = addTypeSchemaProperty([], 'Stage', 'Design, Build')
    const relationships = addTypeSchemaRelationshipRef({
      key: 'belongs to',
      notes,
      relationships: [],
      targetTitle: 'How I Run an Open Source Project',
    })

    expect(properties).toEqual([{ key: 'Stage', value: ['Design', 'Build'] }])
    expect(relationships).toEqual([{ key: 'belongs_to', refs: ['[[Memoria/Mobile UI/How I Run an Open Source Project]]'] }])
    expect(mobileTypeSchemaRelationshipValueText(relationships[0], notes)).toBe('How I Run an Open Source Project')
    expect(addTypeSchemaProperty([], 'Audience', '"AI, UX", Design')).toEqual([
      { key: 'Audience', value: ['AI, UX', 'Design'] },
    ])
  })

  it('preserves custom Type relationship key spelling like desktop frontmatter', () => {
    const notes = workspaceScenarioForId('default').notes
    const relationships = addTypeSchemaRelationshipRef({
      key: 'Mentored by',
      notes,
      relationships: [],
      targetTitle: 'How I Run an Open Source Project',
    })

    expect(relationships).toEqual([{ key: 'Mentored by', refs: ['[[Memoria/Mobile UI/How I Run an Open Source Project]]'] }])
    expect(typeDefinitionSchemaPatch([], relationships)).toEqual({
      properties: {},
      relationships: {
        'Mentored by': ['[[Memoria/Mobile UI/How I Run an Open Source Project]]'],
      },
    })
  })

  it('searches and saves type relationship targets through desktop note identities', () => {
    const notes = workspaceScenarioForId('default').notes.map((note) => note.id === 'open-source-project'
      ? { ...note, aliases: ['OSS Project'] }
      : note)

    const ossSuggestions = typeSchemaRelationshipTargetSuggestions(notes, 'oss')
    expect(ossSuggestions[0]).toEqual(expect.objectContaining({
      label: 'How I Run an Open Source Project',
      value: '[[Memoria/Mobile UI/How I Run an Open Source Project]]',
    }))
    expect(ossSuggestions).toContainEqual(expect.objectContaining({
      label: 'Workflow Orchestration Essay',
    }))
    expect(typeSchemaRelationshipTargetSuggestions(notes, 'Memoria/Mobile UI')).toContainEqual(expect.objectContaining({
      label: 'How I Run an Open Source Project',
    }))
    expect(addTypeSchemaRelationshipRef({
      key: 'related to',
      notes,
      relationships: [],
      targetTitle: 'OSS Project',
    })).toEqual([
      { key: 'related_to', refs: ['[[Memoria/Mobile UI/How I Run an Open Source Project]]'] },
    ])
  })

  it('formats type schema relationship refs relative to the source Type document workspace', () => {
    const base = workspaceScenarioForId('default')
    const sourceType = {
      ...base.notes[0],
      path: 'types/project.md',
      title: 'Project',
      type: 'Type',
      workspace: 'Personal',
      workspaceAlias: 'personal',
    }
    const remoteTarget = {
      ...base.notes[1],
      id: 'team/projects/alpha.md',
      path: 'projects/alpha.md',
      title: 'Alpha',
      workspace: 'Team',
      workspaceAlias: 'team',
    }
    const sameWorkspaceTarget = {
      ...base.notes[2],
      id: 'personal/projects/beta.md',
      path: 'projects/beta.md',
      title: 'Beta',
      workspace: 'Personal',
      workspaceAlias: 'personal',
    }
    const notes = [sourceType, remoteTarget, sameWorkspaceTarget]

    expect(typeSchemaRelationshipTargetSuggestions(notes, 'Alpha', sourceType)).toEqual([
      expect.objectContaining({
        label: 'Alpha',
        value: '[[team/projects/alpha]]',
      }),
    ])
    expect(typeSchemaRelationshipTargetSuggestions(notes, 'Beta', sourceType)).toEqual([
      expect.objectContaining({
        label: 'Beta',
        value: '[[projects/beta]]',
      }),
    ])
    expect(addTypeSchemaRelationshipRef({
      key: 'depends_on',
      notes,
      relationships: [],
      sourceNote: sourceType,
      targetTitle: 'Alpha',
    })).toEqual([
      { key: 'depends_on', refs: ['[[team/projects/alpha]]'] },
    ])
  })

  it('excludes the edited Type document from relationship target suggestions', () => {
    const base = workspaceScenarioForId('default')
    const sourceType = {
      ...base.notes[0],
      id: 'types/project.md',
      path: 'types/project.md',
      title: 'Project',
      type: 'Type',
    }
    const target = {
      ...base.notes[1],
      id: 'projects/project-plan.md',
      path: 'projects/project-plan.md',
      title: 'Project Plan',
      type: 'Essay',
    }

    expect(typeSchemaRelationshipTargetSuggestions([sourceType, target], 'Project', sourceType)).toEqual([
      expect.objectContaining({
        label: 'Project Plan',
        value: '[[projects/project-plan]]',
      }),
    ])
  })

  it('uses selected type relationship refs when titles are ambiguous', () => {
    const base = workspaceScenarioForId('default')
    const notes: MobileNote[] = [
      duplicateReference(base.notes[1], 'duplicate-reference-a', 'Writing/Duplicate Reference.md', 'Essay', 'green'),
      duplicateReference(base.notes[1], 'duplicate-reference-b', 'Projects/Duplicate Reference.md', 'Procedure', 'purple'),
    ]

    expect(addTypeSchemaRelationshipRef({
      key: 'related to',
      notes,
      relationships: [],
      targetRef: '[[Projects/Duplicate Reference]]',
      targetTitle: 'Duplicate Reference',
    })).toEqual([
      { key: 'related_to', refs: ['[[Projects/Duplicate Reference]]'] },
    ])
  })
})

function duplicateReference(
  base: MobileNote,
  id: string,
  path: string,
  type: MobileNote['type'],
  typeTone: MobileNote['typeTone'],
): MobileNote {
  return {
    ...base,
    id,
    path,
    title: 'Duplicate Reference',
    type,
    typeTone,
  }
}
