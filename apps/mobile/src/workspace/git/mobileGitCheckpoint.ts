import type { SyncPhase } from '../syncLedgerModel'
import { createGitVault, type GitAuthor } from './gitVault'
import { withSavedWorkspace } from './workspaceWriteQueue'
import type { managedGitConnection } from './managedGitStorage'
import type { VaultTask } from './mobileVaultCatalogActions'
import type { ActiveVault } from './useManagedVaultCatalog'

export async function checkpointAndAcknowledgeMobileGitVault(options: {
  acknowledgePending: (checkpoint: number) => void
  author: GitAuthor
  captureCommit: () => void
  connection: ReturnType<typeof managedGitConnection>
  message: string
  pendingCheckpoint: () => number
  setPhase: (phase: SyncPhase) => void
}) {
  options.setPhase('checkpoint')
  const pendingCheckpoint = options.pendingCheckpoint()
  const result = await withSavedWorkspace(
    options.connection.operationKey ?? options.connection.dir,
    () => createGitVault(options.connection).checkpoint(options.author, options.message),
  )
  options.acknowledgePending(pendingCheckpoint)
  if (result.changedFiles > 0) options.captureCommit()
  return result
}

export function createMobileGitCommitTask(options: {
  active: ActiveVault
  acknowledgePending: (checkpoint: number) => void
  author: GitAuthor
  captureCommit: () => void
  connection: ReturnType<typeof managedGitConnection> | null
  message: string
  pendingCheckpoint: () => number
  setLastCommitId: (commitId: string) => void
  setPhase: (phase: SyncPhase) => void
  setStatus: (status: 'committed') => void
}) {
  let committed = false
  const task: VaultTask = async () => {
    if (!options.active.git || !options.connection) return 'cancelled'
    const result = await checkpointAndAcknowledgeMobileGitVault({
      acknowledgePending: options.acknowledgePending,
      author: options.author,
      captureCommit: options.captureCommit,
      connection: options.connection,
      message: options.message,
      pendingCheckpoint: options.pendingCheckpoint,
      setPhase: options.setPhase,
    })
    options.setLastCommitId(result.oid.slice(0, 8))
    options.setStatus('committed')
    committed = true
    return result.workspaceChanged ? null : 'unchanged'
  }
  return { task, wasCommitted: () => committed }
}
