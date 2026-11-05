// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useVaultSyncLedger } from './useVaultSyncLedger'

const io = vi.hoisted(() => ({ readSyncLedger: async () => null, writeSyncLedger: vi.fn(async () => {}) }))
vi.mock('./syncLedgerStorage', () => io)

it('records failure time when the operation reports a problem, not when the pill renders', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const now = Date.UTC(2026, 9, 20, 16)
  vi.setSystemTime(now)
  const root = createRoot(document.createElement('div'))
  let current: ReturnType<typeof useVaultSyncLedger> | undefined
  function Probe() {
    const value = useVaultSyncLedger('owned')
    useLayoutEffect(() => { current = value }, [value])
    return null
  }
  const state = () => { if (!current) throw new Error('Ledger not mounted'); return current }
  try {
    await act(async () => root.render(createElement(Probe)))
    await act(async () => state().setProblem('authentication'))
    expect(state().record.lastFailureAt).toBe(now)
    vi.setSystemTime(now + 60_000)
    await act(async () => state().setProblem(null))
    expect(state().record.lastFailureAt).toBe(now)
    expect(state().record.lastSuccessAt).toBeNull()
  } finally {
    await act(async () => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
