import { expect, it } from 'vitest'
import { emptySyncRecord, parseSyncLedger } from './syncLedgerModel'
import { createSyncLedger } from './syncLedger'

it('retains older ledgers without inventing a failure timestamp', () => {
  expect(parseSyncLedger(JSON.stringify({ owned: emptySyncRecord })).owned.lastFailureAt).toBeUndefined()
})
it.each([-1, 'yesterday', {}])('rejects an invalid optional failure timestamp (%s)', lastFailureAt => {
  expect(() => parseSyncLedger(JSON.stringify({ owned: { ...emptySyncRecord, lastFailureAt } })))
    .toThrow('syncLedgerInvalid')
})
it('persists a real failure timestamp independently of the last successful sync', async () => {
  let disk: string | null = null
  const io = { read: async () => disk, write: async (content: string) => { disk = content } }
  const ledger = createSyncLedger(io)
  await ledger.load()
  ledger.update('owned', { status: 'failed', lastSuccessAt: 100, lastFailureAt: 200 })
  await ledger.flush()
  const restored = createSyncLedger(io)
  await restored.load()
  expect(restored.get('owned')).toMatchObject({ status: 'failed', lastSuccessAt: 100, lastFailureAt: 200 })
})
