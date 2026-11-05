import type { MobileWorkspaceWrite } from './mobileWorkspaceEditing.types'
import { normalizedWorkspaceRelativePath } from './workspaceWriteValidation'

export type PendingPathChange = { path: string; revision: number }
export type PendingSyncFields = { pendingRevision?: number; pendingPaths?: PendingPathChange[] }

export function markPendingPaths(record: PendingSyncFields, paths: readonly string[]) {
  const pendingRevision = (record.pendingRevision ?? 0) + 1
  const changes = new Map((record.pendingPaths ?? []).map(change => [change.path, change.revision]))
  for (const path of paths) {
    const normalized = normalizedWorkspaceRelativePath(path)
    if (normalized) changes.set(normalized, pendingRevision)
  }
  return { pendingRevision, pendingPaths: [...changes].map(([path, revision]) => ({ path, revision })) }
}

export function acknowledgePendingPaths(record: PendingSyncFields, checkpoint: number) {
  return { pendingRevision: record.pendingRevision ?? 0,
    pendingPaths: (record.pendingPaths ?? []).filter(change => change.revision > checkpoint) }
}

export function workspacePendingWritePaths(writes: MobileWorkspaceWrite[]) {
  return [...new Set(writes.flatMap(write => {
    if (write.kind === 'saveVaultConfig') return []
    return write.kind === 'moveNote' || write.kind === 'renameFolder' ? [write.path, write.toPath] : [write.path]
  }))]
}

export function pendingNotePath(paths: ReadonlySet<string>, notePath: string) {
  let path = normalizedWorkspaceRelativePath(notePath) ?? ''
  while (path) {
    if (paths.has(path)) return true
    const separator = path.lastIndexOf('/')
    path = separator < 0 ? '' : path.slice(0, separator)
  }
  return false
}

export function validPendingSyncFields(value: Record<string, unknown>) {
  if (value.pendingRevision === undefined && value.pendingPaths === undefined) return true
  const revision = value.pendingRevision
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return false
  return Array.isArray(value.pendingPaths) && value.pendingPaths.every(change => validPendingPath(change, revision))
}

function validPendingPath(value: unknown, maximum: number) {
  if (!value || typeof value !== 'object') return false
  const change = value as Record<string, unknown>
  return typeof change.path === 'string' && normalizedWorkspaceRelativePath(change.path) === change.path
    && typeof change.revision === 'number' && Number.isSafeInteger(change.revision)
    && change.revision > 0 && change.revision <= maximum
}
