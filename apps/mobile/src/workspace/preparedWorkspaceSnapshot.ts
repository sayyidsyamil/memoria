import type { WorkspaceFileIndex } from './fileSystemWorkspaceRepository'
import type { LocalVaultSnapshotOptions } from './localVaultSnapshot'
import type { MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import { serializeMobileVaultConfig } from './mobileVaultConfig'

const prepared = new WeakMap<WorkspaceFileIndex, { identity: string; snapshot: MobileWorkspaceSnapshot }>()

function snapshotIdentity(options: LocalVaultSnapshotOptions) {
  return JSON.stringify([options.vaultPath, options.vaultLabel, options.vaultAlias ?? null, options.maxNotes ?? null,
    serializeMobileVaultConfig(options.vaultConfig ?? {})])
}

function matchesPreparedSnapshot(index: WorkspaceFileIndex, options: LocalVaultSnapshotOptions, identity: string) {
  return options.files === index.files && options.folderPaths === index.directories && identity === snapshotIdentity(options)
}

export function hasPreparedWorkspaceSnapshot(index: WorkspaceFileIndex | undefined) {
  return index !== undefined && prepared.has(index)
}

/** A single-use handoff for an already authoritative launch index, never a disk cache. */
export function rememberPreparedWorkspaceSnapshot(index: WorkspaceFileIndex, options: LocalVaultSnapshotOptions, snapshot: MobileWorkspaceSnapshot) {
  prepared.set(index, { identity: snapshotIdentity(options), snapshot })
}

export function takePreparedWorkspaceSnapshot(index: WorkspaceFileIndex | undefined, options: LocalVaultSnapshotOptions) {
  if (!index) return null
  const value = prepared.get(index)
  prepared.delete(index)
  if (!value) return null
  return matchesPreparedSnapshot(index, options, value.identity) ? value.snapshot : null
}
