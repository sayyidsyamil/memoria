import { parseSyncLedger } from './syncLedgerModel'

const key = 'memoria-mobile-sync-history'
export async function readSyncLedger() {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
}
export async function writeSyncLedger(content: string) {
  parseSyncLedger(content)
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, content)
}
