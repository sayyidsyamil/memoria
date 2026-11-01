import { beforeEach, expect, it, vi } from 'vitest'
import { readSyncLedger, writeSyncLedger } from './syncLedgerStorage.native'
import { emptySyncRecord } from './syncLedgerModel'

const disk = vi.hoisted(() => ({ files: new Map<string, string>(), failPublish: false }))
vi.mock('expo-file-system', () => ({
  Paths: { document: '/documents' },
  File: class {
    uri: string
    constructor(...parts: string[]) { this.uri = parts.join('/') }
    get exists() { return disk.files.has(this.uri) }
    get parentDirectory() { return { create: () => {} } }
    async text() { return disk.files.get(this.uri) ?? '' }
    write(value: string) { disk.files.set(this.uri, value) }
    delete() { disk.files.delete(this.uri) }
    move(target: { uri: string }) {
      if (disk.failPublish && this.uri.endsWith('.pending')) throw new Error('interrupted')
      const value = disk.files.get(this.uri)
      if (value === undefined) throw new Error('missing file')
      disk.files.set(target.uri, value)
      disk.files.delete(this.uri)
      this.uri = target.uri
    }
  },
}))

const current = '/documents/.memoria-mobile-config/sync-history.json'
const saved = JSON.stringify({ alpha: emptySyncRecord })
beforeEach(() => { disk.files.clear(); disk.failPublish = false })

it('recovers the previous ledger if publication is interrupted', async () => {
  await writeSyncLedger(saved)
  disk.failPublish = true
  await expect(writeSyncLedger('{}')).rejects.toThrow('interrupted')
  expect(await readSyncLedger()).toBe(saved)
})

it('preserves a readable backup when the current ledger is corrupt', async () => {
  disk.files.set(current, 'broken')
  disk.files.set(`${current}.backup`, saved)
  disk.failPublish = true
  await expect(writeSyncLedger('{}')).rejects.toThrow('interrupted')
  expect(await readSyncLedger()).toBe(saved)
})

it('does not overwrite an unrecoverable ledger', async () => {
  disk.files.set(current, 'broken')
  await expect(writeSyncLedger('{}')).rejects.toThrow()
  expect(disk.files.get(current)).toBe('broken')
})
