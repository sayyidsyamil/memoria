import type { SyncPhase, VaultSyncState } from '../syncLedgerModel'
import { requireActiveSync } from '../syncCancellation'
import { createGitEditorAccess } from './gitEditorAccess'
import type { GitAuthor } from './gitVault'
import { managedGitConnection } from './managedGitStorage'
import type { VaultTask } from './mobileVaultCatalogActions'
import { nativeGitHttp } from './nativeGitHttp'
import type { useGitHubAccount } from './useGitHubAccount'
import type { useGitSyncProgress } from './useGitSyncProgress'
import type { useVaultNotices } from '../useVaultNotices'
import type { useVaultSyncLedger } from '../useVaultSyncLedger'
import type { createWorkspaceSyncEditors } from '../workspaceSyncEditors'
import type { ActiveVault } from './useManagedVaultCatalog'

type MobileVaultSyncTaskOptions = {
  active: ActiveVault
  account: ReturnType<typeof useGitHubAccount>
  author: () => GitAuthor
  dirtyVersion: { current: number }
  deferWhileFocused: (signal?: AbortSignal) => boolean
  editors: ReturnType<typeof createWorkspaceSyncEditors>
  linked: boolean
  notices: Pick<ReturnType<typeof useVaultNotices>, 'show' | 'recovered'>
  setLastCommitId: (commitId: string) => void
  setPhase: (phase: SyncPhase | null) => void
  setStatus: (status: VaultSyncState) => void
  syncFolder: (root: string) => Promise<ActiveVault | null | 'cancelled' | 'unchanged'>
  syncHistory: ReturnType<typeof useVaultSyncLedger>
  syncProgress: ReturnType<typeof useGitSyncProgress>
  workspaceRefresh: {
    refresh: (next: ActiveVault, previous: ActiveVault, selectedNoteId?: string) => Promise<void>
  }
}

export function createMobileVaultSyncTask(options: MobileVaultSyncTaskOptions): (checkpoint: boolean, signal?: AbortSignal) => Promise<Awaited<ReturnType<VaultTask>>> {
  return async (checkpoint, signal) => {
    requireActiveSync(signal)
    if (options.linked && options.active.selection) return options.syncFolder(options.active.selection.vaultRootUri)
    if (!options.active.git) {
      options.setStatus('local')
      return null
    }
    const connection = managedGitConnection(options.active.git)
    const { syncGitVault } = await import('./gitRemote')
    let checkpointVersion = options.dirtyVersion.current
    const localAccess = createGitEditorAccess({
      editors: options.editors,
      rootUri: options.active.selection?.vaultRootUri,
      deferWhileFocused: () => options.deferWhileFocused(signal),
      refresh: (selectedNoteId) => options.workspaceRefresh.refresh(options.active, options.active, selectedNoteId),
    })
    const result = await options.syncProgress.run((onProgress) =>
      syncGitVault(
        {
          ...connection,
          http: nativeGitHttp,
          checkpoint,
          signal,
          onProgress,
          onCheckpoint: (oid) => {
            options.setLastCommitId(oid.slice(0, 8))
            options.setStatus('committed')
          },
          withLocalAccess: async (run) => {
            const value = await localAccess(async () => {
              const pendingCheckpoint = options.syncHistory.pendingCheckpoint()
              const result = await run()
              options.syncHistory.acknowledgePending(pendingCheckpoint)
              return result
            })
            checkpointVersion = options.dirtyVersion.current
            return value
          },
          getToken: async () => (await options.account.currentSession())?.accessToken,
          onPhase: (phase) => {
            options.setPhase(phase)
            options.syncProgress.clear()
          },
        },
        options.author()
      )
    )
    options.syncHistory.complete(result.kind, checkpointVersion !== options.dirtyVersion.current)
    if (result.kind === 'diverged') options.notices.show('conflict')
    else options.notices.recovered()
    return result.workspaceChanged ? null : 'unchanged'
  }
}
