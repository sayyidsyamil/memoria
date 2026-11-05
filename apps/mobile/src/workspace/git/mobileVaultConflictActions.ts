import type { MobileAnalyticsEvent } from '../../analytics/mobileAnalytics'
import type { SyncConflictChoices } from '../syncConflictModel'
import type { VaultSyncState } from '../syncLedgerModel'
import type { useVaultNotices } from '../useVaultNotices'
import type { useVaultSyncLedger } from '../useVaultSyncLedger'
import { inspectVaultConflicts, resolveVaultConflicts, type VaultConflictReview } from '../vaultConflictOperations'
import type { VaultTask } from './mobileVaultCatalogActions'
import type { GitAuthor } from './gitVault'
import type { ActiveVault } from './useManagedVaultCatalog'

type MobileVaultConflictActionsOptions = {
  active: ActiveVault
  analytics: { capture: (event: MobileAnalyticsEvent) => void }
  author: () => GitAuthor
  autoGit: boolean
  busy: boolean
  conflictReview: VaultConflictReview | null
  notices: Pick<ReturnType<typeof useVaultNotices>, 'recovered'>
  perform: (task: VaultTask, present?: boolean, operation?: 'commit' | 'sync' | 'autoSync') => Promise<unknown>
  setConflictFailure: (failure: 'stale' | 'local' | null) => void
  setConflictReview: (review: VaultConflictReview | null) => void
  setLastCommitId: (commitId: string | null) => void
  setStatus: (status: VaultSyncState) => void
  syncTask: (checkpoint: boolean) => Promise<Awaited<ReturnType<VaultTask>>>
  syncHistory: ReturnType<typeof useVaultSyncLedger>
}

export function createMobileVaultConflictActions(options: MobileVaultConflictActionsOptions) {
  const recordResolution = (oid: string | null) => {
    if (oid) options.setLastCommitId(oid.slice(0, 8))
    options.setStatus(oid ? 'committed' : 'synced')
    options.notices.recovered()
    options.analytics.capture({
      name: options.active.git ? 'mobile_git_operation_requested' : 'mobile_folder_sync_requested',
      operation: 'resolveConflicts',
    })
    options.setConflictReview(null)
  }
  const reviewConflicts = () =>
    options.perform(async () => {
      options.setConflictFailure(null)
      options.setConflictReview(await inspectVaultConflicts(options.active, options.author(), options.autoGit))
      return 'unchanged'
    })
  const resolveConflicts = async (choices: SyncConflictChoices) => {
    const review = options.conflictReview
    if (!review) return
    let resolved = false
    await options.perform(async () => {
      try {
        const pendingCheckpoint = options.syncHistory.pendingCheckpoint()
        const oid = await resolveVaultConflicts(options.active, review, choices, options.author())
        options.syncHistory.acknowledgePending(pendingCheckpoint)
        recordResolution(oid)
        resolved = true
        return null
      } catch (failure) {
        options.setConflictFailure(conflictFailureKind(failure))
        throw failure
      }
    })
    if (resolved && options.active.git) await options.perform(() => options.syncTask(false), true, 'sync')
  }
  const cancelConflictReview = () => {
    if (options.busy) return
    options.setConflictReview(null)
    options.setConflictFailure(null)
    options.setStatus('diverged')
  }
  return { reviewConflicts, resolveConflicts, cancelConflictReview }
}

function conflictFailureKind(failure: unknown) {
  return failure instanceof Error && failure.message === 'syncConflictStale' ? 'stale' : 'local'
}
