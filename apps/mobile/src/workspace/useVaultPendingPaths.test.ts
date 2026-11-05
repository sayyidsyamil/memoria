// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useVaultSyncLedger } from './useVaultSyncLedger'

const io = vi.hoisted(() => ({ content: null as string | null }))
vi.mock('./syncLedgerStorage', () => ({
  readSyncLedger: async () => io.content,
  writeSyncLedger: async (content: string) => { io.content = content },
}))
afterEach(() => { io.content = null; vi.unstubAllGlobals() })

function ledgerHarness() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const root = createRoot(document.createElement('div'))
  let current: ReturnType<typeof useVaultSyncLedger> | undefined
  function Probe({ id }: { id: string }) {
    const value = useVaultSyncLedger(id)
    useLayoutEffect(() => { current = value }, [value])
    return null
  }
  return {
    select: (id: string) => act(async () => root.render(createElement(Probe, { id }))),
    read: () => { if (!current) throw new Error('Ledger not mounted'); return current },
    close: () => act(async () => root.unmount()),
  }
}

it('keeps concurrent edits pending and preserves conflict status when tracking note writes', async () => {
  const ledger = ledgerHarness()
  try {
    await ledger.select('owned')
    await act(async () => ledger.read().markDirty(['note.md']))
    const checkpoint = ledger.read().pendingCheckpoint()
    await act(async () => ledger.read().markDirty(['note.md', 'new.md']))
    await act(async () => ledger.read().acknowledgePending(checkpoint))
    expect(ledger.read().record.pendingPaths?.map(change => change.path)).toEqual(['note.md', 'new.md'])
    await act(async () => ledger.read().setStatus('diverged'))
    await act(async () => ledger.read().markDirty(['other.md']))
    expect(ledger.read().record.status).toBe('diverged')
  } finally { await ledger.close() }
})

it('persists pending paths across relaunches without leaking them between vaults', async () => {
  const first = ledgerHarness()
  try {
    await first.select('alpha')
    await act(async () => first.read().markDirty(['alpha.md']))
    await first.select('beta')
    expect(first.read().record.pendingPaths ?? []).toEqual([])
    await act(async () => first.read().markDirty(['beta.md']))
  } finally { await first.close() }
  const restored = ledgerHarness()
  try {
    await restored.select('alpha')
    expect(restored.read().record.pendingPaths?.map(change => change.path)).toEqual(['alpha.md'])
    await act(async () => restored.read().acknowledgePending(restored.read().pendingCheckpoint()))
    expect(restored.read().record.pendingPaths).toEqual([])
    await restored.select('beta')
    expect(restored.read().record.pendingPaths?.map(change => change.path)).toEqual(['beta.md'])
  } finally { await restored.close() }
})
