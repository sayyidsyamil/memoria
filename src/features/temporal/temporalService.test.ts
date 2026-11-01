import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { temporalService } from './temporalService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
beforeEach(() => { vi.mocked(invoke).mockReset() })

it('uses the temporal command envelope and preserves backend query results', async () => {
  const result = { answer: 42, evidence: [{ quote: 'Approved 42', meeting: 'meeting-1' }] }
  vi.mocked(invoke).mockResolvedValue(result)
  await expect(temporalService.query('/vault', { type: 'as_of_tx', object_id: 'project', attribute: 'budget', tx_at: '2026-11-01T10:00:00Z' })).resolves.toEqual(result)
  expect(invoke).toHaveBeenCalledWith('temporal_api', { request: { vaultPath: '/vault', method: 'query', params: {
    type: 'as_of_tx', object_id: 'project', attribute: 'budget', tx_at: '2026-11-01T10:00:00Z',
  } } })
})

it.each([
  { type: 'as_of_valid' as const, valid_at: '2026-10-15' },
  { type: 'as_of_tx' as const, tx_at: '2026-11-01T10:00:00+08:00', valid_at: '2026-10-15' },
])('forwards query dates unchanged: %j', async time => {
  vi.mocked(invoke).mockResolvedValue({ answer: null })
  const params = { object_id: 'project', attribute: 'budget', ...time }
  await temporalService.query('/vault', params)
  expect(invoke).toHaveBeenCalledWith('temporal_api', { request: { vaultPath: '/vault', method: 'query', params } })
})

it.each([
  ['No reviewed transcript', 'No reviewed transcript'],
  [{ code: 'INVALID_REQUEST', message: 'Reason is required' }, 'Reason is required'],
  [null, 'The tracked facts service is unavailable. Please try again.'],
])('exposes a readable error for rejected backend requests', async (error, message) => {
  vi.mocked(invoke).mockRejectedValue(error)
  await expect(temporalService.overview('/vault')).rejects.toThrow(message)
})
