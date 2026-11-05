import { emptySyncRecord, parseSyncLedger, type VaultSyncRecord } from './syncLedgerModel'
export { parseSyncLedger } from './syncLedgerModel'

export function createSyncLedger(io: { read: () => Promise<string | null>; write: (value: string) => Promise<void> }) {
  let records: Record<string, VaultSyncRecord> = {}
  let failed = false
  let pending = Promise.resolve()
  let loading = Promise.resolve()
  let hydrated = false
  let started = false
  const earlyUpdates: Record<string, Partial<VaultSyncRecord>> = {}
  const listeners = new Set<() => void>()
  const notify = () => { for (const listener of listeners) listener() }
  const get = (id?: string) => id && Object.hasOwn(records, id) ? records[id] : emptySyncRecord

  function load() {
    if (started) return loading
    started = true
    loading = io.read().then(content => {
      const restored = parseSyncLedger(content)
      for (const record of Object.values(restored)) {
        if (record.phase) { record.phase = null; record.status = 'pending' }
      }
      for (const [id, patch] of Object.entries(earlyUpdates)) {
        restored[id] = { ...emptySyncRecord, ...restored[id], ...patch }
      }
      records = restored
      hydrated = true
      failed = false
      notify()
    }).catch(error => { failed = true; notify(); throw error })
    return loading
  }

  function update(id: string, patch: Partial<VaultSyncRecord>) {
    if (!hydrated) earlyUpdates[id] = { ...earlyUpdates[id], ...patch }
    const next = { ...get(id), ...patch }
    if (JSON.stringify(records[id]) === JSON.stringify(next)) return
    records = { ...records, [id]: next }
    notify()
    pending = pending.catch(() => undefined).then(async () => {
      await loading
      await io.write(JSON.stringify(records))
      failed = false
      notify()
    })
    void pending.catch(() => { failed = true; notify() })
  }

  return { get, load, update, failed: () => failed, flush: () => pending,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}
