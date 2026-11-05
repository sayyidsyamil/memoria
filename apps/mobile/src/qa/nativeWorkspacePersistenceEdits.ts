import type {
  MobileWorkspaceSnapshot,
} from '../workspace/mobileWorkspaceModel'
import {
  nativeWorkspaceNotePathWrites,
} from './nativeWorkspaceNotePathPersistenceProbe'
import {
  createdTitleLessType,
  favoriteBetaPath,
  metadataNotePath,
  mobilePersistenceViewDefinition,
  movedNoteFolderPath,
  oldTypeName,
  oldViewName,
  propertyRelationshipNotePath,
  propertyRelationshipUrl,
  relationshipSourcePath,
  removedIconNotePath,
  renamedTypeName,
  renamedTypeSourceName,
  reorderedTypeBetaName,
  reorderedViewBetaName,
  restoredFolderPath,
  restoredMobileNote,
  restoredMobileView,
  restoredTypeDefinition,
  restoredTypeName,
  seedNoteUpdatedContent,
  textFileInitialContent,
  textFilePath,
  textFileUpdatedContent,
  typeName,
  updatedNativeProofViewDefinition,
  updatedTypeDefinitionPatch,
  updatedTypeName,
  updatedViewSourceName,
  workspacePersistencePropertyDisplayModes,
} from './nativeWorkspacePersistenceScenario'
import {
  applyMobileWorkspaceEditWithWrites,
} from '../workspace/mobileWorkspaceEditing'
import {
  noteByPath,
} from './nativeWorkspacePersistenceProofHelpers'

export function workspacePersistenceProbeWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return [
    ...workspacePersistenceNoteAndRelationshipWrites(seedSnapshot),
    ...workspacePersistenceFavoriteWrites(seedSnapshot),
    ...workspacePersistenceMetadataWrites(seedSnapshot),
    ...workspacePersistencePropertyAndRelationshipWrites(seedSnapshot),
    ...workspacePersistenceRestorationWrites(seedSnapshot),
    ...workspacePersistenceViewWrites(seedSnapshot),
    ...workspacePersistenceConfigWrites(seedSnapshot),
    ...workspacePersistenceTextFileWrites(seedSnapshot),
    ...nativeWorkspaceNotePathWrites(seedSnapshot),
    ...workspacePersistenceFolderWrites(seedSnapshot),
    ...workspacePersistenceTypeMoveWrites(seedSnapshot),
    ...workspacePersistenceTypeWrites(seedSnapshot),
    ...workspacePersistenceTypeUpdateWrites(seedSnapshot),
    ...workspacePersistenceTypeRenameWrites(seedSnapshot),
  ]
}

function workspacePersistenceNoteAndRelationshipWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return workspacePersistenceEditWrites(seedSnapshot, [
    {
      defaults: {
        folderPath: 'Writing/Drafts',
        status: 'Draft',
        tags: ['Mobile'],
        type: 'Essay',
      },
      title: 'Mobile Created',
      type: 'createNote',
    },
    {
      defaults: {
        template: '## Objective\n\nCreated without a dedicated title field.',
        type: createdTitleLessType,
      },
      title: '',
      type: 'createNote',
    },
    {
      content: seedNoteUpdatedContent(),
      noteId: 'Writing/Seed.md',
      type: 'updateNoteContent',
    },
    {
      folderPath: movedNoteFolderPath,
      noteId: 'Writing/Seed.md',
      type: 'moveNoteToFolder',
    },
    {
      key: 'related_to',
      sourceNoteId: relationshipSourcePath,
      targetTitle: 'Native Related Target',
      type: 'createRelationshipTarget',
    },
  ])
}

function workspacePersistencePropertyAndRelationshipWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return workspacePersistenceEditWrites(seedSnapshot, [
    { key: 'Priority', noteId: propertyRelationshipNotePath, type: 'updateProperty', value: 5 },
    { key: 'Published', noteId: propertyRelationshipNotePath, type: 'updateProperty', value: true },
    { key: 'Website', noteId: propertyRelationshipNotePath, type: 'updateProperty', value: propertyRelationshipUrl },
    { key: 'tags', noteId: propertyRelationshipNotePath, type: 'updateProperty', value: ['Mobile', 'QA'] },
    { key: 'Obsolete', noteId: propertyRelationshipNotePath, type: 'deleteProperty' },
    { key: 'related_to', noteId: propertyRelationshipNotePath, ref: '[[Writing/Seed]]', type: 'removeRelationship' },
    {
      key: 'belongs_to',
      noteId: propertyRelationshipNotePath,
      targetRef: '[[Metadata/Chrome State]]',
      targetTitle: 'Chrome State',
      type: 'addRelationship',
    },
  ])
}

function workspacePersistenceRestorationWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return workspacePersistenceEditWrites(seedSnapshot, [
    { note: restoredMobileNote(), noteIndex: 0, type: 'restoreNote' },
    { path: restoredFolderPath, type: 'restoreFolder' },
    { view: restoredMobileView(), viewIndex: 0, type: 'restoreView' },
    {
      definition: restoredTypeDefinition(),
      type: 'restoreTypeDefinition',
      typeName: restoredTypeName,
    },
  ])
}

type WorkspaceProbeEdit = Parameters<typeof applyMobileWorkspaceEditWithWrites>[1]

type WorkspaceProbeWrites = ReturnType<typeof applyMobileWorkspaceEditWithWrites>['writes']

function workspacePersistenceMetadataWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  const note = noteByPath(seedSnapshot, metadataNotePath)
  const removedIconNote = noteByPath(seedSnapshot, removedIconNotePath)
  if (!note || !removedIconNote) return []

  return workspacePersistenceEditWrites(seedSnapshot, [
    { noteId: note.id, type: 'changeNoteType', value: 'Procedure' },
    { key: '_icon', noteId: note.id, type: 'updateProperty', value: 'star' },
    { key: '_width', noteId: note.id, type: 'updateProperty', value: 'wide' },
    { archived: true, noteId: note.id, type: 'setArchived' },
    { noteId: note.id, organized: true, type: 'setOrganized' },
    { noteId: note.id, type: 'toggleFavorite' },
    { key: '_icon', noteId: removedIconNote.id, type: 'deleteProperty' },
  ])
}

function workspacePersistenceFavoriteWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  const note = noteByPath(seedSnapshot, favoriteBetaPath)
  if (!note) return []

  return workspacePersistenceEditWrites(seedSnapshot, [
    { direction: 'up', noteId: note.id, type: 'moveFavorite' },
  ])
}

function workspacePersistenceEditWrites(
  seedSnapshot: MobileWorkspaceSnapshot,
  edits: WorkspaceProbeEdit[],
) {
  const writes: WorkspaceProbeWrites = []
  let snapshot = seedSnapshot

  for (const edit of edits) {
    const result = applyMobileWorkspaceEditWithWrites(snapshot, edit)
    snapshot = result.snapshot
    writes.push(...result.writes)
  }

  return writes
}

function workspacePersistenceViewWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return [
    ...workspacePersistenceViewCreateWrites(seedSnapshot),
    ...workspacePersistenceViewMoveWrites(seedSnapshot),
    ...workspacePersistenceViewUpdateWrites(seedSnapshot),
    ...workspacePersistenceViewDeleteWrites(seedSnapshot),
  ]
}

function workspacePersistenceViewCreateWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return applyMobileWorkspaceEditWithWrites(seedSnapshot, {
    definition: mobilePersistenceViewDefinition(),
    type: 'createView',
  }).writes
}

function workspacePersistenceViewMoveWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  const view = seedSnapshot.views?.find((candidate) => candidate.definition.name === reorderedViewBetaName)
  if (!view) return []

  return applyMobileWorkspaceEditWithWrites(seedSnapshot, {
    direction: 'up',
    type: 'moveView',
    viewId: view.id,
  }).writes
}

function workspacePersistenceViewUpdateWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  const view = seedSnapshot.views?.find((candidate) => candidate.definition.name === updatedViewSourceName)
  if (!view) return []

  return applyMobileWorkspaceEditWithWrites(seedSnapshot, {
    definition: updatedNativeProofViewDefinition(),
    type: 'updateView',
    viewId: view.id,
  }).writes
}

function workspacePersistenceViewDeleteWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  const view = seedSnapshot.views?.find((candidate) => candidate.definition.name === oldViewName)
  if (!view) return []

  return applyMobileWorkspaceEditWithWrites(seedSnapshot, {
    type: 'deleteView',
    viewId: view.id,
  }).writes
}

function workspacePersistenceConfigWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return workspacePersistenceEditWrites(workspacePersistenceConfigSnapshot(seedSnapshot), [
    { mode: 'wide', type: 'setDefaultNoteWidth' },
    { key: 'Priority', mode: workspacePersistencePropertyDisplayModes.Priority, type: 'updatePropertyDisplayMode' },
    { key: 'Website', mode: workspacePersistencePropertyDisplayModes.Website, type: 'updatePropertyDisplayMode' },
    {
      allNotesFileVisibility: { images: true, pdfs: true, unsupported: false },
      listPropertiesDisplay: ['status', 'belongs_to'],
      target: 'allNotes',
      type: 'updatePrimaryNoteListProperties',
    },
    {
      listPropertiesDisplay: ['tags'],
      target: 'inbox',
      type: 'updatePrimaryNoteListProperties',
    },
  ])
}

function workspacePersistenceConfigSnapshot(
  seedSnapshot: MobileWorkspaceSnapshot,
): MobileWorkspaceSnapshot {
  return {
    ...seedSnapshot,
    vaultConfig: {
      ...seedSnapshot.vaultConfig,
      inbox: {
        ...seedSnapshot.vaultConfig?.inbox,
        explicitOrganization: true,
      },
    },
  }
}

function workspacePersistenceTextFileWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return workspacePersistenceEditWrites(seedSnapshot, [
    {
      noteId: textFilePath,
      rawContent: textFileInitialContent(),
      type: 'hydrateTextFileContent',
    },
    {
      content: textFileUpdatedContent,
      noteId: textFilePath,
      type: 'updateTextFileContent',
    },
  ])
}

function workspacePersistenceFolderWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return workspacePersistenceEditWrites(seedSnapshot, [
    { name: 'Created Drafts', parentPath: 'Folders', type: 'createFolder' },
    { folderPath: 'Folders/Queue', name: 'Proof Queue', type: 'renameFolder' },
    { name: 'Scratch', type: 'createFolder' },
    { name: 'To Delete', parentPath: 'Scratch', type: 'createFolder' },
    { folderPath: 'Scratch', type: 'deleteFolder' },
  ])
}

function workspacePersistenceTypeWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return workspacePersistenceEditWrites(seedSnapshot, [
    { type: 'createTypeDefinition', typeName },
    { type: 'deleteTypeDefinition', typeName: oldTypeName },
  ])
}

function workspacePersistenceTypeUpdateWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return applyMobileWorkspaceEditWithWrites(seedSnapshot, {
    patch: updatedTypeDefinitionPatch(),
    type: 'updateTypeDefinition',
    typeName: updatedTypeName,
  }).writes
}

function workspacePersistenceTypeMoveWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return applyMobileWorkspaceEditWithWrites(seedSnapshot, {
    direction: 'up',
    type: 'moveTypeSection',
    typeName: reorderedTypeBetaName,
  }).writes
}

function workspacePersistenceTypeRenameWrites(seedSnapshot: MobileWorkspaceSnapshot) {
  return applyMobileWorkspaceEditWithWrites(seedSnapshot, {
    nextTypeName: renamedTypeName,
    type: 'renameTypeDefinition',
    typeName: renamedTypeSourceName,
  }).writes
}
