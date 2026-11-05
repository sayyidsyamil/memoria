import { expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { parseMobileSavedViewFile, serializeMobileSavedViewDefinition } from '../workspace/mobileSavedViews'
import type { MobileViewDefinition, MobileViewFilterCondition, MobileViewFilterGroup, MobileViewFilterNode } from '../workspace/mobileWorkspaceModel'
import { workspacePersistenceProof } from './nativeWorkspacePersistenceReadback'
import { updatedNativeProofViewDefinition } from './nativeWorkspacePersistenceScenario'

const emptyContent = {
  createdTitleLessContent: null,
  favoriteAlphaContent: null,
  favoriteBetaContent: null,
  metadataContent: null,
  movedContent: null,
  notePathContent: {
    bulkArchivedContent: null,
    bulkOrganizedContent: null,
    renamedNoteFileContent: null,
    renamedNoteFileInboundContent: null,
    titleRenameContent: null,
    titleRenameInboundContent: null,
  },
  propertyRelationshipContent: null,
  relationshipSourceContent: null,
  removedIconContent: null,
  renamedAssignedContent: null,
  restoredNoteContent: null,
  textFileContent: null,
}

function updatedViewReadback(definition: MobileViewDefinition) {
  const view = parseMobileSavedViewFile({
    content: serializeMobileSavedViewDefinition(definition),
    relativePath: 'views/update-native-proof.yml',
  }, 0)
  if (!view) throw new Error('Expected a persisted view fixture')
  return workspacePersistenceProof({ ...workspaceScenarioForId('default'), views: [view] }, emptyContent)
    .updatedViewHydrated
}

it('accepts persisted nested filters despite YAML changing object key insertion order', () => {
  expect(updatedViewReadback(updatedNativeProofViewDefinition())).toBe(true)
})

it.each(['color', 'icon', 'sort', 'name'] as const)('rejects a changed %s in the persisted view', (key) => {
  expect(updatedViewReadback({ ...updatedNativeProofViewDefinition(), [key]: 'changed' })).toBe(false)
})

it('rejects missing list display properties in the persisted view', () => {
  expect(updatedViewReadback({ ...updatedNativeProofViewDefinition(), listPropertiesDisplay: ['status'] })).toBe(false)
})

const incompleteFilterTrees: MobileViewFilterGroup[] = [
  { all: [] },
  { any: [] },
  { all: [{ field: 'status', op: 'equals', value: 'Active', regex: false }] },
  { all: [{ field: 'ReviewScore', op: 'equals', value: '5', regex: false }] },
  { all: [{ field: 'title', op: 'contains', value: '^Mobile\\s+Persistence', regex: false }] },
]

it.each(incompleteFilterTrees)('rejects changed or missing nested filters %#', (filters) => {
  expect(updatedViewReadback({ ...updatedNativeProofViewDefinition(), filters })).toBe(false)
})

it('rejects reordered filter conditions rather than silently changing the proof contract', () => {
  const definition = updatedNativeProofViewDefinition()
  const filters = definition.filters
  if (!('all' in filters)) throw new Error('Expected an all-group fixture')
  expect(updatedViewReadback({ ...definition, filters: { all: [...filters.all].reverse() } })).toBe(false)
})

function changedNestedCondition(patch: Partial<MobileViewFilterCondition>) {
  const definition = updatedNativeProofViewDefinition()
  const filters = structuredClone(definition.filters)
  if (!('all' in filters)) throw new Error('Expected an all-group fixture')
  const condition = anyGroupConditions(filters.all[0])[0]
  if (!condition || !('field' in condition)) throw new Error('Expected a nested condition fixture')
  Object.assign(condition, patch)
  return { ...definition, filters }
}

function anyGroupConditions(group: MobileViewFilterNode | undefined) {
  if (!group || !('any' in group)) throw new Error('Expected a nested any-group fixture')
  return group.any
}

it.each<[string, Partial<MobileViewFilterCondition>]>([
  ['field', { field: 'Type' }],
  ['operator', { op: 'not_equals' }],
  ['regex', { regex: true }],
  ['value', { value: 'Archived' }],
  ['value type', { value: ['Active'] }],
])('rejects an individually changed nested %s', (_name, patch) => {
  expect(updatedViewReadback(changedNestedCondition(patch))).toBe(false)
})
