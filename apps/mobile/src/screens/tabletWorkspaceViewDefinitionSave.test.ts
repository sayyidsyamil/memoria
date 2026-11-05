import { describe, expect, it } from 'vitest'
import { requiredFixture } from '../fixtures/requiredFixture'
import { workspaceScenarios } from '../fixtures/workspaceFixtures'
import type { MobileViewFilterGroup } from '../workspace/mobileWorkspaceModel'
import {
  viewDefinitionCreateEdit,
  viewDefinitionSaveEdit,
} from './tabletWorkspaceViewDefinitionSave'

describe('tablet workspace view definition save', () => {
  it('creates saved-view metadata, filters, display columns, and sort as a desktop create edit', () => {
    const filters: MobileViewFilterGroup = {
      all: [
        { field: 'type', op: 'equals', value: 'Procedure' },
        { field: 'status', op: 'equals', value: 'Active' },
      ],
    }
    const edit = viewDefinitionCreateEdit({
      viewDisplayProperties: ['belongs_to', 'tags', 'belongs_to'],
      viewFilters: filters,
      viewIcon: 'view',
      viewName: '  Active Procedures  ',
      viewSort: 'modified:desc',
      viewTone: 'purple',
    })

    expect(edit).toEqual({
      definition: {
        color: 'purple',
        filters,
        icon: 'view',
        listPropertiesDisplay: ['belongs_to', 'tags'],
        name: 'Active Procedures',
        sort: 'modified:desc',
      },
      type: 'createView',
    })
    expect(edit?.definition.filters).not.toBe(filters)
  })

  it('saves edited saved-view metadata, filters, display columns, and sort as a desktop update edit', () => {
    const views = workspaceScenarios.default.views ?? []
    const filters: MobileViewFilterGroup = {
      all: [
        { field: 'type', op: 'equals', value: 'Essay' },
        { field: 'tags', op: 'any_of', value: ['Design', 'AI'] },
      ],
    }
    const edit = viewDefinitionSaveEdit({
      viewDisplayProperties: ['Status', 'Priority', 'Status', ''],
      viewFilters: filters,
      viewIcon: 'tag',
      viewName: '  Active Essays  ',
      viewSort: 'property:Priority:asc',
      viewTone: 'green',
    }, 'view-active-procedures', views)

    expect(edit).toEqual({
      definition: {
        ...requiredFixture(views[0]).definition,
        color: 'green',
        filters,
        icon: 'tag',
        listPropertiesDisplay: ['Status', 'Priority'],
        name: 'Active Essays',
        sort: 'property:Priority:asc',
      },
      type: 'updateView',
      viewId: 'view-active-procedures',
    })
    expect(edit?.definition.filters).not.toBe(filters)
    const savedEdit = requiredFixture(edit)
    if ('all' in savedEdit.definition.filters && 'all' in filters) {
      const editedTagFilter = savedEdit.definition.filters.all[1]
      const originalTagFilter = filters.all[1]
      if (!('value' in editedTagFilter) || !('value' in originalTagFilter)) {
        throw new Error('Expected condition filters')
      }
      expect(editedTagFilter.value).not.toBe(originalTagFilter.value)
    } else {
      throw new Error('Expected all-filter saved-view edit')
    }
  })

  it('preserves desktop saved-view icon keys that mobile renders with a fallback glyph', () => {
    const [view] = workspaceScenarios.default.views ?? []
    const views = view
      ? [{ ...view, definition: { ...view.definition, icon: 'rocket' } }]
      : []

    const edit = viewDefinitionSaveEdit({
      viewDisplayProperties: [],
      viewFilters: { all: [] },
      viewIcon: 'rocket',
      viewName: 'Rocket View',
      viewSort: '',
      viewTone: null,
    }, 'view-active-procedures', views)

    expect(edit?.definition.icon).toBe('rocket')
  })

  it('preserves desktop saved-view colors outside the mobile swatch shortcuts', () => {
    const [view] = workspaceScenarios.default.views ?? []
    const views = view
      ? [{ ...view, definition: { ...view.definition, color: 'cyan' } }]
      : []

    const edit = viewDefinitionSaveEdit({
      viewDisplayProperties: [],
      viewFilters: { all: [] },
      viewIcon: 'view',
      viewName: 'Custom Color View',
      viewSort: '',
      viewTone: 'cyan',
    }, 'view-active-procedures', views)

    expect(edit?.definition.color).toBe('cyan')
  })

  it('normalizes saved-view filter value shapes before writing desktop YAML edits', () => {
    const filters: MobileViewFilterGroup = {
      all: [
        { field: 'tags', op: 'is_empty', regex: true, value: 'Design' },
        { field: 'tags', op: 'any_of', regex: true, value: 'Design, AI' },
        { field: 'tags', op: 'equals', regex: true, value: ['Design', 'AI, UX'] },
        {
          any: [
            { field: 'status', op: 'is_not_empty', value: 'Draft' },
            { field: 'type', op: 'none_of', value: ['Type'] },
          ],
        },
      ],
    }

    expect(viewDefinitionCreateEdit({
      viewDisplayProperties: [],
      viewFilters: filters,
      viewIcon: '',
      viewName: 'Filter parity',
      viewSort: '',
      viewTone: null,
    })).toMatchObject({
      definition: {
        filters: {
          all: [
            { field: 'tags', op: 'is_empty' },
            { field: 'tags', op: 'any_of', value: ['Design', 'AI'] },
            { field: 'tags', op: 'equals', regex: true, value: 'Design, "AI, UX"' },
            {
              any: [
                { field: 'status', op: 'is_not_empty' },
                { field: 'type', op: 'none_of', value: ['Type'] },
              ],
            },
          ],
        },
      },
    })
  })

  it('rejects blank names and missing desktop saved views', () => {
    const views = workspaceScenarios.default.views ?? []

    expect(viewDefinitionCreateEdit({
      viewDisplayProperties: [],
      viewFilters: { all: [] },
      viewIcon: '',
      viewName: '   ',
      viewSort: '',
      viewTone: null,
    })).toBeNull()
    expect(viewDefinitionSaveEdit({
      viewDisplayProperties: [],
      viewFilters: { all: [] },
      viewIcon: '',
      viewName: '   ',
      viewSort: '',
      viewTone: null,
    }, 'view-active-procedures', views)).toBeNull()
    expect(viewDefinitionSaveEdit({
      viewDisplayProperties: [],
      viewFilters: { all: [] },
      viewIcon: '',
      viewName: 'Missing',
      viewSort: '',
      viewTone: null,
    }, 'missing-view', views)).toBeNull()
  })
})
