import { describe, expect, it } from 'vitest'
import { applyMobileTypeDefinitionPatch } from './mobileTypeDefinitions'
import { mobileTypeNameFromSidebarLabel } from './mobileTypeNames'

describe('mobile Type patch normalization', () => {
  it.each(['color', 'label', 'sort', 'template', 'view'] as const)(
    'normalizes an explicit %s patch without changing omitted metadata', (key) => {
      const original = { color: 'cyan', label: 'Team', sort: 'title:asc', template: '## Outline', view: 'editor-list' }
      expect(applyMobileTypeDefinitionPatch(original, { [key]: ' next ' })).toEqual({ ...original, [key]: 'next' })
      expect(applyMobileTypeDefinitionPatch(original, { [key]: ' ' })).toEqual({ ...original, [key]: null })
      expect(applyMobileTypeDefinitionPatch(original, { [key]: null })).toEqual({ ...original, [key]: null })
      expect(applyMobileTypeDefinitionPatch(original, {})).toEqual(original)
      expect(applyMobileTypeDefinitionPatch(original, { [key]: undefined })).toEqual({ ...original, [key]: undefined })
    },
  )

  it('normalizes list/schema patches while preserving unrelated Type metadata', () => {
    expect(applyMobileTypeDefinitionPatch({ icon: 'robot', color: 'cyan' }, {
      listPropertiesDisplay: [' Stage ', 'stage', ''],
      properties: { ' Status ': [' Draft ', 'draft', ''], ' ': 'ignored', Priority: 2 },
      relationships: { ' belongs_to ': [' [[Roadmap]] ', '[[Roadmap]]'], empty: [] },
    })).toEqual({
      icon: 'robot',
      color: 'cyan',
      listPropertiesDisplay: ['Stage'],
      properties: { Status: ['Draft'], Priority: 2 },
      relationships: { belongs_to: ['[[Roadmap]]'] },
    })
  })
})

describe('mobile sidebar Type name resolution', () => {
  it.each([
    ['People', 'Person'],
    ['Cities', 'City'],
    ['Classes', 'Class'],
    ['Boxes', 'Box'],
    ['Brushes', 'Brush'],
    ['Patches', 'Patch'],
    ['Projects', 'Project'],
    ['', null],
  ])('resolves the %s sidebar label', (label, expected) => {
    expect(mobileTypeNameFromSidebarLabel(label)).toBe(expected)
  })

  it('prefers the explicit Type name over a customized sidebar label', () => {
    expect(mobileTypeNameFromSidebarLabel('Team members', 'person')).toBe('Person')
  })
})
