import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { announceMemoryChanged } from '../../hooks/useWorkspaceSummary'
import { useTrackedSummary } from './useTrackedSummary'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const overview = (objects: number, facts: number, proposals: number) => ({
  registry: { objects: Array.from({ length: objects }, (_, index) => ({ object_id: `o${index}` })) },
  facts: Array.from({ length: facts }, (_, index) => ({ fact_id: index })),
  proposals: Array.from({ length: proposals }, (_, index) => ({ proposal_id: index })),
  check: { ok: true, problems: [] },
})
beforeEach(() => { vi.mocked(invoke).mockReset() })

it('counts tracked items, approved values and suggestions waiting', async () => {
  vi.mocked(invoke).mockResolvedValue(overview(6, 10, 3))
  const { result } = renderHook(() => useTrackedSummary('/vault'))
  expect(result.current).toBeNull()
  await waitFor(() => expect(result.current).toEqual({ items: 6, facts: 10, suggestions: 3, byMeeting: {} }))
  expect(invoke).toHaveBeenCalledWith('temporal_api', { request: { vaultPath: '/vault', method: 'overview', params: {} } })
})

it('reads again when memory changes or the window regains focus, and keeps the counts when a read fails', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(overview(1, 0, 4)).mockResolvedValueOnce(overview(1, 1, 3)).mockRejectedValueOnce(new Error('Busy'))
  const { result } = renderHook(() => useTrackedSummary('/vault'))
  await waitFor(() => expect(result.current?.suggestions).toBe(4))
  act(() => announceMemoryChanged())
  await waitFor(() => expect(result.current?.suggestions).toBe(3))
  act(() => { window.dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
  await act(async () => { await Promise.resolve() })
  expect(result.current).toEqual({ items: 1, facts: 1, suggestions: 3, byMeeting: {} })
})

it('never shows the counts of another vault', async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args) =>
    (args as { request: { vaultPath: string } }).request.vaultPath === '/old' ? overview(1, 1, 9) : new Promise(() => undefined))
  const { result, rerender } = renderHook(({ vault }) => useTrackedSummary(vault), { initialProps: { vault: '/old' } })
  await waitFor(() => expect(result.current?.suggestions).toBe(9))
  rerender({ vault: '/new' })
  expect(result.current).toBeNull()
})

it('counts, for each meeting, the approved values its words set', async () => {
  const quote = (meeting: string | null) => ({ quote: 'Fictional quote.', speaker: 'Aisha', meeting })
  vi.mocked(invoke).mockResolvedValue({ ...overview(3, 0, 0), facts: [
    { fact_id: 1, evidence: [quote('kick-off')] },
    { fact_id: 2, evidence: [quote('kick-off'), quote('kick-off')] },
    { fact_id: 3, evidence: [quote('pre-launch'), quote('kick-off')] },
    { fact_id: 4, evidence: [quote(null)] },
    { fact_id: 5 },
  ] })
  const { result } = renderHook(() => useTrackedSummary('/vault'))
  await waitFor(() => expect(result.current?.byMeeting).toEqual({ 'kick-off': 3, 'pre-launch': 1 }))
})
