import { describe, expect, it } from 'vitest'
import { typeDefinitionFields } from './tabletWorkspaceTypeDefinitionFields'
import { createViewInitialFilters } from './tabletWorkspaceViewHelpers'

describe('tablet workspace controller view helpers', () => {
  it('uses the desktop create-view dialog filter defaults', () => {
    expect(createViewInitialFilters()).toEqual({
      all: [{ field: 'type', op: 'equals', value: '' }],
    })
  })

  it('preserves desktop Type icon keys when opening the mobile Type editor', () => {
    expect(typeDefinitionFields({
      definition: { color: 'cyan', icon: 'robot', path: 'types/procedure.md', tone: 'gray' },
      label: 'Procedures',
      typeName: 'Procedure',
    })).toEqual(expect.arrayContaining([
      { key: 'typeIcon', value: 'robot' },
      { key: 'typeTone', value: 'cyan' },
    ]))
  })
})
