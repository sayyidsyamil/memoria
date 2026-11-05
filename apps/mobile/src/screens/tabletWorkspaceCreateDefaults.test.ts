import { describe, expect, it } from 'vitest'
import { createNoteDefaultsForSelection } from './tabletWorkspaceCreateDefaults'
import type { TabletSidebarSelection } from './tabletWorkspaceNavigation'

describe('tablet workspace create-note defaults', () => {
  it('uses selected type sections as the new note type', () => {
    const selection: TabletSidebarSelection = {
      id: 'type-project',
      kind: 'item',
      label: 'Client Work',
      sectionId: 'types',
      typeName: 'Project',
    }

    expect(createNoteDefaultsForSelection(selection)).toEqual({ type: 'Project' })
  })

  it('canonicalizes legacy type section labels when no explicit type name is present', () => {
    expect(createNoteDefaultsForSelection({
      id: 'type-people',
      kind: 'item',
      label: 'People',
      sectionId: 'types',
    })).toEqual({ type: 'Person' })
    expect(createNoteDefaultsForSelection({
      id: 'type-responsibilities',
      kind: 'item',
      label: 'Responsibilities',
      sectionId: 'types',
    })).toEqual({ type: 'Responsibility' })
  })

  it('copies valued Type document defaults when creating from a type section', () => {
    const selection: TabletSidebarSelection = {
      id: 'type-project',
      kind: 'item',
      label: 'Client Work',
      sectionId: 'types',
      typeName: 'Project',
    }

    expect(createNoteDefaultsForSelection(selection, {
      Project: {
        properties: {
          Empty: '',
          Estimate: 5,
          'Is A': 'Injected Type',
          Milestones: ['Alpha'],
          Optional: false,
          Priority: 'High',
          title: 'Injected Title',
          type: 'Injected Type',
          has: 'Milestone',
          Whitespace: '   ',
        },
        relationships: {
          'Belongs to': ['[[Client Work]]'],
          belongs_to: ['[[Client Work]]'],
          related_to: [],
        },
        template: '## Objective\n\n',
      },
    })).toEqual({
      properties: {
        Estimate: 5,
        Optional: false,
        Priority: 'High',
      },
      relationships: {
        'Belongs to': ['[[Client Work]]'],
      },
      template: '## Objective\n\n',
      type: 'Project',
    })
  })

  it('uses folder selections as the new note folder path', () => {
    expect(createNoteDefaultsForSelection({
      id: 'Writing/Essays',
      kind: 'folder',
      label: 'Essays',
    })).toEqual({ folderPath: 'Writing/Essays' })
  })

  it('does not make new notes favorites when creating from a selected favorite note', () => {
    const selection: TabletSidebarSelection = {
      id: 'favorite-personal-journal.md',
      kind: 'item',
      label: 'Personal Journal',
      sectionId: 'favorites',
    }

    expect(createNoteDefaultsForSelection(selection)).toEqual({})
  })

  it('does not inherit archived state when creating from Archive', () => {
    const selection: TabletSidebarSelection = {
      id: 'archive',
      kind: 'item',
      label: 'Archive',
      sectionId: 'primary',
    }

    expect(createNoteDefaultsForSelection(selection)).toEqual({})
  })

  it('does not derive frontmatter defaults from saved-view filters', () => {
    const selection: TabletSidebarSelection = {
      id: 'view-procedures',
      kind: 'item',
      label: 'Procedures',
      sectionId: 'views',
      viewId: 'view-procedures',
    }

    expect(createNoteDefaultsForSelection(selection)).toEqual({})
  })
})
