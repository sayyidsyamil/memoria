import { expect, it, vi } from 'vitest'
import { createSyncLedger, parseSyncLedger } from './syncLedger'

it('persists independent vault histories and converts interrupted work to pending on reload', async () => {
  let disk: string | null = null
  const io = { read: async () => disk, write: async (value: string) => { disk = value } }
  const ledger = createSyncLedger(io)
  await ledger.load()
  ledger.update('alpha', { status: 'synced', lastSuccessAt: 100 })
  ledger.update('beta', { status: 'committed', lastCommitId: '12345678', phase: 'push' })
  await ledger.flush()
  const restored = createSyncLedger(io)
  await restored.load()
  expect(restored.get('alpha')).toMatchObject({ status: 'synced', lastSuccessAt: 100 })
  expect(restored.get('beta')).toMatchObject({ status: 'pending', phase: null, lastCommitId: '12345678', lastSuccessAt: null })
})

it('does not overwrite a new edit with a late disk read', async () => {
  let resolve: (value: string) => void = () => {}
  const ledger = createSyncLedger({ read: () => new Promise(done => { resolve = done }), write: vi.fn() })
  const load = ledger.load()
  ledger.update('alpha', { status: 'pending' })
  resolve(JSON.stringify({ alpha: { status: 'synced', lastSuccessAt: 100, lastCommitId: null, phase: null, error: null } }))
  await load
  expect(ledger.get('alpha').status).toBe('pending')
  expect(ledger.get('alpha').lastSuccessAt).toBe(100)
})

it('reports persistence failures without discarding the pending in-memory state', async () => {
  const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
  const ledger = createSyncLedger({ read: async () => null, write })
  await ledger.load()
  ledger.update('alpha', { status: 'committed' })
  await expect(ledger.flush()).rejects.toThrow('disk full')
  expect(ledger.get('alpha').status).toBe('committed')
  expect(ledger.failed()).toBe(true)
  ledger.update('alpha', { status: 'pending' })
  await ledger.flush()
  expect(ledger.failed()).toBe(false)
})

it.each(['[]', '{"alpha":{"status":"invented"}}', '{broken'])('rejects corrupt status metadata', content => {
  expect(() => parseSyncLedger(content)).toThrow('syncLedgerInvalid')
})

it('deduplicates restoration and does not read inherited object keys as vault state', async () => {
  const read = vi.fn().mockResolvedValue(null)
  const ledger = createSyncLedger({ read, write: vi.fn() })
  const first = ledger.load()
  expect(ledger.load()).toBe(first)
  await first
  expect(read).toHaveBeenCalledOnce()
  expect(ledger.get('constructor')).toMatchObject({ status: 'pending' })
})
