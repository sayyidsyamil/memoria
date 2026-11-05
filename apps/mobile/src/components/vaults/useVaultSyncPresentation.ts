import { useContext } from 'react'
import { mobileText } from '../../i18n/mobileText'
import { useMobileColors } from '../../ui/theme/useMobileTheme'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { MobileVaultControlsContext, MobileVaultDisplayContext } from '../../workspace/MobileVaultContext'
import type { MobileSyncStatus } from '../../workspace/mobileWorkspaceModel'
import type { VaultSyncState } from '../../workspace/git/useMobileVaults'

export function useVaultSyncPresentation(sync: MobileSyncStatus) {
  const colors = useMobileColors()
  const controls = useContext(MobileVaultControlsContext)
  const display = useContext(MobileVaultDisplayContext)
  if (!controls || display?.source !== 'native') return null
  const git = controls.git && display.rootUri === controls.rootUri
  const linked = Boolean(controls.linked && display.rootUri === controls.rootUri)
  const syncable = git || linked
  const state = vaultSyncStatus(git, controls.status, sync, linked)
  const label = controls.busy ? mobileText('status.sync.syncing') : state.label
  const color = statusColor(state.status, colors)
  return { label, color, retry: state.retry, canCommit: git, open: controls.open, sync: syncControl(syncable, state.retry, controls.sync), busy: controls.busy }
}

function syncControl(syncable: boolean, retry: boolean, sync: () => Promise<void>) {
  return syncable || retry ? sync : undefined
}

export function vaultSyncStatus(git: boolean, current: VaultSyncState, sync: MobileSyncStatus, linked = false) {
  const status = sync.kind === 'writeFailed' ? 'saveFailed' : current
  const label = linked && status === 'synced' ? mobileText('mobile.vaults.folderSaved') : statusLabel(git || linked, status)
  return { status, label, retry: status === 'saveFailed' }
}

function statusColor(status: VaultSyncState, mobileColors: MobileColors) {
  return ['failed', 'saveFailed', 'diverged'].includes(status) ? mobileColors.danger : mobileColors.textMuted
}

function statusLabel(git: boolean, status: VaultSyncState) {
  if (status === 'saveFailed') return mobileText('mobile.vaults.saveFailed')
  if (status === 'failed') return mobileText('status.sync.failed')
  if (!git) return mobileText('mobile.vaults.localOnly')
  const labels = {
    committed: 'mobile.git.localCommit',
    local: 'mobile.vaults.localOnly', pending: 'status.sync.notSynced', synced: 'status.sync.synced',
    diverged: 'status.sync.conflict',
  } as const
  return mobileText(labels[status])
}
