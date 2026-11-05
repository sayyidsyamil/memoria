import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { buildMobileSidebarSections } from './mobileSidebarSections'

describe('desktop-compatible sidebar type sections', () => {
  it('does not silently truncate types in larger vaults', () => {
    const note = workspaceScenarioForId('default').notes[0]
    const notes = Array.from({ length: 24 }, (_, index) => ({
      ...note, id: `note-${index}`, type: `Custom${index}`,
    }))
    const types = buildMobileSidebarSections({ notes }).find((section) => section.id === 'types')
    expect(types?.items).toHaveLength(24)
  })

  it('preserves custom labels and uses desktop pluralization for the rest', () => {
    const sections = buildMobileSidebarSections({
      notes: [],
      typeDefinitions: { Person: {}, Day: {}, Box: {}, Responsibility: {}, Article: { label: 'Reading' } },
    })
    expect(sections.find((section) => section.id === 'types')?.items?.map((item) => item.label))
      .toEqual(['Boxes', 'Days', 'People', 'Reading', 'Responsibilities'])
  })
})
