// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import * as neighborhood from '../workspace/mobileNeighborhood'
import type { MobileNote, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import { useMobileInspectorReferenceGroups } from './useMobileInspectorReferenceGroups'

const cleanups: (() => Promise<void>)[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('inspector reference calculation lifetime', () => {
  it('calculates a 6,000-note pool once across unrelated display copies', async () => {
    const { source, snapshot } = fixture(6_000)
    const build = vi.spyOn(neighborhood, 'buildMobileInspectorReferenceGroups')
    const harness = createHarness()
    await harness.render(source, snapshot)
    await flushReferences()
    const first = harness.groups()
    expect(first[0]?.notes).toHaveLength(5_999)

    for (let index = 0; index < 5; index++) {
      await harness.render({ ...source, noteWidth: 'wide' }, snapshot)
      await flushReferences()
    }

    expect(build).toHaveBeenCalledTimes(1)
    expect(harness.groups()).toBe(first)
  })

  it.each(['title', 'path', 'type', 'aliases', 'workspaceAlias'] as const)(
    'recalculates when the selected note changes its %s', async (field) => {
      const { source, snapshot } = fixture()
      const build = vi.spyOn(neighborhood, 'buildMobileInspectorReferenceGroups')
      const harness = createHarness()
      await harness.render(source, snapshot)
      await flushReferences()
      const next: MobileNote = field === 'aliases'
        ? { ...source, aliases: ['Updated alias'] }
        : { ...source, [field]: 'Updated value' }

      await harness.render(next, snapshot)
      await flushReferences()
      expect(build).toHaveBeenCalledTimes(2)
      expect(harness.groups()).toEqual(neighborhood.buildMobileInspectorReferenceGroups(next, snapshot.allNotes ?? snapshot.notes))
    },
  )

  it('refreshes backlinks from a changed pool even when selection is unchanged', async () => {
    const { source, snapshot } = fixture()
    const harness = createHarness()
    await harness.render(source, snapshot)
    await flushReferences()
    expect(harness.groups()[0]?.notes).toHaveLength(1)
    const next = { ...snapshot, allNotes: [source] }

    await harness.render(source, next)
    await flushReferences()
    expect(harness.groups()).toEqual([])
  })

  it('does not publish a previous selection after navigation or clearing selection', async () => {
    const { source, snapshot } = fixture()
    const harness = createHarness()
    await harness.render(source, snapshot)
    await flushReferences()
    await harness.render({ ...source, id: 'next', title: 'Next' }, snapshot)
    expect(harness.groups()).toEqual([])
    await harness.render(null, snapshot)
    await flushReferences()
    expect(harness.groups()).toEqual([])
  })

  it('cancels deferred calculation when unmounted', async () => {
    const { source, snapshot } = fixture()
    const build = vi.spyOn(neighborhood, 'buildMobileInspectorReferenceGroups')
    const harness = createHarness()
    await harness.render(source, snapshot)
    await harness.unmount()
    await flushReferences()
    expect(build).not.toHaveBeenCalled()
  })
})

function fixture(count = 2) {
  const base = workspaceScenarioForId('default')
  const source: MobileNote = {
    ...base.notes[0], id: 'anchor', path: 'anchor.md', title: 'Anchor', type: 'Note',
    relationships: [], aliases: ['Home'], outgoingLinks: [],
  }
  const notes = [source, ...Array.from({ length: count - 1 }, (_, index) => ({
    ...source, id: `ref-${index}`, path: `ref-${index}.md`, title: `Reference ${index}`,
    outgoingLinks: ['anchor'],
  }))]
  return { source, snapshot: { ...base, allNotes: notes, notes: [source] } }
}

function createHarness() {
  const root = createRoot(document.createElement('div'))
  let groups: neighborhood.MobileNeighborhoodGroup[] = []
  let mounted = true
  function Probe({ note, snapshot }: { note: MobileNote | null; snapshot: MobileWorkspaceSnapshot }) {
    const current = useMobileInspectorReferenceGroups(note, snapshot)
    useEffect(() => { groups = current }, [current])
    return null
  }
  const unmount = async () => {
    if (!mounted) return
    mounted = false
    await act(async () => root.unmount())
  }
  cleanups.push(unmount)
  return {
    groups: () => groups,
    render: (note: MobileNote | null, snapshot: MobileWorkspaceSnapshot) => act(async () => {
      root.render(createElement(Probe, { note, snapshot }))
    }),
    unmount,
  }
}

function flushReferences() {
  return act(async () => vi.advanceTimersByTimeAsync(0))
}
