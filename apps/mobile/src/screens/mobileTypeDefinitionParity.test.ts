import { describe, expect, it } from 'vitest'
import { typeDefinitionSaveEdit } from './tabletWorkspaceTypeDefinitionSave'
import { typeDefinitionFields } from './tabletWorkspaceTypeDefinitionFields'

type TypeForm = Parameters<typeof typeDefinitionSaveEdit>[0]

function renameForm(typeName: string, typeSectionLabel: string): TypeForm {
  return {
    typeDisplayProperties: [],
    typeIcon: 'file',
    typeName,
    typeRenameName: 'Leader',
    typeSchemaProperties: [],
    typeSchemaRelationships: [],
    typeSectionLabel,
    typeSort: '',
    typeTemplate: '',
    typeTone: 'gray',
    typeVisible: true,
  }
}

describe('mobile Type label parity with desktop', () => {
  it.each([
    ['Person', 'People'],
    ['Day', 'Days'],
    ['Box', 'Boxes'],
    ['Class', 'Classes'],
    ['Brush', 'Brushes'],
    ['City', 'Cities'],
    ['Procedure', 'Procedures'],
  ])('clears the default %s section label on rename', (typeName, label) => {
    expect(typeDefinitionSaveEdit(renameForm(typeName, label), {
      [typeName]: { label },
    })).toMatchObject({
      type: 'bulkEdit',
      edits: [
        { type: 'renameTypeDefinition', typeName, nextTypeName: 'Leader' },
        { type: 'updateTypeDefinition', typeName: 'Leader', patch: { label: null } },
      ],
    })
  })

  it('preserves a custom section label when renaming a Type', () => {
    expect(typeDefinitionSaveEdit(renameForm('Person', 'Team members'), {
      Person: { label: 'Team members' },
    })).toMatchObject({
      type: 'bulkEdit',
      edits: [
        { type: 'renameTypeDefinition', typeName: 'Person', nextTypeName: 'Leader' },
        { type: 'updateTypeDefinition', typeName: 'Leader', patch: { label: 'Team members' } },
      ],
    })
  })

  it('preserves the label when only changing Type appearance', () => {
    const form = { ...renameForm('Person', 'People'), typeRenameName: 'Person' }
    expect(typeDefinitionSaveEdit(form, { Person: {} })).toMatchObject({
      type: 'updateTypeDefinition', typeName: 'Person', patch: { label: 'People' },
    })
  })

  it('initializes a missing Type without losing the supplied sidebar label', () => {
    const fields = typeDefinitionFields({ definition: undefined, label: 'People', typeName: 'Person' })
    expect(Object.fromEntries(fields.map(({ key, value }) => [key, value]))).toMatchObject({
      typeDisplayProperties: [],
      typeIcon: 'file',
      typeName: 'Person',
      typeRenameName: 'Person',
      typeSchemaProperties: [],
      typeSchemaRelationships: [],
      typeSectionLabel: 'People',
      typeSort: '',
      typeTemplate: '',
      typeTone: 'gray',
      typeVisible: true,
    })
  })

  it('preserves the desktop color and hidden state in the Type form', () => {
    const fields = typeDefinitionFields({
      definition: { color: 'cyan', icon: 'robot', label: 'Team', tone: 'gray', visible: false },
      label: 'People',
      typeName: 'Person',
    })
    expect(Object.fromEntries(fields.map(({ key, value }) => [key, value]))).toMatchObject({
      typeIcon: 'robot', typeSectionLabel: 'Team', typeTone: 'cyan', typeVisible: false,
    })
  })
})
