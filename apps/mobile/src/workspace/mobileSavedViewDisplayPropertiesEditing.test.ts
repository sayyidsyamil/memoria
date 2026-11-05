import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'

describe('saved view display property editing', () => {
  it('persists list display properties when creating a saved view', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      definition: {
        color: null,
        filters: { all: [] },
        icon: null,
        listPropertiesDisplay: ['belongs_to', 'status'],
        name: 'Mobile Inbox View',
        sort: null,
      },
      type: 'createView',
    })

    expect(result.writes).toContainEqual(expect.objectContaining({
      content: expect.stringContaining('listPropertiesDisplay:\n  - "belongs_to"\n  - "status"'),
      path: 'views/mobile-inbox-view.yml',
    }))
    expect(result.snapshot.views?.find((view) => view.filename === 'mobile-inbox-view.yml')?.definition.listPropertiesDisplay).toEqual(['belongs_to', 'status'])
  })
})
