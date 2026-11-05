import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createSyncLedger } from './syncLedger'
import { readSyncLedger, writeSyncLedger } from './syncLedgerStorage'
import type { SyncPhase, VaultSyncState, VaultSyncRecord } from './syncLedgerModel'
import type { SyncFailureKind } from './syncFailure'
import { acknowledgePendingPaths, markPendingPaths } from './mobilePendingChanges'

export function useVaultSyncLedger(id?: string) {
  const [ledger] = useState(() => createSyncLedger({ read: readSyncLedger, write: writeSyncLedger }))
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let mounted = true
    void ledger.load().catch(() => {}).finally(() => { if (mounted) setReady(true) })
    return () => { mounted = false }
  }, [ledger])
  const record = useSyncExternalStore(ledger.subscribe, () => ledger.get(id))
  const failed = useSyncExternalStore(ledger.subscribe, ledger.failed)
  const actions = useMemo(() => syncLedgerActions(ledger, id), [id, ledger])
  return { record, ready, failed, ...actions }
}

function syncLedgerActions(ledger: ReturnType<typeof createSyncLedger>, id?: string) {
  const update = (patch: Partial<VaultSyncRecord>) => { if (id) ledger.update(id, patch) }
  const current = () => ledger.get(id)
  return {
    markDirty: (paths: readonly string[]) => update({ ...markPendingPaths(current(), paths),
      status: current().status === 'diverged' ? 'diverged' : 'pending' }),
    pendingCheckpoint: () => current().pendingRevision ?? 0,
    acknowledgePending: (checkpoint: number) => update(acknowledgePendingPaths(current(), checkpoint)),
    complete: (kind: 'synced' | 'diverged', pending = false) => {
      update(kind === 'synced'
        ? { status: pending ? 'pending' : 'synced', lastSuccessAt: Date.now(), error: null }
        : { status: 'diverged', error: 'conflict' })
    },
    setStatus: (status: VaultSyncState) => {
      update({ status, ...(status === 'synced' ? { lastSuccessAt: Date.now(), error: null } : {}) })
    },
    setPhase: (phase: SyncPhase) => update({ phase }),
    setProblem: (error: SyncFailureKind | null) => update({ error, ...(error ? { lastFailureAt: Date.now() } : {}) }),
    setLastCommitId: (lastCommitId: string | null) => update({ lastCommitId }),
  }
}
