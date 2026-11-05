import type {
  Directory,
  Paths,
} from 'expo-file-system'
import type {
  ReadOnlyWorkspaceRepository,
  ReadOnlyWorkspaceRequest,
} from '../workspace/readOnlyWorkspaceRepository'
import {
  nativeWorkspacePersistenceLogLine,
  nativeWorkspacePersistenceProbeVaultLabel,
} from './nativeWorkspacePersistenceProbe'
import {
  seedWorkspacePersistenceProbeWrites,
} from './nativeWorkspacePersistenceSeeds'
import {
  workspacePersistenceProbeWrites,
} from './nativeWorkspacePersistenceEdits'
import {
  favoriteAlphaPath,
  favoriteBetaPath,
  metadataNotePath,
  movedNotePath,
  propertyRelationshipNotePath,
  relationshipSourcePath,
  removedIconNotePath,
  renamedTypeAssignedNotePath,
  restoredNotePath,
  textFilePath,
} from './nativeWorkspacePersistenceScenario'
import {
  createdTitleLessTypedNote,
  workspacePersistenceProof,
} from './nativeWorkspacePersistenceReadback'
import {
  readNativeWorkspaceNotePathContent,
} from './nativeWorkspaceNotePathPersistenceProbe'
import type {
  MobileWorkspaceSnapshot,
} from '../workspace/mobileWorkspaceModel'
import {
  noteByPath,
} from './nativeWorkspacePersistenceProofHelpers'

type ExpoFileSystemModule = {
  Directory: typeof Directory
  Paths: typeof Paths
}

declare const require: (moduleName: string) => ExpoFileSystemModule

const workspaceProbeStartedRootUris = new Set<string>()

export function nativeWorkspacePersistenceProbeRepository(
  baseRepository: ReadOnlyWorkspaceRepository,
): ReadOnlyWorkspaceRepository {
  return {
    persistWrites: (writes, request) => baseRepository.persistWrites(
      writes,
      nativeWorkspacePersistenceProbeRequest(request),
    ),
    readNoteContent: (note, request) => baseRepository.readNoteContent(
      note,
      nativeWorkspacePersistenceProbeRequest(request),
    ),
    readSnapshot: (request) => {
      const probeRequest = nativeWorkspacePersistenceProbeRequest(request)
      queueWorkspacePersistenceProbe(baseRepository, probeRequest)
      return baseRepository.readSnapshot(probeRequest)
    },
  }
}

export function nativeWorkspacePersistenceProbeRequest(
  request?: ReadOnlyWorkspaceRequest,
): ReadOnlyWorkspaceRequest {
  return {
    ...request,
    source: 'native',
    vaultAlias: null,
    vaultLabel: nativeWorkspacePersistenceProbeVaultLabel,
    vaultRootUri: workspacePersistenceProbeRootUri(),
    workspaceIndex: undefined,
  }
}

function queueWorkspacePersistenceProbe(
  baseRepository: ReadOnlyWorkspaceRepository,
  request: ReadOnlyWorkspaceRequest,
) {
  const rootUri = request.vaultRootUri
  if (!rootUri || workspaceProbeStartedRootUris.has(rootUri)) return

  workspaceProbeStartedRootUris.add(rootUri)
  void logWorkspacePersistenceProof(baseRepository, request)
}

async function logWorkspacePersistenceProof(
  baseRepository: ReadOnlyWorkspaceRepository,
  request: ReadOnlyWorkspaceRequest,
) {
  resetWorkspacePersistenceProbeVault(request.vaultRootUri)
  await baseRepository.persistWrites(seedWorkspacePersistenceProbeWrites(), request)
  await baseRepository.persistWrites(workspacePersistenceProbeWrites(baseRepository.readSnapshot(request)), request)

  const snapshot = baseRepository.readSnapshot(request)
  const movedNote = snapshot.allNotes?.find((note) => note.path === movedNotePath)
    ?? snapshot.notes.find((note) => note.path === movedNotePath)
  const createdTitleLessNote = createdTitleLessTypedNote(snapshot)
  const movedContent = movedNote ? await baseRepository.readNoteContent(movedNote, request) : null
  const createdTitleLessContent = createdTitleLessNote
    ? await baseRepository.readNoteContent(createdTitleLessNote, request)
    : null
  const favoriteAlphaContent = await readProbeNoteContent(baseRepository, snapshot, favoriteAlphaPath, request)
  const favoriteBetaContent = await readProbeNoteContent(baseRepository, snapshot, favoriteBetaPath, request)
  const propertyRelationshipContent = await readProbeNoteContent(baseRepository, snapshot, propertyRelationshipNotePath, request)
  const renamedAssignedContent = await readProbeNoteContent(baseRepository, snapshot, renamedTypeAssignedNotePath, request)
  const removedIconContent = await readProbeNoteContent(baseRepository, snapshot, removedIconNotePath, request)
  const restoredNoteContent = await readProbeNoteContent(baseRepository, snapshot, restoredNotePath, request)
  const relationshipSourceContent = await readProbeNoteContent(baseRepository, snapshot, relationshipSourcePath, request)
  const metadataContent = await readProbeNoteContent(baseRepository, snapshot, metadataNotePath, request)
  const textFileContent = await readProbeNoteContent(baseRepository, snapshot, textFilePath, request)
  const notePathContent = await readNativeWorkspaceNotePathContent(baseRepository, snapshot, request)

  console.info(nativeWorkspacePersistenceLogLine(workspacePersistenceProof(snapshot, {
    favoriteAlphaContent,
    favoriteBetaContent,
    createdTitleLessContent,
    metadataContent,
    movedContent,
    notePathContent,
    propertyRelationshipContent,
    relationshipSourceContent,
    renamedAssignedContent,
    removedIconContent,
    restoredNoteContent,
    textFileContent,
  })))
}

function readProbeNoteContent(
  repository: ReadOnlyWorkspaceRepository,
  snapshot: MobileWorkspaceSnapshot,
  path: string,
  request: ReadOnlyWorkspaceRequest,
) {
  const note = noteByPath(snapshot, path)
  return note ? repository.readNoteContent(note, request) : null
}

function resetWorkspacePersistenceProbeVault(rootUri: string | null | undefined) {
  if (!rootUri) return

  const { Directory } = require('expo-file-system')
  const root = new Directory(rootUri)
  if (root.exists) root.delete()
  root.create({ idempotent: true, intermediates: true })
}

function workspacePersistenceProbeRootUri(): string | null {
  try {
    const { Directory, Paths } = require('expo-file-system')
    return new Directory(Paths.document, nativeWorkspacePersistenceProbeVaultLabel).uri
  } catch {
    return null
  }
}
