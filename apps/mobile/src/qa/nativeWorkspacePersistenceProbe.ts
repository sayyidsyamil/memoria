type NativeWorkspacePersistenceLogText = string
type NativeWorkspacePersistenceLine = string

export type NativeWorkspacePersistenceProof = {
  bulkEditHydrated: boolean
  changedNoteTypeHydrated: boolean
  createdNoteHydrated: boolean
  createdTitleLessNoteHydrated: boolean
  deletedNoteRemoved: boolean
  deletedTypeDefinitionRemoved: boolean
  deletedViewRemoved: boolean
  defaultNoteWidthHydrated: boolean
  folderCreateApplied: boolean
  favoriteOrderHydrated: boolean
  fileVisibilityHydrated: boolean
  folderDeleteApplied: boolean
  folderRenameApplied: boolean
  movedNoteContentPreserved: boolean
  noteChromeMetadataHydrated: boolean
  noteIconRemovalHydrated: boolean
  noteStateMetadataHydrated: boolean
  persistedToNativeRepository: boolean
  propertyDisplayModesHydrated: boolean
  propertyDeletionHydrated: boolean
  propertyValuesHydrated: boolean
  relationshipEditHydrated: boolean
  relationshipSourceRefHydrated: boolean
  relationshipMovedRefHydrated: boolean
  relationshipTargetHydrated: boolean
  reorderedTypeSectionHydrated: boolean
  reorderedViewHydrated: boolean
  restoredFolderHydrated: boolean
  restoredNoteHydrated: boolean
  restoredTypeDefinitionHydrated: boolean
  restoredViewHydrated: boolean
  renamedTypeAssignedNoteHydrated: boolean
  renamedTypeDefinitionHydrated: boolean
  renamedTypeSchemaRefsHydrated: boolean
  savedViewHydrated: boolean
  textFileContentHydrated: boolean
  titlePropertyRenameHydrated: boolean
  typeDefinitionHydrated: boolean
  renamedNoteFileHydrated: boolean
  updatedViewHydrated: boolean
  updatedTypeDefinitionHydrated: boolean
  vaultConfigHydrated: boolean
}

export type NativeWorkspacePersistenceAssertionFailure = {
  id: string
  message: string
}

export const nativeWorkspacePersistenceLogPrefix = 'MEMORIA_MOBILE_WORKSPACE_PERSISTENCE_PROBE'
export const nativeWorkspacePersistenceProbeVaultLabel = 'Memoria Workspace QA Vault'

export function nativeWorkspacePersistenceProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('workspacePersistenceProbe') === '1'
}

export function nativeWorkspacePersistenceLogLine(
  proof: NativeWorkspacePersistenceProof,
): NativeWorkspacePersistenceLine {
  return `${nativeWorkspacePersistenceLogPrefix} ${JSON.stringify(workspacePersistenceProofValues(proof))}`
}

export function parseNativeWorkspacePersistenceProofs(
  logText: NativeWorkspacePersistenceLogText,
): NativeWorkspacePersistenceProof[] {
  return logText
    .split('\n')
    .map(parseWorkspacePersistenceProofLine)
    .filter((proof): proof is NativeWorkspacePersistenceProof => proof !== null)
}

const workspacePersistenceChecks: ReadonlyArray<(proof: NativeWorkspacePersistenceProof) => NativeWorkspacePersistenceAssertionFailure | null> = [
  (proof) => proofFailure(proof.persistedToNativeRepository, 'workspace.persistence.native', 'Workspace writes ran through the native Expo filesystem repository'),
  (proof) => proofFailure(proof.createdNoteHydrated, 'workspace.persistence.createNote', 'Created notes rehydrate from the native vault snapshot'),
  (proof) => proofFailure(proof.createdTitleLessNoteHydrated, 'workspace.persistence.createNote.titleLess', 'Title-less typed notes rehydrate from native filesystem writes without title frontmatter'),
  (proof) => proofFailure(proof.movedNoteContentPreserved, 'workspace.persistence.moveNote', 'Saved and moved note content is read back from the native repository'),
  (proof) => proofFailure(proof.renamedNoteFileHydrated, 'workspace.persistence.renameNoteFile', 'Explicit note filename renames and inbound wikilink rewrites rehydrate from native filesystem writes'),
  (proof) => proofFailure(proof.deletedNoteRemoved, 'workspace.persistence.deleteNote', 'Deleted notes are absent from native filesystem snapshots after reducer-generated delete writes'),
  (proof) => proofFailure(proof.titlePropertyRenameHydrated, 'workspace.persistence.titleRename', 'Title frontmatter edits rename files and rehydrate rewritten inbound wikilinks from native filesystem writes'),
  (proof) => proofFailure(proof.bulkEditHydrated, 'workspace.persistence.bulkEdit', 'Bulk note action writes rehydrate from one native filesystem write batch'),
  (proof) => proofFailure(proof.textFileContentHydrated, 'workspace.persistence.updateTextFileContent', 'Plain text file edits rehydrate from native filesystem writes'),
  (proof) => proofFailure(proof.changedNoteTypeHydrated, 'workspace.persistence.changeNoteType', 'Changed note type rehydrates from native frontmatter writes'),
  (proof) => proofFailure(proof.noteChromeMetadataHydrated, 'workspace.persistence.noteChromeMetadata', 'Note icon and width metadata rehydrate from native frontmatter writes'),
  (proof) => proofFailure(proof.noteIconRemovalHydrated, 'workspace.persistence.noteIconRemoval', 'Removed note icons rehydrate from native frontmatter deletion writes'),
  (proof) => proofFailure(proof.noteStateMetadataHydrated, 'workspace.persistence.noteStateMetadata', 'Note archive, organized, and favorite metadata rehydrate from native frontmatter writes'),
  (proof) => proofFailure(proof.favoriteOrderHydrated, 'workspace.persistence.moveFavorite', 'Favorite order rehydrates from native favorite index writes'),
  (proof) => proofFailure(proof.propertyDisplayModesHydrated, 'workspace.persistence.propertyDisplayModes', 'Property display modes rehydrate from native vault-scoped config storage'),
  (proof) => proofFailure(proof.propertyDeletionHydrated, 'workspace.persistence.propertyDeletion', 'Deleted scalar properties are removed from native frontmatter writes'),
  (proof) => proofFailure(proof.propertyValuesHydrated, 'workspace.persistence.propertyValues', 'Typed property values rehydrate from native frontmatter writes'),
  (proof) => proofFailure(proof.relationshipEditHydrated, 'workspace.persistence.relationshipEdit', 'Relationship add/remove edits rehydrate from native frontmatter writes'),
  (proof) => proofFailure(proof.relationshipTargetHydrated, 'workspace.persistence.relationshipTarget', 'Relationship target creation rehydrates the reducer-created target note'),
  (proof) => proofFailure(proof.relationshipSourceRefHydrated, 'workspace.persistence.relationshipSourceRef', 'Relationship target creation rehydrates the saved source note relationship ref'),
  (proof) => proofFailure(proof.relationshipMovedRefHydrated, 'workspace.persistence.relationshipMovedRef', 'Moved note relationship refs rehydrate from reducer-generated native rewrite writes'),
  (proof) => proofFailure(proof.savedViewHydrated, 'workspace.persistence.createView', 'Created desktop-compatible views rehydrate from reducer-generated native view writes'),
  (proof) => proofFailure(proof.updatedViewHydrated, 'workspace.persistence.updateView', 'Updated desktop-compatible views rehydrate from reducer-generated native view writes'),
  (proof) => proofFailure(proof.reorderedViewHydrated, 'workspace.persistence.moveView', 'Moved saved-view order rehydrates from reducer-generated native view order writes'),
  (proof) => proofFailure(proof.deletedViewRemoved, 'workspace.persistence.deleteView', 'Deleted native view files disappear from the mobile snapshot'),
  (proof) => proofFailure(proof.restoredViewHydrated, 'workspace.persistence.restoreView', 'Restored saved views rehydrate from undo/redo native view writes'),
  (proof) => proofFailure(proof.folderCreateApplied, 'workspace.persistence.createFolder', 'Created native folders rehydrate with the destination path'),
  (proof) => proofFailure(proof.folderRenameApplied, 'workspace.persistence.renameFolder', 'Renamed native folders rehydrate with the destination path'),
  (proof) => proofFailure(proof.folderDeleteApplied, 'workspace.persistence.deleteFolder', 'Deleted native folders are absent from the mobile snapshot'),
  (proof) => proofFailure(proof.restoredFolderHydrated, 'workspace.persistence.restoreFolder', 'Restored folders rehydrate from undo/redo native folder writes'),
  (proof) => proofFailure(proof.typeDefinitionHydrated, 'workspace.persistence.createType', 'Created Type documents hydrate mobile Type definitions'),
  (proof) => proofFailure(proof.deletedTypeDefinitionRemoved, 'workspace.persistence.deleteType', 'Deleted Type documents are removed from mobile Type definitions'),
  (proof) => proofFailure(proof.renamedTypeDefinitionHydrated, 'workspace.persistence.renameType', 'Renamed Type documents rehydrate from reducer-generated native writes'),
  (proof) => proofFailure(proof.renamedTypeAssignedNoteHydrated, 'workspace.persistence.renameType.assignedNote', 'Assigned notes rehydrate with renamed Type frontmatter and retargeted links'),
  (proof) => proofFailure(proof.renamedTypeSchemaRefsHydrated, 'workspace.persistence.renameType.schemaRefs', 'Type schema relationship refs rehydrate with renamed Type wikilinks'),
  (proof) => proofFailure(proof.updatedTypeDefinitionHydrated, 'workspace.persistence.updateType', 'Updated Type section metadata, schema, and templates rehydrate from reducer-generated native writes'),
  (proof) => proofFailure(proof.reorderedTypeSectionHydrated, 'workspace.persistence.moveTypeSection', 'Moved Type section order rehydrates from reducer-generated native Type order writes'),
  (proof) => proofFailure(proof.restoredTypeDefinitionHydrated, 'workspace.persistence.restoreType', 'Restored Type documents rehydrate from undo/redo native Type writes'),
  (proof) => proofFailure(proof.restoredNoteHydrated, 'workspace.persistence.restoreNote', 'Restored notes rehydrate from undo/redo native note writes'),
  (proof) => proofFailure(proof.vaultConfigHydrated, 'workspace.persistence.vaultConfig', 'Primary note-list config rehydrates from native vault-scoped config storage'),
  (proof) => proofFailure(proof.defaultNoteWidthHydrated, 'workspace.persistence.defaultNoteWidth', 'Default note width rehydrates from native vault-scoped config storage'),
  (proof) => proofFailure(proof.fileVisibilityHydrated, 'workspace.persistence.fileVisibility', 'All Notes file visibility rehydrates from native vault-scoped config storage'),
]

export function assertNativeWorkspacePersistenceProofs(
  proofs: NativeWorkspacePersistenceProof[],
): NativeWorkspacePersistenceAssertionFailure[] {
  const latest = proofs.at(-1)
  if (!latest) {
    return [{ id: 'workspace.persistence', message: 'Native workspace persistence proof was not logged' }]
  }

  return workspacePersistenceChecks
    .map((check) => check(latest))
    .filter((failure): failure is NativeWorkspacePersistenceAssertionFailure => failure !== null)
}

export function formatNativeWorkspacePersistenceFailures(
  failures: NativeWorkspacePersistenceAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

function parseWorkspacePersistenceProofLine(
  line: NativeWorkspacePersistenceLine,
): NativeWorkspacePersistenceProof | null {
  const prefixIndex = line.indexOf(nativeWorkspacePersistenceLogPrefix)
  if (prefixIndex === -1) return null

  const rawJson = line.slice(prefixIndex + nativeWorkspacePersistenceLogPrefix.length).trim()
  try {
    const parsed: unknown = JSON.parse(rawJson)
    return parsedWorkspacePersistenceProof(parsed)
  } catch {
    return null
  }
}

function parsedWorkspacePersistenceProof(value: unknown): NativeWorkspacePersistenceProof | null {
  if (isWorkspacePersistenceProofValueArray(value)) {
    return workspacePersistenceProofFromValues(value)
  }

  if (!isWorkspacePersistenceProofShape(value)) return null

  return workspacePersistenceProofFromValues(workspacePersistenceProofKeys.map((key) => value[key]))
}

function isWorkspacePersistenceProofShape(value: unknown): value is NativeWorkspacePersistenceProof {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<keyof NativeWorkspacePersistenceProof, unknown>
  return workspacePersistenceProofKeys.every((key) => typeof candidate[key] === 'boolean')
}

function isWorkspacePersistenceProofValueArray(value: unknown): value is boolean[] {
  return Array.isArray(value)
    && value.length === workspacePersistenceProofKeys.length
    && value.every((entry) => typeof entry === 'boolean')
}

function workspacePersistenceProofValues(proof: NativeWorkspacePersistenceProof): boolean[] {
  return workspacePersistenceProofKeys.map((key) => proof[key])
}

function workspacePersistenceProofFromValues(values: boolean[]): NativeWorkspacePersistenceProof {
  return Object.fromEntries(
    workspacePersistenceProofKeys.map((key, index) => [key, values[index]]),
  ) as NativeWorkspacePersistenceProof
}

const workspacePersistenceProofKeys = [
  'bulkEditHydrated',
  'changedNoteTypeHydrated',
  'createdNoteHydrated',
  'createdTitleLessNoteHydrated',
  'deletedNoteRemoved',
  'deletedTypeDefinitionRemoved',
  'deletedViewRemoved',
  'defaultNoteWidthHydrated',
  'folderCreateApplied',
  'favoriteOrderHydrated',
  'fileVisibilityHydrated',
  'folderDeleteApplied',
  'folderRenameApplied',
  'movedNoteContentPreserved',
  'noteChromeMetadataHydrated',
  'noteIconRemovalHydrated',
  'noteStateMetadataHydrated',
  'persistedToNativeRepository',
  'propertyDisplayModesHydrated',
  'propertyDeletionHydrated',
  'propertyValuesHydrated',
  'relationshipEditHydrated',
  'relationshipSourceRefHydrated',
  'relationshipMovedRefHydrated',
  'relationshipTargetHydrated',
  'reorderedTypeSectionHydrated',
  'reorderedViewHydrated',
  'restoredFolderHydrated',
  'restoredNoteHydrated',
  'restoredTypeDefinitionHydrated',
  'restoredViewHydrated',
  'renamedTypeAssignedNoteHydrated',
  'renamedTypeDefinitionHydrated',
  'renamedTypeSchemaRefsHydrated',
  'savedViewHydrated',
  'textFileContentHydrated',
  'titlePropertyRenameHydrated',
  'typeDefinitionHydrated',
  'renamedNoteFileHydrated',
  'updatedViewHydrated',
  'updatedTypeDefinitionHydrated',
  'vaultConfigHydrated',
] satisfies Array<keyof NativeWorkspacePersistenceProof>

function proofFailure(
  passed: boolean,
  id: string,
  message: string,
): NativeWorkspacePersistenceAssertionFailure | null {
  return passed ? null : { id, message }
}
