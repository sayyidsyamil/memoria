import type {
  MobileNote,
  MobileTypeDefinition,
  MobileViewDefinition,
  MobileWorkspaceSnapshot,
} from '../workspace/mobileWorkspaceModel'
import {
  nativeWorkspaceNotePathProof,
  type NativeWorkspaceNotePathPersistenceContent,
} from './nativeWorkspaceNotePathPersistenceProbe'
import {
  createdFolderPath,
  createdNotePath,
  createdTitleLessType,
  favoriteAlphaPath,
  favoriteBetaPath,
  metadataNotePath,
  oldTypeName,
  oldViewName,
  propertyRelationshipNotePath,
  propertyRelationshipUrl,
  relationshipTargetPath,
  removedIconNotePath,
  renamedFolderPath,
  renamedTypeAssignedNotePath,
  renamedTypeName,
  renamedTypePath,
  renamedTypeSchemaCarrierName,
  renamedTypeSourceName,
  renamedTypeSourcePath,
  reorderedTypeAlphaName,
  reorderedTypeBetaName,
  reorderedViewAlphaName,
  reorderedViewBetaName,
  restoredFolderPath,
  restoredNotePath,
  restoredTypeName,
  restoredTypeOrder,
  restoredTypePath,
  restoredViewFilename,
  restoredViewName,
  textFilePath,
  textFileUpdatedContent,
  typeName,
  updatedNativeProofViewFilters,
  updatedTypeName,
  updatedTypeTemplate,
  updatedViewName,
} from './nativeWorkspacePersistenceScenario'
import type {
  NativeWorkspacePersistenceProof,
} from './nativeWorkspacePersistenceProbe'
import {
  favoriteLabels,
  folderPathStartsWith,
  joinedProperties,
  noteByPath,
  noteMatches,
  notePropertyValue,
  relationshipRefs,
  snapshotContainsNotePath,
  textContainsAll,
  typeDefinitionExists,
  viewByName,
  viewExists,
} from './nativeWorkspacePersistenceProofHelpers'

type WorkspacePersistenceContent = {
  favoriteAlphaContent: string | null
  favoriteBetaContent: string | null
  createdTitleLessContent: string | null
  metadataContent: string | null
  movedContent: string | null
  notePathContent: NativeWorkspaceNotePathPersistenceContent
  propertyRelationshipContent: string | null
  relationshipSourceContent: string | null
  renamedAssignedContent: string | null
  removedIconContent: string | null
  restoredNoteContent: string | null
  textFileContent: string | null
}

export function workspacePersistenceProof(
  snapshot: MobileWorkspaceSnapshot,
  content: WorkspacePersistenceContent,
): NativeWorkspacePersistenceProof {
  return {
    ...nativeWorkspaceNotePathProof(snapshot, content.notePathContent),
    changedNoteTypeHydrated: changedNoteTypeHydrated(snapshot, content.metadataContent),
    createdNoteHydrated: snapshotContainsNotePath(snapshot, createdNotePath),
    createdTitleLessNoteHydrated: createdTitleLessNoteHydrated(snapshot, content.createdTitleLessContent),
    deletedTypeDefinitionRemoved: !typeDefinitionExists(snapshot, oldTypeName),
    deletedViewRemoved: !viewExists(snapshot, oldViewName),
    defaultNoteWidthHydrated: snapshot.vaultConfig?.defaultNoteWidth === 'wide',
    favoriteOrderHydrated: favoriteOrderHydrated(snapshot, content),
    fileVisibilityHydrated: fileVisibilityHydrated(snapshot),
    folderCreateApplied: folderCreateApplied(snapshot),
    folderDeleteApplied: !folderPathStartsWith(snapshot, 'Scratch'),
    folderRenameApplied: folderRenameApplied(snapshot),
    movedNoteContentPreserved: movedContentPreserved(content.movedContent),
    noteChromeMetadataHydrated: noteChromeMetadataHydrated(snapshot, content.metadataContent),
    noteIconRemovalHydrated: noteIconRemovalHydrated(snapshot, content.removedIconContent),
    noteStateMetadataHydrated: noteStateMetadataHydrated(snapshot, content.metadataContent),
    persistedToNativeRepository: snapshot.source?.kind === 'localVault',
    propertyDeletionHydrated: propertyDeletionHydrated(snapshot, content.propertyRelationshipContent),
    propertyDisplayModesHydrated: propertyDisplayModesHydrated(snapshot),
    propertyValuesHydrated: propertyValuesHydrated(snapshot, content.propertyRelationshipContent),
    relationshipEditHydrated: relationshipEditHydrated(snapshot, content.propertyRelationshipContent),
    relationshipMovedRefHydrated: relationshipMovedRefHydrated(content.relationshipSourceContent),
    relationshipSourceRefHydrated: relationshipSourceRefHydrated(content.relationshipSourceContent),
    relationshipTargetHydrated: snapshotContainsNotePath(snapshot, relationshipTargetPath),
    reorderedTypeSectionHydrated: reorderedTypeSectionHydrated(snapshot),
    reorderedViewHydrated: reorderedViewHydrated(snapshot),
    restoredFolderHydrated: restoredFolderHydrated(snapshot),
    restoredNoteHydrated: restoredNoteHydrated(snapshot, content.restoredNoteContent),
    restoredTypeDefinitionHydrated: restoredTypeDefinitionHydrated(snapshot),
    restoredViewHydrated: restoredViewHydrated(snapshot),
    renamedTypeAssignedNoteHydrated: renamedTypeAssignedNoteHydrated(snapshot, content.renamedAssignedContent),
    renamedTypeDefinitionHydrated: renamedTypeDefinitionHydrated(snapshot),
    renamedTypeSchemaRefsHydrated: renamedTypeSchemaRefsHydrated(snapshot),
    savedViewHydrated: savedViewHydrated(snapshot),
    textFileContentHydrated: textFileContentHydrated(snapshot, content.textFileContent),
    typeDefinitionHydrated: typeDefinitionHydrated(snapshot),
    updatedViewHydrated: updatedViewHydrated(snapshot),
    updatedTypeDefinitionHydrated: updatedTypeDefinitionHydrated(snapshot),
    vaultConfigHydrated: vaultConfigHydrated(snapshot),
  }
}

function folderCreateApplied(snapshot: MobileWorkspaceSnapshot) {
  return snapshot.folderPaths?.includes(createdFolderPath) === true
}

export function createdTitleLessTypedNote(snapshot: MobileWorkspaceSnapshot): MobileNote | undefined {
  return (snapshot.allNotes ?? snapshot.notes).find((note) => (
    (note.path ?? '').match(/^untitled-project-\d+\.md$/u)
      && note.title.startsWith('Untitled Project ')
      && note.type === createdTitleLessType
  ))
}

function createdTitleLessNoteHydrated(snapshot: MobileWorkspaceSnapshot, content: string | null) {
  const note = createdTitleLessTypedNote(snapshot)
  return note !== undefined
    && content?.includes(`type: ${createdTitleLessType}`) === true
    && content.includes('## Objective') === true
    && !content.includes('title:')
}

function folderRenameApplied(snapshot: MobileWorkspaceSnapshot) {
  return snapshot.folderPaths?.includes(renamedFolderPath) === true
    && snapshotContainsNotePath(snapshot, `${renamedFolderPath}/Keep.md`)
}

function restoredFolderHydrated(snapshot: MobileWorkspaceSnapshot) {
  return snapshot.folderPaths?.includes(restoredFolderPath) === true
}

function savedViewHydrated(snapshot: MobileWorkspaceSnapshot) {
  const view = viewByName(snapshot, 'Mobile Persistence')
  return view?.filename === 'mobile-persistence.yml'
    && view.definition.color === 'green'
    && view.definition.icon === 'file-text'
    && view.definition.sort === 'modified:desc'
    && updatedViewFilterHydrated(view.definition.filters, { field: 'type', value: 'Essay' })
}

function reorderedViewHydrated(snapshot: MobileWorkspaceSnapshot) {
  const alpha = viewByName(snapshot, reorderedViewAlphaName)
  const beta = viewByName(snapshot, reorderedViewBetaName)
  return typeof alpha?.definition.order === 'number'
    && typeof beta?.definition.order === 'number'
    && beta.definition.order < alpha.definition.order
}

function restoredViewHydrated(snapshot: MobileWorkspaceSnapshot) {
  const view = viewByName(snapshot, restoredViewName)
  return view?.filename === restoredViewFilename
    && view.definition.order === 7
    && view.definition.icon === 'rotate-ccw'
}

function updatedViewHydrated(snapshot: MobileWorkspaceSnapshot) {
  const view = viewByName(snapshot, updatedViewName)
  return view?.filename === 'update-native-proof.yml'
    && view.definition.color === 'purple'
    && view.definition.icon === 'folder'
    && view.definition.sort === 'property:Priority:asc'
    && joinedProperties(view.definition.listPropertiesDisplay) === 'status|Priority'
    && JSON.stringify(canonicalProofValue(view.definition.filters)) === JSON.stringify(canonicalProofValue(updatedNativeProofViewFilters))
}

function canonicalProofValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalProofValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalProofValue(item)]))
}

function updatedViewFilterHydrated(
  filters: MobileViewDefinition['filters'],
  expected: { field: string; value: string },
) {
  const nodes = 'all' in filters ? filters.all : []
  const condition = nodes[0]
  return nodes.length === 1
    && condition !== undefined
    && 'field' in condition
    && condition.field === expected.field
    && condition.op === 'equals'
    && condition.value === expected.value
}

function updatedTypeDefinitionHydrated(snapshot: MobileWorkspaceSnapshot) {
  const definition = snapshot.typeDefinitions?.[updatedTypeName]
  return definition !== undefined
    && updatedTypeMetadataHydrated(definition)
    && updatedTypeSchemaHydrated(definition)
    && updatedTypeRawContentHydrated(definition.rawContent ?? null)
}

function updatedTypeMetadataHydrated(definition: MobileTypeDefinition) {
  return [
    definition.path === 'section-proof.md',
    definition.tone === 'yellow',
    definition.icon === 'sparkles',
    definition.label === 'Section Proofs',
    definition.order === 3,
    definition.sort === 'property:Priority:desc',
    definition.template === updatedTypeTemplate,
    definition.view === 'Mobile Persistence',
    definition.visible === false,
    joinedProperties(definition.listPropertiesDisplay) === 'status|Priority|belongs_to',
  ].every(Boolean)
}

function updatedTypeSchemaHydrated(definition: MobileTypeDefinition) {
  return [
    definition.properties?.Priority === 'High',
    definition.properties?.ReviewScore === 5,
    joinedProperties(definition.relationships?.depends_on) === '[[Relationships/Source]]',
    joinedProperties(definition.relationships?.related_to) === '[[Research/Seed]]',
  ].every(Boolean)
}

function updatedTypeRawContentHydrated(rawContent: string | null) {
  return textContainsAll(rawContent, [
    '_sidebar_label: Section Proofs',
    '_list_properties_display:',
    'ReviewScore: 5',
    'template: |',
    'visible: false',
  ])
}

function reorderedTypeSectionHydrated(snapshot: MobileWorkspaceSnapshot) {
  const alpha = snapshot.typeDefinitions?.[reorderedTypeAlphaName]
  const beta = snapshot.typeDefinitions?.[reorderedTypeBetaName]
  return typeOrderHydrated(alpha)
    && typeOrderHydrated(beta)
    && beta.order < alpha.order
}

function restoredTypeDefinitionHydrated(snapshot: MobileWorkspaceSnapshot) {
  const definition = snapshot.typeDefinitions?.[restoredTypeName]
  return definition?.path === restoredTypePath
    && definition.order === restoredTypeOrder
    && definition.tone === 'blue'
    && textContainsAll(definition.rawContent ?? null, [`# ${restoredTypeName}`, `_order: ${restoredTypeOrder}`])
}

function typeDefinitionHydrated(snapshot: MobileWorkspaceSnapshot) {
  const definition = snapshot.typeDefinitions?.[typeName]
  return definition?.path === 'proof-decision.md'
    && textContainsAll(definition.rawContent ?? null, [
      'type: Type',
      `# ${typeName}`,
    ])
}

function typeOrderHydrated(definition: MobileTypeDefinition | undefined): definition is MobileTypeDefinition & { order: number } {
  return typeof definition?.order === 'number'
    && textContainsAll(definition.rawContent ?? null, ['_order:'])
}

function vaultConfigHydrated(snapshot: MobileWorkspaceSnapshot) {
  return joinedProperties(snapshot.noteListPropertyOverrides?.allNotes) === 'status|belongs_to'
    && joinedProperties(snapshot.noteListPropertyOverrides?.inbox) === 'tags'
    && snapshot.vaultConfig?.inbox?.explicitOrganization === true
}

function fileVisibilityHydrated(snapshot: MobileWorkspaceSnapshot) {
  const visibility = snapshot.vaultConfig?.allNotes?.fileVisibility
  return visibility?.images === true
    && visibility.pdfs === true
    && visibility.unsupported === false
}

function propertyDisplayModesHydrated(snapshot: MobileWorkspaceSnapshot) {
  return snapshot.vaultConfig?.propertyDisplayModes?.Priority === 'number'
    && snapshot.vaultConfig.propertyDisplayModes.Website === 'url'
}

function textFileContentHydrated(snapshot: MobileWorkspaceSnapshot, content: string | null) {
  const note = noteByPath(snapshot, textFilePath)
  return note?.fileKind === 'text'
    && note.snippet === 'feature=mobile-editing'
    && content === textFileUpdatedContent
}

function favoriteOrderHydrated(
  snapshot: MobileWorkspaceSnapshot,
  content: { favoriteAlphaContent?: string | null; favoriteBetaContent?: string | null },
) {
  return [
    noteByPath(snapshot, favoriteBetaPath)?.favoriteIndex === 0,
    noteByPath(snapshot, favoriteAlphaPath)?.favoriteIndex === 1,
    favoriteLabels(snapshot).join('|') === 'Beta|Alpha',
    textContainsAll(content.favoriteBetaContent ?? null, ['_favorite_index: 0']),
    textContainsAll(content.favoriteAlphaContent ?? null, ['_favorite_index: 1']),
  ].every(Boolean)
}

function propertyValuesHydrated(snapshot: MobileWorkspaceSnapshot, content: string | null) {
  const note = noteByPath(snapshot, propertyRelationshipNotePath)
  return [
    notePropertyValue(note, 'Priority') === 5,
    notePropertyValue(note, 'Published') === true,
    notePropertyValue(note, 'Website') === propertyRelationshipUrl,
    joinedProperties(note?.tags) === 'Mobile|QA',
    textContainsAll(content, ['Priority: 5', 'Published: true', 'Website:', propertyRelationshipUrl]),
  ].every(Boolean)
}

function propertyDeletionHydrated(snapshot: MobileWorkspaceSnapshot, content: string | null) {
  const note = noteByPath(snapshot, propertyRelationshipNotePath)
  return notePropertyValue(note, 'Obsolete') === undefined
    && content?.includes('Obsolete:') === false
}

function relationshipEditHydrated(snapshot: MobileWorkspaceSnapshot, content: string | null) {
  const note = noteByPath(snapshot, propertyRelationshipNotePath)
  return relationshipRefs(note, 'belongs_to').includes('[[Metadata/Chrome State]]')
    && textContainsAll(content, ['belongs_to:', '[[Metadata/Chrome State]]'])
    && content?.includes('[[Writing/Seed]]') === false
}

function movedContentPreserved(content: string | null) {
  return content?.includes('saved before moving through native persistence') === true
}

function restoredNoteHydrated(snapshot: MobileWorkspaceSnapshot, content: string | null) {
  return snapshotContainsNotePath(snapshot, restoredNotePath)
    && textContainsAll(content, ['# Restored Undo Note', 'Restored from mobile history.'])
}

function noteChromeMetadataHydrated(snapshot: MobileWorkspaceSnapshot, content: string | null) {
  const note = noteByPath(snapshot, metadataNotePath)
  return noteMatches(note, { icon: 'star', noteWidth: 'wide' })
    && textContainsAll(content, ['_icon: star', '_width: wide'])
}

function noteIconRemovalHydrated(snapshot: MobileWorkspaceSnapshot, content: string | null) {
  const note = noteByPath(snapshot, removedIconNotePath)
  return noteMatches(note, { icon: null })
    && content?.includes('_icon:') === false
}

function changedNoteTypeHydrated(snapshot: MobileWorkspaceSnapshot, content: string | null) {
  return noteByPath(snapshot, metadataNotePath)?.type === 'Procedure'
    && content?.includes('type: Procedure') === true
}

function noteStateMetadataHydrated(snapshot: MobileWorkspaceSnapshot, content: string | null) {
  const note = noteByPath(snapshot, metadataNotePath)
  return noteMatches(note, { archived: true, favorite: true, organized: true })
    && textContainsAll(content, ['_archived: true', '_organized: true', '_favorite: true', '_favorite_index:'])
}

function relationshipSourceRefHydrated(content: string | null) {
  return content?.includes('related_to:') === true
    && content.includes('native-related-target')
}

function relationshipMovedRefHydrated(content: string | null) {
  return content?.includes('belongs_to:') === true
    && content.includes('Research/Seed')
    && !content.includes('Writing/Seed')
}

function renamedTypeDefinitionHydrated(snapshot: MobileWorkspaceSnapshot) {
  return snapshot.typeDefinitions?.[renamedTypeName]?.tone === 'purple'
    && snapshot.typeDefinitions?.[renamedTypeSourceName] === undefined
    && snapshotContainsNotePath(snapshot, renamedTypePath)
    && !snapshotContainsNotePath(snapshot, renamedTypeSourcePath)
}

function renamedTypeAssignedNoteHydrated(
  snapshot: MobileWorkspaceSnapshot,
  content: string | null,
) {
  return noteByPath(snapshot, renamedTypeAssignedNotePath)?.type === renamedTypeName
    && content?.includes(`type: ${renamedTypeName}`) === true
    && content?.includes('[[rename-target]]') === true
}

function renamedTypeSchemaRefsHydrated(snapshot: MobileWorkspaceSnapshot) {
  const schemaCarrier = snapshot.typeDefinitions?.[renamedTypeSchemaCarrierName]
  return schemaCarrier?.relationships?.related_to?.includes('[[rename-target]]') === true
    && schemaCarrier.rawContent?.includes('[[rename-target]]') === true
}
