import { optionalNativeWorkspaceAccessModule } from './nativeWorkspaceAccess'
import type { SyncConflictChoices, SyncConflictFile } from './syncConflictModel'

export type LinkedConflictReview = { snapshot: string; files: SyncConflictFile[] }

export async function inspectLinkedConflicts(root: string): Promise<LinkedConflictReview> {
  const native = optionalNativeWorkspaceAccessModule()
  if (!native?.reviewLinkedConflicts) throw new Error('linkedFolderUnavailable')
  const snapshot = await native.reviewLinkedConflicts(root)
  const files = reviewFiles(JSON.parse(snapshot)).map((file: unknown) => {
    if (!validFile(file)) throw new Error('syncConflictInvalid')
    return file
  })
  return { snapshot, files }
}

function reviewFiles(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || !('files' in value) || !Array.isArray(value.files)) throw new Error('syncConflictInvalid')
  return value.files
}

export async function resolveLinkedConflicts(root: string, review: LinkedConflictReview, choices: SyncConflictChoices) {
  const native = optionalNativeWorkspaceAccessModule()
  if (!native?.resolveLinkedConflicts) throw new Error('linkedFolderUnavailable')
  if (!await native.resolveLinkedConflicts(root, review.snapshot, choices)) throw new Error('syncConflictStale')
}

function validFile(value: unknown): value is SyncConflictFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Record<string, unknown>
  return typeof file.path === 'string' && validVersion(file.local) && validVersion(file.remote)
}

function validVersion(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const version = value as Record<string, unknown>
  return ['text', 'binary', 'deleted'].includes(String(version.kind)) && typeof version.text === 'string' && typeof version.truncated === 'boolean'
}
