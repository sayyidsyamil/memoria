// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { useMobileWorkspaceResolution } from './useMobileWorkspaceResolution'

describe('workspace snapshot lifetime', () => {
  it('does not reread disk for an equivalent request on a parent rerender', async () => {
    const harness = createHarness()
    await harness.render()
    const first = harness.result()
    await harness.render()
    expect(harness.readSnapshot).toHaveBeenCalledTimes(1)
    expect(harness.result()).toBe(first)
    await harness.unmount()
  })

  it('rebuilds after a vault revision even when its path has not changed', async () => {
    const harness = createHarness()
    await harness.render()
    await harness.render({})
    expect(harness.readSnapshot).toHaveBeenCalledTimes(2)
    await harness.unmount()
  })

  it('rebuilds when switching vaults without retaining the previous request', async () => {
    const harness = createHarness()
    await harness.render()
    await harness.render(undefined, 'file:///second')
    expect(harness.readSnapshot).toHaveBeenCalledTimes(2)
    expect(harness.result()?.repositoryRequest.vaultRootUri).toBe('file:///second')
    await harness.unmount()
  })
})

function createHarness() {
  const root = createRoot(document.createElement('div'))
  const readSnapshot = vi.fn(() => workspaceScenarioForId('default'))
  const probeRepository = { readSnapshot, persistWrites: vi.fn(), readNoteContent: vi.fn() }
  let result: ReturnType<typeof useMobileWorkspaceResolution> | undefined
  function Probe({ revision, uri }: { revision?: object; uri: string }) {
    const resolved = useMobileWorkspaceResolution({
      devVaultState: null,
      persistenceProbeEnabled: false,
      probeRepository,
      repositoryRequest: { source: 'native', vaultRootUri: uri },
      source: 'native',
    }, revision)
    useEffect(() => { result = resolved }, [resolved])
    return null
  }
  return {
    readSnapshot,
    result: () => result,
    render: (revision?: object, uri = 'file:///first') => act(async () => {
      root.render(createElement(Probe, { revision, uri }))
    }),
    unmount: () => act(async () => root.unmount()),
  }
}
