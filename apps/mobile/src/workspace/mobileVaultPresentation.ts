import type { useMobileVaults } from './git/useMobileVaults'

type Manager = ReturnType<typeof useMobileVaults>

export function initialWorkspacePending(manager: Pick<Manager, 'restorePending' | 'active'>) {
  return manager.restorePending && !manager.active.selection
}

export function vaultControls(manager: Manager, pendingNotePaths: Set<string>) {
  const preview = manager.catalog.preview?.source
  return {
    rootUri: manager.active.selection?.vaultRootUri ?? preview?.vaultPath,
    git: Boolean(manager.active.git) || manager.catalog.vaults.some(vault => vault.id === preview?.alias),
    linked: manager.linked, busy: manager.busy || manager.restorePending,
    status: displayedVaultStatus(manager),
    lastSuccessAt: manager.syncHistory.record.lastSuccessAt, lastFailureAt: manager.syncHistory.record.lastFailureAt,
    phase: manager.phase, pendingNotePaths,
    historyAvailable: manager.syncHistory.ready && !manager.syncHistory.failed,
    open: manager.open, sync: manager.sync,
  }
}

function displayedVaultStatus(manager: Manager) {
  return manager.catalog.error || manager.refreshFailed ? 'failed' as const : manager.status
}

export function workspaceRecovery(manager: Manager) {
  if (manager.active.selection || manager.catalog.preview) return
  if (manager.refreshFailed) return { reason: 'selection' as const, retry: manager.retryWorkspace }
  if (!manager.catalog.pending) return { reason: manager.catalog.error, retry: manager.catalog.retry }
}
