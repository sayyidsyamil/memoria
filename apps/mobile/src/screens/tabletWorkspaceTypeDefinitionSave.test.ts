import { describe, expect, it } from 'vitest'
import {
  createTypeDefinitionEdit,
  toggleTypeVisibilityEdit,
  typeDefinitionSaveEdit,
} from './tabletWorkspaceTypeDefinitionSave'

const expectedRenamedTypeEdit = {
      edits: [
        {
          nextTypeName: 'Playbook',
          type: 'renameTypeDefinition',
          typeName: 'Procedure',
        },
        {
          patch: {
            color: 'purple',
            icon: 'tag',
            label: 'Playbooks',
            listPropertiesDisplay: ['Status', 'Priority'],
            properties: {
              has: 'Milestone',
              Priority: 5,
              Stage: ['Design', 'Build'],
            },
            relationships: {
              depends_on: ['[[Roadmap]]'],
            },
            sort: 'property:Priority:asc',
            template: '## Checklist\n',
            tone: 'purple',
            visible: false,
          },
          type: 'updateTypeDefinition',
          typeName: 'Playbook',
        },
      ],
      type: 'bulkEdit',
    }

describe('tablet workspace Type definition save', () => {
  it('saves renamed Type section metadata and schema as desktop edits', () => {
    expect(typeDefinitionSaveEdit({
      typeDisplayProperties: ['Status', 'Priority', 'Status', ''],
      typeIcon: 'tag',
      typeName: 'Procedure',
      typeRenameName: 'Playbook',
      typeSchemaProperties: [
        { key: 'Priority', value: 5 },
        { key: 'Stage', value: ['Design', 'Build'] },
      ],
      typeSchemaRelationships: [
        { key: 'has', placeholderValue: 'Milestone', refs: [] },
        { key: 'depends_on', refs: ['[[Roadmap]]'] },
      ],
      typeSectionLabel: 'Playbooks',
      typeSort: 'property:Priority:asc',
      typeTemplate: '## Checklist\n',
      typeTone: 'purple',
      typeVisible: false,
    }, {
      Procedure: { path: 'procedure.md' },
    })).toEqual(expectedRenamedTypeEdit)
  })

  it('rejects Type renames that would collide with an existing desktop Type slug', () => {
    expect(typeDefinitionSaveEdit({
      typeDisplayProperties: [],
      typeIcon: 'file',
      typeName: 'Procedure',
      typeRenameName: 'Essay',
      typeSchemaProperties: [],
      typeSchemaRelationships: [],
      typeSectionLabel: 'Procedures',
      typeSort: '',
      typeTemplate: '',
      typeTone: 'gray',
      typeVisible: true,
    }, {
      Essay: { path: 'essay.md' },
      Procedure: { path: 'procedure.md' },
    })).toBeNull()
  })

  it('preserves desktop Type icon keys that mobile renders with a fallback glyph', () => {
    expect(typeDefinitionSaveEdit({
      typeDisplayProperties: [],
      typeIcon: 'robot',
      typeName: 'Procedure',
      typeRenameName: 'Procedure',
      typeSchemaProperties: [],
      typeSchemaRelationships: [],
      typeSectionLabel: 'Procedures',
      typeSort: '',
      typeTemplate: '',
      typeTone: 'gray',
      typeVisible: true,
    }, {
      Procedure: { icon: 'robot', path: 'procedure.md' },
    })).toMatchObject({
      patch: {
        icon: 'robot',
      },
      type: 'updateTypeDefinition',
      typeName: 'Procedure',
    })
  })

  it('preserves desktop Type colors outside the mobile swatch shortcuts', () => {
    expect(typeDefinitionSaveEdit({
      typeDisplayProperties: [],
      typeIcon: 'file',
      typeName: 'Procedure',
      typeRenameName: 'Procedure',
      typeSchemaProperties: [],
      typeSchemaRelationships: [],
      typeSectionLabel: 'Procedures',
      typeSort: '',
      typeTemplate: '',
      typeTone: 'cyan',
      typeVisible: true,
    }, {
      Procedure: { color: 'cyan', path: 'procedure.md', tone: 'gray' },
    })).toMatchObject({
      patch: {
        color: 'cyan',
        tone: 'gray',
      },
      type: 'updateTypeDefinition',
      typeName: 'Procedure',
    })
  })

  it('builds guarded Type creation edits', () => {
    expect(createTypeDefinitionEdit(' Essay ')).toEqual({
      type: 'createTypeDefinition',
      typeName: 'Essay',
    })
    expect(createTypeDefinitionEdit('')).toBeNull()
  })

  it('toggles Type visibility through desktop definition patches', () => {
    expect(toggleTypeVisibilityEdit(' Essay ', { Essay: { path: 'essay.md', visible: false } })).toEqual({
      patch: { visible: null },
      type: 'updateTypeDefinition',
      typeName: 'Essay',
    })
    expect(toggleTypeVisibilityEdit('Essay', { Essay: { path: 'essay.md' } })).toEqual({
      patch: { visible: false },
      type: 'updateTypeDefinition',
      typeName: 'Essay',
    })
    expect(toggleTypeVisibilityEdit('', { Essay: { path: 'essay.md' } })).toBeNull()
    expect(toggleTypeVisibilityEdit('Missing', { Essay: { path: 'essay.md' } })).toBeNull()
  })
})
