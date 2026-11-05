import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'
import { evaluateMobileSavedView } from './mobileSavedViews'
import type { MobileNote } from './mobileWorkspaceModel'

describe('applyMobileWorkspaceEdit', () => {
  it('creates saved-view YAML writes and updates the sidebar view section', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      definition: {
        color: 'purple',
        filters: { all: [{ field: 'type', op: 'equals', value: 'Procedure' }] },
        icon: 'star',
        name: 'Procedures',
        sort: 'modified:desc',
      },
      type: 'createView',
    })

    expect(result.writes).toContainEqual({
      content: expect.stringContaining('name: "Procedures"'),
      kind: 'saveView',
      path: 'views/procedures.yml',
    })
    expect(result.writes).toContainEqual(expect.objectContaining({
      content: expect.stringContaining('icon: "star"'),
      path: 'views/procedures.yml',
    }))
    expect(result.writes).toContainEqual(expect.objectContaining({
      content: expect.stringContaining('color: "purple"'),
      path: 'views/procedures.yml',
    }))
    expect(result.writes).toContainEqual(expect.objectContaining({
      content: expect.stringContaining('name: "Active Procedures"'),
      kind: 'saveView',
      path: 'views/active-procedures.yml',
    }))
    expect(result.writes).toContainEqual(expect.objectContaining({
      content: expect.stringContaining('order: 1'),
      path: 'views/procedures.yml',
    }))
    expect(result.snapshot.views?.map((view) => view.definition.name)).toContain('Procedures')
    expect(result.snapshot.views?.find((view) => view.filename === 'procedures.yml')?.definition.order).toBe(1)
    expect(result.snapshot.sidebarSections.find((section) => section.id === 'views')?.items).toContainEqual(
      expect.objectContaining({
        count: '1',
        icon: 'star',
        id: 'view-procedures',
        label: 'Procedures',
        tone: 'purple',
        viewId: 'view-procedures',
      }),
    )
  })

  it('keeps user-created saved views on desktop field semantics', () => {
    const base = workspaceScenarioForId('default')
    const customPropertyMatch: MobileNote = {
      ...base.notes[0],
      id: 'custom-property-match',
      organized: false,
      path: 'Actual/Location.md',
      properties: [
        { key: 'path', label: 'Path', value: 'Roadmap' },
        { key: 'organized', label: 'Organized', value: 'planned' },
      ],
      title: 'Custom property match',
    }
    const metadataOnlyMatch: MobileNote = {
      ...base.notes[1],
      id: 'metadata-only-match',
      organized: true,
      path: 'Roadmap',
      properties: [],
      title: 'Metadata-only match',
    }
    const result = applyMobileWorkspaceEditWithWrites({
      ...base,
      allNotes: [customPropertyMatch, metadataOnlyMatch],
      notes: [customPropertyMatch, metadataOnlyMatch],
    }, {
      definition: {
        color: null,
        filters: {
          all: [
            { field: 'path', op: 'equals', value: 'Roadmap' },
            { field: 'organized', op: 'equals', value: 'planned' },
          ],
        },
        icon: null,
        name: 'Roadmap',
        sort: null,
      },
      type: 'createView',
    })
    const view = result.snapshot.views?.find((candidate) => candidate.filename === 'roadmap.yml')
    if (!view) throw new Error('Missing created saved view')

    expect('evaluationMode' in view.definition).toBe(false)
    expect(evaluateMobileSavedView(view, result.snapshot.allNotes ?? [])).toEqual([customPropertyMatch])
  })

  it('updates saved-view YAML without changing the filename', () => {
    const result = updateActiveSavedView()

    expectUpdatedSavedViewWrite(result)
    expectUpdatedSavedViewSnapshot(result)
  })

  it('deletes saved views and keeps an empty sidebar section for creating the next view', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      type: 'deleteView',
      viewId: 'view-active-procedures',
    })

    expect(result.writes).toEqual([{
      kind: 'deleteView',
      path: 'views/active-procedures.yml',
    }])
    expect(result.snapshot.views).toEqual([])
    expect(result.snapshot.sidebarSections.find((section) => section.id === 'views')).toMatchObject({
      id: 'views',
      items: [],
      label: 'Views',
    })
  })

  it('moves saved views and persists desktop-style dense order values', () => {
    const base = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      definition: {
        color: 'green',
        filters: { all: [{ field: 'type', op: 'equals', value: 'Essay' }] },
        icon: null,
        name: 'Essays',
        sort: 'modified:desc',
      },
      type: 'createView',
    }).snapshot
    const result = applyMobileWorkspaceEditWithWrites(base, {
      direction: 'up',
      type: 'moveView',
      viewId: 'view-essays',
    })

    expect(result.snapshot.views?.map((view) => view.filename)).toEqual(['essays.yml', 'active-procedures.yml'])
    expect(result.snapshot.views?.map((view) => view.definition.order)).toEqual([0, 1])
    expect(result.writes).toEqual([
      {
        content: expect.stringContaining('order: 0'),
        kind: 'saveView',
        path: 'views/essays.yml',
      },
      {
        content: expect.stringContaining('order: 1'),
        kind: 'saveView',
        path: 'views/active-procedures.yml',
      },
    ])
    expect(result.snapshot.sidebarSections.find((section) => section.id === 'views')?.items?.map((item) => item.label)).toEqual([
      'Essays',
      'Active Procedures',
    ])
  })
})

function updateActiveSavedView() {
  return applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
    definition: {
      color: 'purple',
      filters: { all: [{ field: 'status', op: 'equals', value: 'Active' }] },
      icon: 'folder',
      listPropertiesDisplay: ['belongs_to', 'status'],
      name: 'Active Workflows',
      sort: 'property:Priority:asc',
    },
    type: 'updateView',
    viewId: 'view-active-procedures',
  })
}

function expectUpdatedSavedViewWrite(
  result: ReturnType<typeof applyMobileWorkspaceEditWithWrites>,
) {
  const savedViewWrite = result.writes.find((write) => write.kind === 'saveView')

  expect(result.writes).toHaveLength(1)
  expect(savedViewWrite).toMatchObject({
    kind: 'saveView',
    path: 'views/active-procedures.yml',
  })
  expect(savedViewWrite?.content).toContain('name: "Active Workflows"')
  expect(savedViewWrite?.content).toContain('icon: "folder"')
  expect(savedViewWrite?.content).toContain('color: "purple"')
  expect(savedViewWrite?.content).toContain('value: "Active"')
  expect(savedViewWrite?.content).toContain('sort: "property:Priority:asc"')
  expect(savedViewWrite?.content).toContain('listPropertiesDisplay:\n  - "belongs_to"\n  - "status"')
}

function expectUpdatedSavedViewSnapshot(
  result: ReturnType<typeof applyMobileWorkspaceEditWithWrites>,
) {
  expect(result.snapshot.views?.[0]?.definition).toMatchObject({
    color: 'purple',
    icon: 'folder',
    listPropertiesDisplay: ['belongs_to', 'status'],
    name: 'Active Workflows',
    sort: 'property:Priority:asc',
  })
  expect(result.snapshot.sidebarSections.find((section) => section.id === 'views')?.items?.[0]).toMatchObject({
    icon: 'folder',
    id: 'view-active-procedures',
    label: 'Active Workflows',
    tone: 'purple',
  })
}
