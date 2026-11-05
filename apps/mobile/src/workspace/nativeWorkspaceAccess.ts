import type { WorkspaceFileIndex } from './fileSystemWorkspaceRepository'
import type { WorkspaceTextChange } from './workspaceTextBatch'

export type NativeWorkspaceAccessModule = {
  readWorkspaceIndex?: (uri: string) => Promise<string>
  beginWorkspaceSync?: (identifier: string) => Promise<boolean>
  endWorkspaceSync?: (identifier: string) => Promise<void>
  addListener?: (event: 'workspaceSyncExpired', listener: (event: { identifier: string }) => void) => { remove: () => void }
  isWorkspaceLinked?: (root: string) => boolean
  syncLinkedWorkspace?: (root: string) => Promise<{ linked: boolean; changed: boolean; conflict: boolean }>
  reviewLinkedConflicts?: (root: string) => Promise<string>
  resolveLinkedConflicts?: (root: string, review: string, choices: Record<string, string>) => Promise<boolean>
  gitEntryInfo?: (uri: string) => {
    exists: boolean; isDirectory?: boolean; size?: number; modificationTime?: number; creationTime?: number
  }
  createWorkspaceOperationId?: () => string
  changeWorkspaceEntry?: (root: string, path: string, toPath: string | null, directory: boolean, identifier: string) => Promise<void>
  saveWorkspaceText?: (root: string, path: string, content: string, identifier: string) => Promise<void>
  saveWorkspaceTexts?: (root: string, changes: WorkspaceTextChange[], identifier: string) => Promise<void>
  recoverWorkspaceText?: (root: string) => boolean
  importWorkspace: (uri: string) => Promise<NativeWorkspaceBridgeRecord | null>
  pickAndImportWorkspace?: () => Promise<NativeWorkspaceBridgeRecord | null>
  restoreWorkspace: () => Promise<NativeWorkspaceBridgeRecord | null>
}

export type NativeWorkspaceIndex = WorkspaceFileIndex
export type NativeWorkspaceRecord = { index?: NativeWorkspaceIndex; label: string; uri: string }
export type NativeWorkspaceBridgeRecord = NativeWorkspaceRecord & { indexJson?: string }

export function optionalNativeWorkspaceAccessModule(): NativeWorkspaceAccessModule | null {
  return null
}

export async function importNativeWorkspace(
  uri: string,
  module: NativeWorkspaceAccessModule | null = optionalNativeWorkspaceAccessModule(),
): Promise<NativeWorkspaceRecord | null> {
  if (!module) return null

  try {
    return normalizedWorkspaceRecord(await module.importWorkspace(uri))
  } catch {
    return null
  }
}

export async function pickAndImportNativeWorkspace(
  module: NativeWorkspaceAccessModule | null = optionalNativeWorkspaceAccessModule(),
): Promise<NativeWorkspaceRecord | null> {
  if (!module?.pickAndImportWorkspace) return null

  return normalizedWorkspaceRecord(await module.pickAndImportWorkspace())
}

export async function restoreNativeWorkspace(
  module: NativeWorkspaceAccessModule | null = optionalNativeWorkspaceAccessModule(),
): Promise<NativeWorkspaceRecord | null> {
  if (!module) return null

  return normalizedWorkspaceRecord(await module.restoreWorkspace())
}

function normalizedWorkspaceRecord(record: NativeWorkspaceBridgeRecord | null): NativeWorkspaceRecord | null {
  const uri = record?.uri.trim()
  const label = record?.label.trim()
  if (!uri || !label) return null
  const index = record?.index ?? parsedWorkspaceIndex(record?.indexJson)
  return index ? { index, label, uri } : { label, uri }
}

function parsedWorkspaceIndex(value: string | undefined): NativeWorkspaceIndex | undefined {
  if (!value) return undefined
  try {
    const candidate = JSON.parse(value) as Partial<NativeWorkspaceIndex>
    return Array.isArray(candidate.directories) && Array.isArray(candidate.files)
      ? { directories: candidate.directories, files: candidate.files }
      : undefined
  } catch {
    return undefined
  }
}
