import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEdit, type MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import {
  expectExactWikilinkPathRoundTrip,
  expectNotePathRoundTrip,
  expectViewHistoryRoundTrip,
  expectTypeHistoryRoundTrip,
  typeDefinitionNames,
  typeSectionNames,
  snapshotWithFolderPaths,
  snapshotWithPathBackedSelectedNote,
  typeRenameHistorySnapshot,
  titleRenameHistorySnapshot,
  relationshipRefs,
  snapshotWithEditableNotes,
  noteById,
  typeDefinitionByName,
  requiredHistoryEntry,
  applyHistoryEdits,
  historyRoundTrip,
  historyRoundTripWithWrites,
  historyCases1,
  historyCases2,
  historyCases3,
  folderMovementHistoryCases,
} from './tabletWorkspaceHistoryTestFixtures'

describe('tablet workspace editing history', () => {
  it('undoes and redoes saved views without losing their generated filename', () => {
    const previousSnapshot = workspaceScenarioForId('default')
    const edit: MobileWorkspaceEdit = {
      definition: {
        color: 'purple',
        filters: { all: [{ field: 'type', op: 'equals', value: 'Procedure' }] },
        icon: 'star',
        name: 'Procedure History',
        sort: 'modified:desc',
      },
      type: 'createView',
    }
    const nextSnapshot = applyMobileWorkspaceEdit(previousSnapshot, edit)
    const entry = requiredHistoryEntry(previousSnapshot, nextSnapshot, edit)

    const undoneSnapshot = applyHistoryEdits(nextSnapshot, entry.undoEdits)
    const redoneSnapshot = applyHistoryEdits(undoneSnapshot, entry.redoEdits)

    expect(undoneSnapshot.views?.some((view) => view.filename === 'procedure-history.yml')).toBe(false)
    expect(redoneSnapshot.views?.find((view) => view.filename === 'procedure-history.yml')?.definition).toMatchObject({
      color: 'purple',
      icon: 'star',
      name: 'Procedure History',
    })
  })

  it.each(historyCases1)('undoes and redoes $label exactly', ({ edit, previousSnapshot, redoneViews, undoneViews }) => {
    expectViewHistoryRoundTrip({
      edit,
      previousSnapshot: previousSnapshot ?? workspaceScenarioForId('default'),
      redoneViews,
      undoneViews,
    })
  })

  it('persists saved-view restoration write plans from history', () => {
    const { redoWrites, undoWrites } = historyRoundTripWithWrites(workspaceScenarioForId('default'), {
      type: 'deleteView',
      viewId: 'view-active-procedures',
    })

    expect(undoWrites).toEqual([
      {
        content: expect.stringContaining('name: "Active Procedures"'),
        kind: 'saveView',
        path: 'views/active-procedures.yml',
      },
    ])
    expect(redoWrites).toEqual([{ kind: 'deleteView', path: 'views/active-procedures.yml' }])
  })

  it('undoes and redoes type section metadata updates exactly', () => {
    const previousSnapshot = workspaceScenarioForId('default')
    const edit: MobileWorkspaceEdit = {
      patch: { label: 'Long Essays', tone: 'blue' },
      type: 'updateTypeDefinition',
      typeName: 'Essay',
    }
    const nextSnapshot = applyMobileWorkspaceEdit(previousSnapshot, edit)
    const entry = requiredHistoryEntry(previousSnapshot, nextSnapshot, edit)

    const undoneSnapshot = applyHistoryEdits(nextSnapshot, entry.undoEdits)
    const redoneSnapshot = applyHistoryEdits(undoneSnapshot, entry.redoEdits)
    const undoneDefinition = typeDefinitionByName(undoneSnapshot, 'Essay')
    const redoneDefinition = typeDefinitionByName(redoneSnapshot, 'Essay')

    expect(undoneDefinition.label).toBeUndefined()
    expect(undoneDefinition.tone).toBe('green')
    expect(redoneDefinition.label).toBe('Long Essays')
    expect(redoneDefinition.tone).toBe('blue')
  })

  it.each(historyCases2)(
    'undoes and redoes $label exactly',
    ({ edit, redoneDefinitions, redoneSections, undoneDefinitions, undoneSections }) => {
      expectTypeHistoryRoundTrip({
        edit,
        previousSnapshot: workspaceScenarioForId('default'),
        redoneDefinitions,
        redoneSections,
        undoneDefinitions,
        undoneSections,
      })
    },
  )

  it('undoes and redoes Type renames with assigned note frontmatter', () => {
    const edit: MobileWorkspaceEdit = {
      nextTypeName: 'Playbook',
      type: 'renameTypeDefinition',
      typeName: 'Procedure',
    }
    const { redoneSnapshot, undoneSnapshot } = historyRoundTrip(typeRenameHistorySnapshot(), edit)

    expect(typeDefinitionNames(undoneSnapshot)).toEqual(['Essay', 'Procedure', 'Release'])
    expect(typeSectionNames(undoneSnapshot)).toEqual(['Essay', 'Procedure', 'Release'])
    expect(noteById(undoneSnapshot, 'open-source-project').rawContent).toContain('type: Procedure')
    expect(typeDefinitionNames(redoneSnapshot)).toEqual(['Essay', 'Playbook', 'Release'])
    expect(typeSectionNames(redoneSnapshot)).toEqual(['Essay', 'Playbook', 'Release'])
    expect(noteById(redoneSnapshot, 'open-source-project').rawContent).toContain('type: Playbook')
  })

  it.each(folderMovementHistoryCases)('$title', ({ edit, folderPaths, redonePath }) => {
    expectNotePathRoundTrip({
      edit,
      previousSnapshot: snapshotWithFolderPaths(folderPaths),
      redonePath,
      undonePath: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
    })
  })

  it('undoes and redoes path-backed note filename renames', () => {
    expectNotePathRoundTrip({
      edit: {
        filenameStem: 'workflow-manual',
        noteId: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
        type: 'renameNoteFile',
      },
      noteId: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
      previousSnapshot: snapshotWithPathBackedSelectedNote(),
      redoneNoteId: 'Memoria/Mobile UI/workflow-manual.md',
      redonePath: 'Memoria/Mobile UI/workflow-manual.md',
      undonePath: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
    })
  })

  it.each(historyCases3)(
    'undoes and redoes $label with exact inbound wikilink content',
    ({ edit, previousSnapshot, redonePath, redoneTargets }) => {
      expectExactWikilinkPathRoundTrip({
        edit,
        previousSnapshot: previousSnapshot ?? titleRenameHistorySnapshot(),
        redonePath,
        redoneTargets,
      })
    },
  )

  it('undoes and redoes title-property filename renames with inbound wikilinks', () => {
    const previousSnapshot = titleRenameHistorySnapshot()
    const edit: MobileWorkspaceEdit = {
      key: 'title',
      noteId: 'workflow-orchestration',
      type: 'updateProperty',
      value: 'Renamed Workflow Essay',
    }
    const { redoneSnapshot, undoneSnapshot } = historyRoundTrip(previousSnapshot, edit)
    const undoneSource = noteById(undoneSnapshot, 'workflow-orchestration')
    const undoneRef = noteById(undoneSnapshot, 'open-source-project')
    const redoneSource = noteById(redoneSnapshot, 'workflow-orchestration')
    const redoneRef = noteById(redoneSnapshot, 'open-source-project')

    expect(undoneSource.path).toBe('Memoria/Mobile UI/Workflow Orchestration Essay.md')
    expect(undoneSource.rawContent).toContain('title: Workflow Orchestration Essay')
    expect(undoneRef.rawContent).toContain('[[Workflow Orchestration Essay]]')
    expect(undoneRef.rawContent).toContain('[[Memoria/Mobile UI/Workflow Orchestration Essay|Workflow]]')
    expect(relationshipRefs(undoneRef)).toMatchObject({
      belongs_to: [
        { ref: '[[Memoria/Mobile UI/Workflow Orchestration Essay|Workflow]]', title: 'Workflow Orchestration Essay' },
      ],
      related_to: [{ ref: '[[Workflow Orchestration Essay]]', title: 'Workflow Orchestration Essay' }],
    })
    expect(redoneSource.path).toBe('Memoria/Mobile UI/renamed-workflow-essay.md')
    expect(redoneSource.rawContent).toContain('title: Renamed Workflow Essay')
    expect(redoneRef.rawContent).toContain('[[Memoria/Mobile UI/renamed-workflow-essay]]')
    expect(redoneRef.rawContent).toContain('[[Memoria/Mobile UI/renamed-workflow-essay|Workflow]]')
    expect(relationshipRefs(redoneRef)).toMatchObject({
      belongs_to: [{ ref: '[[Memoria/Mobile UI/renamed-workflow-essay|Workflow]]', title: 'Renamed Workflow Essay' }],
      related_to: [{ ref: '[[Memoria/Mobile UI/renamed-workflow-essay]]', title: 'Renamed Workflow Essay' }],
    })
  })

  it('persists folder restoration write plans from history', () => {
    const { redoWrites, undoWrites } = historyRoundTripWithWrites(
      snapshotWithFolderPaths(['Memoria/Mobile UI', 'Memoria/Releases']),
      {
        name: 'Restored Folder',
        parentPath: 'Workspace QA',
        type: 'createFolder',
      },
    )

    expect(undoWrites).toEqual([{ kind: 'deleteFolder', path: 'Workspace QA/Restored Folder' }])
    expect(redoWrites).toEqual([{ kind: 'createFolder', path: 'Workspace QA/Restored Folder' }])
  })

  it('undoes and redoes primary note-list display property overrides', () => {
    const previousSnapshot = workspaceScenarioForId('default')
    const { redoWrites, redoneSnapshot, undoWrites, undoneSnapshot } = historyRoundTripWithWrites(previousSnapshot, {
      listPropertiesDisplay: [' status ', 'belongs_to', 'Status'],
      target: 'allNotes',
      type: 'updatePrimaryNoteListProperties',
    })

    expect(undoneSnapshot.noteListPropertyOverrides).toBeUndefined()
    expect(undoneSnapshot.vaultConfig).toEqual({
      allNotes: { noteListProperties: null },
    })
    expect(undoWrites).toEqual([
      {
        config: undoneSnapshot.vaultConfig,
        kind: 'saveVaultConfig',
      },
    ])
    expect(redoneSnapshot.noteListPropertyOverrides).toEqual({
      allNotes: ['status', 'belongs_to'],
    })
    expect(redoneSnapshot.vaultConfig).toEqual({
      allNotes: { noteListProperties: ['status', 'belongs_to'] },
    })
    expect(redoWrites).toEqual([
      {
        config: redoneSnapshot.vaultConfig,
        kind: 'saveVaultConfig',
      },
    ])
  })

  it('undoes and redoes persisted default note width', () => {
    const previousSnapshot = workspaceScenarioForId('default')
    const { redoWrites, redoneSnapshot, undoWrites, undoneSnapshot } = historyRoundTripWithWrites(previousSnapshot, {
      mode: 'wide',
      type: 'setDefaultNoteWidth',
    })

    expect(undoneSnapshot.vaultConfig).toEqual({ defaultNoteWidth: 'normal' })
    expect(undoWrites).toEqual([
      {
        config: undoneSnapshot.vaultConfig,
        kind: 'saveVaultConfig',
      },
    ])
    expect(redoneSnapshot.vaultConfig).toEqual({ defaultNoteWidth: 'wide' })
    expect(redoWrites).toEqual([
      {
        config: redoneSnapshot.vaultConfig,
        kind: 'saveVaultConfig',
      },
    ])
  })

  it('undoes primary note-list display resets back to the previous persisted override', () => {
    const previousSnapshot = {
      ...workspaceScenarioForId('default'),
      noteListPropertyOverrides: {
        allNotes: ['priority'],
        inbox: ['status', 'tags'],
      },
      vaultConfig: {
        allNotes: { noteListProperties: ['priority'] },
        inbox: { explicitOrganization: true, noteListProperties: ['status', 'tags'] },
      },
    }
    const { redoWrites, redoneSnapshot, undoWrites, undoneSnapshot } = historyRoundTripWithWrites(previousSnapshot, {
      listPropertiesDisplay: [],
      target: 'inbox',
      type: 'updatePrimaryNoteListProperties',
    })

    expect(undoneSnapshot.noteListPropertyOverrides).toEqual({
      allNotes: ['priority'],
      inbox: ['status', 'tags'],
    })
    expect(undoneSnapshot.vaultConfig).toEqual({
      allNotes: { noteListProperties: ['priority'] },
      inbox: { explicitOrganization: true, noteListProperties: ['status', 'tags'] },
    })
    expect(undoWrites).toEqual([
      {
        config: undoneSnapshot.vaultConfig,
        kind: 'saveVaultConfig',
      },
    ])
    expect(redoneSnapshot.noteListPropertyOverrides).toEqual({
      allNotes: ['priority'],
    })
    expect(redoneSnapshot.vaultConfig).toEqual({
      allNotes: { noteListProperties: ['priority'] },
      inbox: { explicitOrganization: true, noteListProperties: null },
    })
    expect(redoWrites).toEqual([
      {
        config: redoneSnapshot.vaultConfig,
        kind: 'saveVaultConfig',
      },
    ])
  })

  it('undoes and redoes All Notes file visibility with primary note-list settings', () => {
    const previousSnapshot = workspaceScenarioForId('default')
    const { redoWrites, redoneSnapshot, undoWrites, undoneSnapshot } = historyRoundTripWithWrites(previousSnapshot, {
      allNotesFileVisibility: { images: true, pdfs: true, unsupported: false },
      listPropertiesDisplay: ['status'],
      target: 'allNotes',
      type: 'updatePrimaryNoteListProperties',
    })

    expect(undoneSnapshot.vaultConfig).toEqual({
      allNotes: {
        fileVisibility: { images: false, pdfs: false, unsupported: false },
        noteListProperties: null,
      },
    })
    expect(undoWrites).toEqual([
      {
        config: undoneSnapshot.vaultConfig,
        kind: 'saveVaultConfig',
      },
    ])
    expect(redoneSnapshot.noteListPropertyOverrides).toEqual({ allNotes: ['status'] })
    expect(redoneSnapshot.vaultConfig).toEqual({
      allNotes: {
        fileVisibility: { images: true, pdfs: true, unsupported: false },
        noteListProperties: ['status'],
      },
    })
    expect(redoWrites).toEqual([
      {
        config: redoneSnapshot.vaultConfig,
        kind: 'saveVaultConfig',
      },
    ])
  })

  it('records bulk note edits as one reversible history entry', () => {
    const previousSnapshot = snapshotWithEditableNotes([
      ['workflow-orchestration', '# Workflow Orchestration Essay\n\nBulk organize.\n'],
      ['open-source-project', '# How I Run an Open Source Project\n\nBulk organize.\n'],
    ])
    const edit: MobileWorkspaceEdit = {
      edits: previousSnapshot.notes.map((note) => ({ noteId: note.id, organized: true, type: 'setOrganized' })),
      type: 'bulkEdit',
    }
    const nextSnapshot = applyMobileWorkspaceEdit(previousSnapshot, edit)
    const entry = requiredHistoryEntry(previousSnapshot, nextSnapshot, edit)
    const undoneSnapshot = applyHistoryEdits(nextSnapshot, entry.undoEdits)
    const redoneSnapshot = applyHistoryEdits(undoneSnapshot, entry.redoEdits)

    expect(entry.undoEdits).toHaveLength(2)
    expect(undoneSnapshot.notes.map((note) => note.organized)).toEqual([false, false])
    expect(redoneSnapshot.notes.map((note) => note.organized)).toEqual([true, true])
  })
})
