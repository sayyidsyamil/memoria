import { expect } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import {
  applyMobileWorkspaceEdit,
  applyMobileWorkspaceEditWithWrites,
  type MobileWorkspaceEdit,
  type MobileWorkspaceWrite,
} from '../workspace/mobileWorkspaceEditing'
import type { MobileNote, MobileTypeDefinition, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import { mobileWorkspaceHistoryEntry } from './tabletWorkspaceHistory'

export const folderMovementHistoryCases = [
  {
    title: 'undoes and redoes note folder moves through path edits',
    edit: { folderPath: 'Writing/Essays', noteId: 'workflow-orchestration', type: 'moveNoteToFolder' },
    folderPaths: ['Memoria/Mobile UI', 'Writing/Essays'],
    redonePath: 'Writing/Essays/Workflow Orchestration Essay.md',
  },
  {
    title: 'undoes and redoes folder subtree renames through folder edits',
    edit: { folderPath: 'Memoria', name: 'Research', type: 'renameFolder' },
    folderPaths: ['Memoria', 'Memoria/Mobile UI'],
    redonePath: 'Research/Mobile UI/Workflow Orchestration Essay.md',
  },
] satisfies Array<{ title: string; edit: MobileWorkspaceEdit; folderPaths: string[]; redonePath: string }>

export const historyCases1 = [
  {
    edit: {
      definition: {
        color: 'purple' as const,
        filters: { all: [{ field: 'status', op: 'equals' as const, value: 'Active' }] },
        icon: 'folder',
        listPropertiesDisplay: ['belongs_to', 'status'],
        name: 'Active Workflows',
        sort: 'property:Priority:asc',
      },
      type: 'updateView' as const,
      viewId: 'view-active-procedures',
    },
    label: 'saved-view edits',
    redoneViews: ['active-procedures.yml:Active Workflows'],
    undoneViews: ['active-procedures.yml:Active Procedures'],
  },
  {
    edit: {
      direction: 'up' as const,
      type: 'moveView' as const,
      viewId: 'view-essays',
    },
    label: 'saved-view reordering',
    previousSnapshot: savedViewMoveHistorySnapshot(),
    redoneViews: ['essays.yml:Essays', 'active-procedures.yml:Active Procedures'],
    undoneViews: ['active-procedures.yml:Active Procedures', 'essays.yml:Essays'],
  },
  {
    edit: {
      type: 'deleteView' as const,
      viewId: 'view-active-procedures',
    },
    label: 'saved-view deletion',
    redoneViews: [],
    undoneViews: ['active-procedures.yml:Active Procedures'],
  },
]

export const historyCases2 = [
  {
    edit: { type: 'createTypeDefinition' as const, typeName: 'Decision' },
    label: 'Type creation',
    redoneDefinitions: ['Decision', 'Essay', 'Procedure', 'Release'],
    redoneSections: ['Decision', 'Essay', 'Procedure', 'Release'],
    undoneDefinitions: ['Essay', 'Procedure', 'Release'],
    undoneSections: ['Essay', 'Procedure', 'Release'],
  },
  {
    edit: { type: 'deleteTypeDefinition' as const, typeName: 'Procedure' },
    label: 'Type deletion',
    redoneDefinitions: ['Essay', 'Release'],
    redoneSections: ['Essay', 'Procedure', 'Release'],
    undoneDefinitions: ['Essay', 'Procedure', 'Release'],
    undoneSections: ['Essay', 'Procedure', 'Release'],
  },
  {
    edit: { direction: 'up' as const, type: 'moveTypeSection' as const, typeName: 'Procedure' },
    label: 'Type reordering',
    redoneDefinitions: ['Essay', 'Procedure', 'Release'],
    redoneSections: ['Procedure', 'Essay', 'Release'],
    undoneDefinitions: ['Essay', 'Procedure', 'Release'],
    undoneSections: ['Essay', 'Procedure', 'Release'],
  },
]

export const historyCases3 = [
  {
    edit: {
      filenameStem: 'manual-name',
      noteId: 'workflow-orchestration',
      type: 'renameNoteFile' as const,
    },
    label: 'filename renames',
    redonePath: 'Memoria/Mobile UI/manual-name.md',
    redoneTargets: ['[[Memoria/Mobile UI/manual-name]]', '[[Memoria/Mobile UI/manual-name|Workflow]]'],
  },
  {
    edit: {
      folderPath: 'Writing/Essays',
      noteId: 'workflow-orchestration',
      type: 'moveNoteToFolder' as const,
    },
    label: 'folder moves',
    previousSnapshot: { ...titleRenameHistorySnapshot(), folderPaths: ['Memoria/Mobile UI', 'Writing/Essays'] },
    redonePath: 'Writing/Essays/Workflow Orchestration Essay.md',
    redoneTargets: [
      '[[Writing/Essays/Workflow Orchestration Essay]]',
      '[[Writing/Essays/Workflow Orchestration Essay|Workflow]]',
    ],
  },
]

export function expectExactWikilinkPathRoundTrip({
  edit,
  previousSnapshot,
  redonePath,
  redoneTargets,
}: {
  edit: MobileWorkspaceEdit
  previousSnapshot: MobileWorkspaceSnapshot
  redonePath: string
  redoneTargets: string[]
}) {
  const { redoneSnapshot, undoneSnapshot } = expectNotePathRoundTrip({
    edit,
    previousSnapshot,
    redonePath,
    undonePath: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
  })

  expect(noteById(undoneSnapshot, 'open-source-project').rawContent).toBe(pathHistoryRefContent())
  for (const target of redoneTargets) {
    expect(noteById(redoneSnapshot, 'open-source-project').rawContent).toContain(target)
  }
}

export function expectNotePathRoundTrip({
  edit,
  noteId = 'workflow-orchestration',
  previousSnapshot,
  redoneNoteId = noteId,
  redonePath,
  undonePath,
}: {
  edit: MobileWorkspaceEdit
  noteId?: string
  previousSnapshot: MobileWorkspaceSnapshot
  redoneNoteId?: string
  redonePath: string
  undonePath: string
}) {
  const { redoneSnapshot, undoneSnapshot } = historyRoundTrip(previousSnapshot, edit)

  expect(noteById(undoneSnapshot, noteId).path).toBe(undonePath)
  expect(noteById(redoneSnapshot, redoneNoteId).path).toBe(redonePath)

  return { redoneSnapshot, undoneSnapshot }
}

export function expectViewHistoryRoundTrip({
  edit,
  previousSnapshot,
  redoneViews,
  undoneViews,
}: {
  edit: MobileWorkspaceEdit
  previousSnapshot: MobileWorkspaceSnapshot
  redoneViews: string[]
  undoneViews: string[]
}) {
  const { redoneSnapshot, undoneSnapshot } = historyRoundTrip(previousSnapshot, edit)

  expect(viewHistoryLabels(undoneSnapshot)).toEqual(undoneViews)
  expect(viewHistoryLabels(redoneSnapshot)).toEqual(redoneViews)
}

export function savedViewMoveHistorySnapshot(): MobileWorkspaceSnapshot {
  return applyMobileWorkspaceEdit(workspaceScenarioForId('default'), {
    definition: {
      color: 'green',
      filters: { all: [{ field: 'type', op: 'equals', value: 'Essay' }] },
      icon: null,
      name: 'Essays',
      sort: 'modified:desc',
    },
    type: 'createView',
  })
}

export function viewHistoryLabels(snapshot: MobileWorkspaceSnapshot): string[] {
  return (snapshot.views ?? []).map((view) => `${view.filename}:${view.definition.name}`)
}

export function expectTypeHistoryRoundTrip({
  edit,
  previousSnapshot,
  redoneDefinitions,
  redoneSections,
  undoneDefinitions,
  undoneSections,
}: {
  edit: MobileWorkspaceEdit
  previousSnapshot: MobileWorkspaceSnapshot
  redoneDefinitions: string[]
  redoneSections: string[]
  undoneDefinitions: string[]
  undoneSections: string[]
}) {
  const { redoneSnapshot, undoneSnapshot } = historyRoundTrip(previousSnapshot, edit)

  expect(typeDefinitionNames(undoneSnapshot)).toEqual(undoneDefinitions)
  expect(typeDefinitionNames(redoneSnapshot)).toEqual(redoneDefinitions)
  expect(typeSectionNames(undoneSnapshot)).toEqual(undoneSections)
  expect(typeSectionNames(redoneSnapshot)).toEqual(redoneSections)
}

export function typeDefinitionNames(snapshot: MobileWorkspaceSnapshot): string[] {
  return Object.keys(snapshot.typeDefinitions ?? {}).sort()
}

export function typeSectionNames(snapshot: MobileWorkspaceSnapshot): string[] {
  return (snapshot.sidebarSections.find((section) => section.id === 'types')?.items ?? [])
    .map((item) => item.typeName)
    .filter((typeName): typeName is string => Boolean(typeName))
}

export function snapshotWithEditableNote(
  overrides: Partial<MobileNote> & { id: string; rawContent: string },
): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  const notes = base.notes.map((note) => (note.id === overrides.id ? { ...note, ...overrides } : note))
  const allNotes = (base.allNotes ?? base.notes).map((note) =>
    note.id === overrides.id ? { ...note, ...overrides } : note,
  )

  return {
    ...base,
    allNotes,
    notes,
  }
}

export function snapshotWithFolderPaths(folderPaths: string[]): MobileWorkspaceSnapshot {
  return {
    ...workspaceScenarioForId('default'),
    folderPaths,
  }
}

export function snapshotWithPathBackedSelectedNote(): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  const pathBackedNote = {
    ...base.notes[0],
    id: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
  }
  return {
    ...base,
    allNotes: [pathBackedNote, ...base.notes.slice(1)],
    notes: [pathBackedNote, ...base.notes.slice(1)],
    selectedNoteId: pathBackedNote.id,
  }
}

export function relationshipTargetHistorySnapshot(): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  const source = {
    ...noteById(base, 'workflow-orchestration'),
    rawContent: '# Workflow Orchestration Essay\n\nSource body.\n',
  }
  return {
    ...base,
    allNotes: [source, ...base.notes.slice(1)],
    notes: [source, ...base.notes.slice(1)],
    selectedNoteId: source.id,
  }
}

export function typeRenameHistorySnapshot(): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  const essay = {
    ...noteById(base, 'workflow-orchestration'),
    rawContent: '---\ntype: Essay\n---\n# Workflow Orchestration Essay\n\nBody.\n',
  }
  const procedure = {
    ...noteById(base, 'open-source-project'),
    rawContent: '---\ntype: Procedure\n---\n# How I Run an Open Source Project\n\nBody.\n',
  }

  return {
    ...base,
    allNotes: [essay, procedure],
    notes: [essay, procedure],
    selectedNoteId: procedure.id,
  }
}

export function titleRenameHistorySnapshot(): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  const source = {
    ...noteById(base, 'workflow-orchestration'),
    rawContent: ['---', 'title: Workflow Orchestration Essay', 'type: Essay', '---', 'Body without an H1.', ''].join(
      '\n',
    ),
  }
  const ref = {
    ...noteById(base, 'open-source-project'),
    rawContent: pathHistoryRefContent(),
  }

  return {
    ...base,
    allNotes: [source, ref],
    notes: [source, ref],
    selectedNoteId: source.id,
  }
}

export function pathHistoryRefContent(): string {
  return '---\nrelated_to:\n  - [[Workflow Orchestration Essay]]\nbelongs_to:\n  - [[Memoria/Mobile UI/Workflow Orchestration Essay|Workflow]]\n---\n# Ref\n\n[[Workflow Orchestration Essay]] and [[Memoria/Mobile UI/Workflow Orchestration Essay|Workflow]]\n'
}

export function relationshipRefs(note: MobileNote) {
  return Object.fromEntries(
    note.relationships.map((relationship) => [
      relationship.key,
      relationship.values.map((value) => ({ ref: value.ref, title: value.title })),
    ]),
  )
}

export function snapshotWithEditableNotes(notesById: Array<[string, string]>): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  const editableNotes = notesById.map(([noteId, rawContent]) => ({
    ...noteById(base, noteId),
    rawContent,
  }))

  return {
    ...base,
    allNotes: editableNotes,
    notes: editableNotes,
    selectedNoteId: editableNotes[0]?.id,
  }
}

export function noteById(snapshot: MobileWorkspaceSnapshot, noteId: string): MobileNote {
  const note = (snapshot.allNotes ?? snapshot.notes).find((candidate) => candidate.id === noteId)
  if (!note) throw new Error(`Expected note ${noteId}`)
  return note
}

export function noteByIdOptional(snapshot: MobileWorkspaceSnapshot, noteId: string): MobileNote | null {
  return (snapshot.allNotes ?? snapshot.notes).find((candidate) => candidate.id === noteId) ?? null
}

export function typeDefinitionByName(snapshot: MobileWorkspaceSnapshot, typeName: string): MobileTypeDefinition {
  const definition = snapshot.typeDefinitions?.[typeName]
  if (!definition) throw new Error(`Expected type definition ${typeName}`)
  return definition
}

export function requiredHistoryEntry(
  previousSnapshot: MobileWorkspaceSnapshot,
  nextSnapshot: MobileWorkspaceSnapshot,
  sourceEdit: MobileWorkspaceEdit,
) {
  const entry = mobileWorkspaceHistoryEntry(previousSnapshot, nextSnapshot, sourceEdit)
  if (!entry) throw new Error('Expected history entry')
  return entry
}

export function applyHistoryEdits(snapshot: MobileWorkspaceSnapshot, edits: MobileWorkspaceEdit[]) {
  return edits.reduce(applyMobileWorkspaceEdit, snapshot)
}

export function applyHistoryEditsWithWrites(snapshot: MobileWorkspaceSnapshot, edits: MobileWorkspaceEdit[]) {
  return edits.reduce<{ snapshot: MobileWorkspaceSnapshot; writes: MobileWorkspaceWrite[] }>(
    (result, edit) => {
      const nextResult = applyMobileWorkspaceEditWithWrites(result.snapshot, edit)
      return {
        snapshot: nextResult.snapshot,
        writes: [...result.writes, ...nextResult.writes],
      }
    },
    { snapshot, writes: [] },
  )
}

export function historyRoundTrip(previousSnapshot: MobileWorkspaceSnapshot, edit: MobileWorkspaceEdit) {
  const nextSnapshot = applyMobileWorkspaceEdit(previousSnapshot, edit)
  const entry = requiredHistoryEntry(previousSnapshot, nextSnapshot, edit)
  const undoneSnapshot = applyHistoryEdits(nextSnapshot, entry.undoEdits)

  return {
    redoneSnapshot: applyHistoryEdits(undoneSnapshot, entry.redoEdits),
    undoneSnapshot,
  }
}

export function historyRoundTripWithWrites(previousSnapshot: MobileWorkspaceSnapshot, edit: MobileWorkspaceEdit) {
  const nextResult = applyMobileWorkspaceEditWithWrites(previousSnapshot, edit)
  const entry = requiredHistoryEntry(previousSnapshot, nextResult.snapshot, edit)
  const undoResult = applyHistoryEditsWithWrites(nextResult.snapshot, entry.undoEdits)
  const redoResult = applyHistoryEditsWithWrites(undoResult.snapshot, entry.redoEdits)

  return {
    redoWrites: redoResult.writes,
    redoneSnapshot: redoResult.snapshot,
    undoWrites: undoResult.writes,
    undoneSnapshot: undoResult.snapshot,
  }
}

export function neverEdit(): never {
  throw new Error('Expected history entry')
}

export function isUpdateNoteContentEdit(edit: {
  type: string
}): edit is Extract<MobileWorkspaceEdit, { type: 'updateNoteContent' }> {
  return edit.type === 'updateNoteContent'
}
