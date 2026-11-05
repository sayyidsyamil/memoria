import {
  favoriteAlphaPath,
  favoriteBetaPath,
  favoriteNoteContent,
  metadataNoteInitialContent,
  metadataNotePath,
  movedNoteFolderPath,
  oldNativeProofViewContent,
  oldTypeName,
  orderedNativeProofViewContent,
  propertyRelationshipNoteContent,
  propertyRelationshipNotePath,
  relationshipSourceContent,
  relationshipSourcePath,
  removedIconNotePath,
  renamedTypeAssignedNoteContent,
  renamedTypeAssignedNotePath,
  renamedTypeSchemaCarrierContent,
  renamedTypeSourceName,
  renamedTypeSourcePath,
  reorderedTypeAlphaName,
  reorderedTypeBetaName,
  reorderedViewAlphaName,
  reorderedViewBetaName,
  seedNoteInitialContent,
  textFileInitialContent,
  textFilePath,
  typeDefinitionContent,
  updateNativeProofViewContent,
  updatedTypeName,
} from './nativeWorkspacePersistenceScenario'
import {
  nativeWorkspaceNotePathSeedWrites,
} from './nativeWorkspaceNotePathPersistenceProbe'

export function seedWorkspacePersistenceProbeWrites() {
  return [
    ...seedWorkspaceNoteWrites(),
    ...seedWorkspaceViewWrites(),
    ...seedWorkspaceTypeWrites(),
  ]
}

function seedWorkspaceNoteWrites() {
  return [
    noteSeed('Writing/Seed.md', seedNoteInitialContent()),
    {
      kind: 'createFolder' as const,
      path: movedNoteFolderPath,
    },
    noteSeed(metadataNotePath, metadataNoteInitialContent()),
    noteSeed(removedIconNotePath, removedIconInitialContent()),
    noteSeed(favoriteAlphaPath, favoriteNoteContent('Alpha', 10)),
    noteSeed(favoriteBetaPath, favoriteNoteContent('Beta', 20)),
    noteSeed('Folders/Queue/Keep.md', '# Keep\n'),
    noteSeed(relationshipSourcePath, relationshipSourceContent()),
    noteSeed(propertyRelationshipNotePath, propertyRelationshipNoteContent()),
    noteSeed(textFilePath, textFileInitialContent()),
    ...nativeWorkspaceNotePathSeedWrites,
    noteSeed(renamedTypeAssignedNotePath, renamedTypeAssignedNoteContent()),
  ]
}

function noteSeed(path: string, content: string) {
  return { content, kind: 'createNote' as const, path }
}

function removedIconInitialContent() {
  return [
    '---',
    'type: Essay',
    '_icon: star',
    '---',
    '# Icon Removal',
    '',
    'Remove note icon persistence proof seed.',
    '',
  ].join('\n')
}

function seedWorkspaceViewWrites() {
  return [
    {
      content: oldNativeProofViewContent(),
      kind: 'saveView' as const,
      path: 'views/old-native-proof.yml',
    },
    {
      content: updateNativeProofViewContent(),
      kind: 'saveView' as const,
      path: 'views/update-native-proof.yml',
    },
    {
      content: orderedNativeProofViewContent(reorderedViewAlphaName, 30),
      kind: 'saveView' as const,
      path: 'views/order-alpha.yml',
    },
    {
      content: orderedNativeProofViewContent(reorderedViewBetaName, 31),
      kind: 'saveView' as const,
      path: 'views/order-beta.yml',
    },
  ]
}

function seedWorkspaceTypeWrites() {
  return [
    noteSeed(`Types/${oldTypeName}.md`, typeDefinitionContent(oldTypeName, 'gray')),
    noteSeed(renamedTypeSourcePath, typeDefinitionContent(renamedTypeSourceName, 'purple')),
    noteSeed('section-proof.md', typeDefinitionContent(updatedTypeName, 'gray')),
    noteSeed('type-order-alpha.md', typeDefinitionContent(reorderedTypeAlphaName, 'green', 30)),
    noteSeed('type-order-beta.md', typeDefinitionContent(reorderedTypeBetaName, 'purple', 31)),
    noteSeed('schema-carrier.md', renamedTypeSchemaCarrierContent()),
  ]
}
