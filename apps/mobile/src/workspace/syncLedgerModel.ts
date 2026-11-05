import type { SyncFailureKind } from './syncFailure'
import { validPendingSyncFields, type PendingSyncFields } from './mobilePendingChanges'

const states = ['local', 'pending', 'committed', 'synced', 'diverged', 'failed', 'saveFailed'] as const
export type VaultSyncState = typeof states[number]
export type SyncPhase = 'checkpoint' | 'fetch' | 'checkout' | 'push' | 'clone' | null
export type VaultSyncRecord = PendingSyncFields & {
  status: VaultSyncState
  lastSuccessAt: number | null
  lastFailureAt?: number | null
  lastCommitId: string | null
  phase: SyncPhase
  error: SyncFailureKind | null
}
export const emptySyncRecord: VaultSyncRecord = { status: 'pending', lastSuccessAt: null, lastCommitId: null, phase: null, error: null }

export function parseSyncLedger(content: string | null): Record<string, VaultSyncRecord> {
  if (content === null) return {}
  try {
    const records: unknown = JSON.parse(content)
    if (!isRecord(records)) throw new Error('invalid')
    for (const [id, record] of Object.entries(records)) {
      requireValidEntry(id, record)
    }
    return records as Record<string, VaultSyncRecord>
  } catch { throw new Error('syncLedgerInvalid') }
}

function requireValidEntry(id: string, record: unknown) {
  if (!/^[a-z0-9-]{1,80}$/.test(id) || !validSyncRecord(record)) throw new Error('invalid')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validSyncRecord(value: unknown): value is VaultSyncRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return [
    states.includes(record.status as VaultSyncState),
    validRecordDates(record), nullableCommit(record.lastCommitId), validPendingSyncFields(record),
    [null, 'checkpoint', 'fetch', 'checkout', 'push', 'clone'].includes(record.phase as SyncPhase),
    [null, 'retry', 'authentication', 'conflict', 'local'].includes(record.error as SyncFailureKind | null),
  ].every(Boolean)
}

function validRecordDates(record: Record<string, unknown>) {
  return [record.lastSuccessAt, record.lastFailureAt ?? null].every(nullableTimestamp)
}

function nullableTimestamp(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

function nullableCommit(value: unknown) {
  return value === null || (typeof value === 'string' && /^[a-f0-9]{8,40}$/.test(value))
}
