import { describe, expect, it } from 'vitest'
import {
  emptyTabletNavigationHistory,
  favoriteNeighborhoodSelectionForSidebarItem,
  filterNotesBySearch,
  noteListFilterCountsForSelection,
  noteListPropertiesForSelection,
  notesForSidebarSelection,
  pushTabletNavigationHistory,
  traverseTabletNavigationHistory,
  type TabletNavigationHistoryEntry,
  type TabletSidebarSelection,
} from './tabletWorkspaceNavigation'
import type { MobileNote, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'

describe('tablet workspace navigation', () => {
  it('records desktop-style back and forward history for logical mobile selections', () => {
    const inbox = navigationEntry(primarySelection('inbox', 'Inbox'), 'workflow')
    const allNotes = navigationEntry(primarySelection('all-notes', 'All Notes'), 'open-source-project')
    const folder = navigationEntry({ id: 'Memoria/Mobile UI', kind: 'folder', label: 'Mobile UI' }, 'workflow')
    let history = emptyTabletNavigationHistory()

    history = pushTabletNavigationHistory(history, inbox, allNotes)
    history = pushTabletNavigationHistory(history, allNotes, folder)

    const backToAllNotes = traverseTabletNavigationHistory(history, 'back', folder)
    expect(backToAllNotes.entry).toEqual(allNotes)
    expect(backToAllNotes.history.forwardStack).toEqual([folder])

    const backToInbox = traverseTabletNavigationHistory(backToAllNotes.history, 'back', allNotes)
    expect(backToInbox.entry).toEqual(inbox)

    const forwardToAllNotes = traverseTabletNavigationHistory(backToInbox.history, 'forward', inbox)
    expect(forwardToAllNotes.entry).toEqual(allNotes)
  })

  it('does not record duplicate workspace navigation entries', () => {
    const inbox = navigationEntry(primarySelection('inbox', 'Inbox'), 'workflow')
    const renamedInbox = navigationEntry(primarySelection('inbox', 'Inbox label changed'), 'workflow')

    expect(pushTabletNavigationHistory(emptyTabletNavigationHistory(), inbox, renamedInbox)).toEqual(
      emptyTabletNavigationHistory(),
    )
  })

  it('uses canonical type names for renamed desktop Type sidebar sections', () => {
    const snapshot = workspaceSnapshot([
      note({ archived: true, id: 'archived', properties: [{ key: 'Priority', label: 'Priority', value: 0 }], title: 'Archived', type: 'Project' }),
      note({ id: 'high', properties: [{ key: 'Priority', label: 'Priority', value: 1 }], title: 'High', type: 'Project' }),
      note({ id: 'low', properties: [{ key: 'Priority', label: 'Priority', value: 2 }], title: 'Low', type: 'Project' }),
      note({ id: 'label-match', title: 'Wrong Type', type: 'Client Work' }),
      note({ id: 'plain-note', title: 'Plain', type: 'Note' }),
    ])
    const selection: TabletSidebarSelection = {
      id: 'type-project',
      kind: 'item',
      label: 'Client Work',
      sectionId: 'types',
      typeName: 'Project',
    }

    expect(notesForSidebarSelection(snapshot, selection).map((candidate) => candidate.id)).toEqual(['high', 'low'])
    expect(noteListFilterCountsForSelection(snapshot, selection)).toEqual({ archived: 1, open: 2 })
    expect(notesForSidebarSelection(snapshot, selection, { noteListFilter: 'archived' }).map((candidate) => candidate.id)).toEqual(['archived'])
    expect(noteListPropertiesForSelection(snapshot, selection)).toEqual(['Priority', 'belongs_to'])
  })

  it('derives canonical Type names from legacy plural sidebar labels', () => {
    const snapshot: MobileWorkspaceSnapshot = {
      ...workspaceSnapshot([
        note({ id: 'responsibility', properties: [{ key: 'Owner', label: 'Owner', value: 'Luca' }], title: 'Roadmap', type: 'Responsibility' }),
        note({ id: 'person', title: 'Ada', type: 'Person' }),
        note({ id: 'wrong', title: 'Essay', type: 'Responsibilities' }),
      ]),
      sidebarSections: [{
        id: 'types',
        items: [
          { count: '1', icon: 'tag', id: 'type-responsibilities', label: 'Responsibilities' },
          { count: '1', icon: 'file', id: 'type-people', label: 'People' },
        ],
        label: 'Types',
      }],
      typeDefinitions: {
        Person: { listPropertiesDisplay: ['Role'] },
        Responsibility: { listPropertiesDisplay: ['Owner'] },
      },
    }

    const responsibilities: TabletSidebarSelection = {
      id: 'type-responsibilities',
      kind: 'item',
      label: 'Responsibilities',
      sectionId: 'types',
    }
    const people: TabletSidebarSelection = {
      id: 'type-people',
      kind: 'item',
      label: 'People',
      sectionId: 'types',
    }

    expect(notesForSidebarSelection(snapshot, responsibilities).map((candidate) => candidate.id)).toEqual(['responsibility'])
    expect(noteListPropertiesForSelection(snapshot, responsibilities)).toEqual(['Owner'])
    expect(notesForSidebarSelection(snapshot, people).map((candidate) => candidate.id)).toEqual(['person'])
    expect(noteListPropertiesForSelection(snapshot, people)).toEqual(['Role'])
  })

  it('filters note lists by displayed desktop property and relationship chips', () => {
    const notes = [
      note({
        id: 'workflow',
        properties: [{ key: 'Priority', label: 'Priority', value: 'High' }],
        relationships: [{
          kind: 'belongsTo',
          key: 'belongs_to',
          values: [{ id: 'parent', title: 'LLM Workflow', type: 'Essay', typeTone: 'green' }],
        }],
        title: 'Workflow Orchestration',
      }),
      note({
        id: 'release',
        properties: [{ key: 'Priority', label: 'Priority', value: 'Low' }],
        title: 'Release Notes',
      }),
    ]

    expect(filterNotesBySearch(notes, 'llm workflow', { displayPropertyKeys: ['belongs_to'] }).map((candidate) => candidate.id)).toEqual(['workflow'])
    expect(filterNotesBySearch(notes, 'high', { displayPropertyKeys: ['Priority'] }).map((candidate) => candidate.id)).toEqual(['workflow'])
    expect(filterNotesBySearch(notes, 'llm workflow', { displayPropertyKeys: ['Priority'] })).toEqual([])
  })

  it('uses Type display defaults for primary note-list search until a primary override is set', () => {
    const notes = [
      note({
        id: 'workflow',
        properties: [{ key: 'Priority', label: 'Priority', value: 'High' }],
        title: 'Workflow Orchestration',
        type: 'Essay',
      }),
      note({
        id: 'release',
        properties: [{ key: 'Priority', label: 'Priority', value: 'Low' }],
        title: 'Release Notes',
        type: 'Procedure',
      }),
    ]
    const snapshot = {
      ...workspaceSnapshot(notes),
      noteListPropertyOverrides: { allNotes: ['tags'] },
      typeDefinitions: {
        Essay: { listPropertiesDisplay: ['Priority'] },
        Procedure: { listPropertiesDisplay: ['Priority'] },
      },
    }
    const allNotesSelection: TabletSidebarSelection = {
      id: 'all-notes',
      kind: 'item',
      label: 'All Notes',
      sectionId: 'primary',
    }

    expect(filterNotesBySearch(notes, 'high', { typeDefinitions: snapshot.typeDefinitions }).map((candidate) => candidate.id)).toEqual(['workflow'])
    expect(noteListPropertiesForSelection(snapshot, allNotesSelection)).toEqual(['tags'])
    expect(filterNotesBySearch(notes, 'high', {
      displayPropertyKeys: noteListPropertiesForSelection(snapshot, allNotesSelection),
      typeDefinitions: snapshot.typeDefinitions,
    })).toEqual([])
  })

  it('opens the selected active favorite note instead of every favorite or title match', () => {
    const snapshot = workspaceSnapshot([
      note({ favorite: true, id: 'selected', title: 'Journal' }),
      note({ id: 'same-title', title: 'Journal' }),
      note({ archived: true, favorite: true, id: 'archived-favorite', title: 'Archived' }),
      note({ favorite: true, id: 'other-favorite', title: 'Other' }),
    ])

    expect(notesForSidebarSelection(snapshot, {
      id: 'favorite-selected',
      kind: 'item',
      label: 'Journal',
      sectionId: 'favorites',
    }).map((candidate) => candidate.id)).toEqual(['selected'])
  })

  it('resolves favorite sidebar items to desktop Neighborhood selections', () => {
    const snapshot = workspaceSnapshot([
      note({ favorite: true, id: 'alpha', title: 'Alpha' }),
      note({ favorite: true, id: 'duplicate-title', title: 'Journal' }),
      note({ archived: true, favorite: true, id: 'archived', title: 'Archived' }),
    ])

    expect(favoriteNeighborhoodSelectionForSidebarItem(snapshot, {
      id: 'favorite-alpha',
      label: 'Different label',
      sectionId: 'favorites',
    })).toEqual({
      id: 'alpha',
      kind: 'entity',
      label: 'Alpha',
    })
    expect(favoriteNeighborhoodSelectionForSidebarItem(snapshot, {
      id: 'legacy-journal',
      label: 'Journal',
      sectionId: 'favorites',
    })).toEqual({
      id: 'duplicate-title',
      kind: 'entity',
      label: 'Journal',
    })
    expect(favoriteNeighborhoodSelectionForSidebarItem(snapshot, {
      id: 'favorite-archived',
      label: 'Archived',
      sectionId: 'favorites',
    })).toBeNull()
    expect(favoriteNeighborhoodSelectionForSidebarItem(snapshot, {
      id: 'all-notes',
      label: 'All Notes',
      sectionId: 'primary',
    })).toBeNull()
  })

  it('keeps inbox limited to active unorganized non-Type notes', () => {
    const inboxSelection: TabletSidebarSelection = {
      id: 'inbox',
      kind: 'item',
      label: 'Inbox',
      sectionId: 'primary',
    }

    expect(notesForSidebarSelection(workspaceSnapshot([
      note({ id: 'organized', organized: true, title: 'Organized' }),
      note({ archived: true, id: 'archived', title: 'Archived' }),
    ]), inboxSelection)).toEqual([])

    expect(notesForSidebarSelection(workspaceSnapshot([
      note({ id: 'capture', title: 'Capture' }),
      note({ id: 'type-doc', title: 'Type Doc', type: 'Type' }),
      note({ organized: true, id: 'organized', title: 'Organized' }),
    ]), inboxSelection).map((candidate) => candidate.id)).toEqual(['capture'])
  })

  it('keeps primary filters markdown-only by default while folder navigation can show file entries', () => {
    const snapshot = workspaceSnapshot([
      note({ id: 'root', path: 'Root.md', title: 'Root' }),
      note({ fileKind: 'text', id: 'docs/config.yml', path: 'docs/config.yml', title: 'config.yml', type: 'File' }),
      note({ fileKind: 'binary', id: 'docs/logo.png', path: 'docs/logo.png', title: 'logo.png', type: 'File' }),
      note({ fileKind: 'binary', id: 'docs/manual.pdf', path: 'docs/manual.pdf', title: 'manual.pdf', type: 'File' }),
      note({ id: 'attachments/reference.md', path: 'attachments/reference.md', title: 'Reference' }),
      note({ archived: true, id: 'archive/old.md', path: 'archive/old.md', title: 'Old' }),
      note({ archived: true, fileKind: 'binary', id: 'archive/old.zip', path: 'archive/old.zip', title: 'old.zip', type: 'File' }),
    ])

    expect(notesForSidebarSelection(snapshot, {
      id: 'all-notes',
      kind: 'item',
      label: 'All Notes',
      sectionId: 'primary',
    }).map((candidate) => candidate.id)).toEqual(['root'])
    expect(notesForSidebarSelection(snapshot, {
      id: 'all-notes',
      kind: 'item',
      label: 'All Notes',
      sectionId: 'primary',
    }, { noteListFilter: 'archived' }).map((candidate) => candidate.id)).toEqual(['root'])
    expect(notesForSidebarSelection(snapshot, {
      id: 'archive',
      kind: 'item',
      label: 'Archive',
      sectionId: 'primary',
    }).map((candidate) => candidate.id)).toEqual(['archive/old.md'])
    expect(notesForSidebarSelection(snapshot, {
      id: 'docs',
      kind: 'folder',
      label: 'docs',
    }).map((candidate) => candidate.id)).toEqual(['docs/config.yml', 'docs/logo.png', 'docs/manual.pdf'])
  })

  it('uses desktop All Notes file visibility settings for optional file entries', () => {
    const snapshot = {
      ...workspaceSnapshot([
        note({ id: 'root', path: 'Root.md', title: 'Root' }),
        note({ fileKind: 'text', id: 'docs/config.yml', path: 'docs/config.yml', title: 'config.yml', type: 'File' }),
        note({ fileKind: 'binary', id: 'docs/logo.png', path: 'docs/logo.png', title: 'logo.png', type: 'File' }),
        note({ fileKind: 'binary', id: 'docs/manual.pdf', path: 'docs/manual.pdf', title: 'manual.pdf', type: 'File' }),
        note({ archived: true, fileKind: 'binary', id: 'archive/old.zip', path: 'archive/old.zip', title: 'old.zip', type: 'File' }),
      ]),
      vaultConfig: {
        allNotes: {
          fileVisibility: { images: true, pdfs: true, unsupported: false },
        },
      },
    }
    const selection: TabletSidebarSelection = {
      id: 'all-notes',
      kind: 'item',
      label: 'All Notes',
      sectionId: 'primary',
    }

    expect(notesForSidebarSelection(snapshot, selection).map((candidate) => candidate.id)).toEqual([
      'root',
      'docs/logo.png',
      'docs/manual.pdf',
    ])

    const unsupportedSnapshot = {
      ...snapshot,
      vaultConfig: {
        allNotes: {
          fileVisibility: { images: false, pdfs: false, unsupported: true },
        },
      },
    }

    expect(notesForSidebarSelection(unsupportedSnapshot, selection).map((candidate) => candidate.id)).toEqual([
      'root',
      'docs/config.yml',
    ])
  })

  it('selects folders by path and includes descendants without matching duplicate labels', () => {
    const snapshot = workspaceSnapshot([
      note({ id: 'writing-root', path: 'Writing/Root.md', title: 'Root' }),
      note({ id: 'writing-project', path: 'Writing/Projects/Alpha.md', title: 'Alpha' }),
      note({ archived: true, id: 'writing-archived', path: 'Writing/Archived.md', title: 'Archived' }),
      note({ id: 'other-project', path: 'Other/Projects/Beta.md', title: 'Beta' }),
      note({ id: 'other-root', path: 'Other/Root.md', title: 'Other root' }),
    ])

    expect(notesForSidebarSelection(snapshot, {
      id: 'Writing',
      kind: 'folder',
      label: 'Writing',
    }).map((candidate) => candidate.id)).toEqual(['writing-root', 'writing-project'])
    expect(noteListFilterCountsForSelection(snapshot, {
      id: 'Writing',
      kind: 'folder',
      label: 'Writing',
    })).toEqual({ archived: 1, open: 2 })
    expect(notesForSidebarSelection(snapshot, {
      id: 'Writing',
      kind: 'folder',
      label: 'Writing',
    }, { noteListFilter: 'archived' }).map((candidate) => candidate.id)).toEqual(['writing-archived'])

    expect(notesForSidebarSelection(snapshot, {
      id: 'Writing/Projects',
      kind: 'folder',
      label: 'Projects',
    }).map((candidate) => candidate.id)).toEqual(['writing-project'])
  })
})

function workspaceSnapshot(notes: MobileNote[]): MobileWorkspaceSnapshot {
  return {
    allNotes: notes,
    editorBlocks: [],
    editorBullets: [],
    noteListSubtitle: String(notes.length),
    notes,
    sidebarSections: [{
      id: 'types',
      items: [{
        count: '2',
        icon: 'file',
        id: 'type-project',
        label: 'Client Work',
        typeName: 'Project',
      }],
      label: 'Types',
    }],
    sync: { kind: 'synced', minutesAgo: 0 },
    typeDefinitions: {
      Project: {
        label: 'Client Work',
        listPropertiesDisplay: ['Priority', 'belongs_to'],
        sort: 'property:Priority:asc',
      },
    },
  }
}

function navigationEntry(
  sidebarSelection: TabletSidebarSelection,
  selectedNoteId: string | null,
): TabletNavigationHistoryEntry {
  return {
    noteListFilter: 'open',
    selectedNoteId,
    sidebarSelection,
  }
}

function primarySelection(id: string, label: string): TabletSidebarSelection {
  return {
    id,
    kind: 'item',
    label,
    sectionId: 'primary',
  }
}

function note(overrides: Partial<MobileNote>): MobileNote {
  return {
    created: '-',
    date: '-',
    favorite: false,
    id: 'note',
    links: 0,
    modified: '-',
    relationships: [],
    snippet: '',
    status: '',
    tags: [],
    title: 'Note',
    type: 'Note',
    typeTone: 'gray',
    workspace: 'TV',
    ...overrides,
  }
}
