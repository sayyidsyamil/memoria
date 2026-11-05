// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useManagedVaultCatalog } from './useManagedVaultCatalog'
import type { WorkspaceSnapshotPreview } from '../workspaceSnapshotPreview'
import type { NativeWorkspaceSelection } from '../nativeWorkspacePicker'
import { workspaceScenarioForId } from '../../fixtures/workspaceFixtures'

const source = vi.hoisted(() => ({ initialize: vi.fn(), local: vi.fn(), git: vi.fn(), prepare: vi.fn(), preview: vi.fn() }))
vi.mock('./managedLocalStorage', () => ({ initializeLocalVaultCatalog: source.initialize, managedLocalSelection: source.local }))
vi.mock('./managedGitStorage', () => ({ managedGitSelection: source.git, readManagedGitCatalog: source.initialize }))
vi.mock('../prepareNativeWorkspace', () => ({ prepareNativeWorkspace: source.prepare }))
vi.mock('../nativeWorkspaceStartupPreview', () => ({ readNativeWorkspaceStartupPreview: source.preview }))

const selection: NativeWorkspaceSelection = { vaultAlias: 'qa', vaultLabel: 'QA', vaultRootUri: 'file:///qa' }
const preview: WorkspaceSnapshotPreview = { kind: 'provisional', notes: [], allNotes: [], typeDefinitions: {},
  sidebarSections: [], noteListSubtitle: '' }
const roots: ReturnType<typeof createRoot>[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.resetAllMocks()
  source.initialize.mockResolvedValue({ vaults: [], localVaults: [{ id: 'qa' }], activeLocalId: 'qa' })
  source.local.mockResolvedValue(selection)
  source.preview.mockResolvedValue(preview)
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

it('publishes metadata while preparation is pending, then removes it before publishing editable selection', async () => {
  const prepared = deferred<NativeWorkspaceSelection>()
  source.prepare.mockReturnValue(prepared.promise)
  const catalog = await mountCatalog()
  expect(catalog.current).toMatchObject({ pending: true, restored: null, preview })
  expect(source.prepare).toHaveBeenCalledWith(selection, expect.any(AbortSignal))
  await act(async () => prepared.resolve(selection))
  expect(catalog.current).toMatchObject({ pending: false, restored: { selection, git: null }, preview: null })
})

it('publishes cached navigation before indexing can occupy the shared native async queue', async () => {
  const cached = deferred<WorkspaceSnapshotPreview>()
  source.preview.mockReturnValue(cached.promise)
  const prepared = deferred<NativeWorkspaceSelection>()
  source.prepare.mockReturnValue(prepared.promise)
  const catalog = await mountCatalog()
  expect(source.prepare).not.toHaveBeenCalled()
  await act(async () => cached.resolve(preview))
  expect(source.prepare).toHaveBeenCalledWith(selection, expect.any(AbortSignal))
  expect(catalog.current).toMatchObject({ pending: true, restored: null, preview })
  await act(async () => prepared.resolve(selection))
  expect(catalog.current).toMatchObject({ pending: false, restored: { selection }, preview: null })
})

it('retains available cached navigation when subsequent preparation fails', async () => {
  const cached = deferred<WorkspaceSnapshotPreview>()
  source.preview.mockReturnValue(cached.promise)
  source.prepare.mockRejectedValue(new Error('indexUnavailable'))
  const catalog = await mountCatalog()
  expect(source.prepare).not.toHaveBeenCalled()
  await act(async () => cached.resolve(preview))
  expect(catalog.current).toMatchObject({ pending: false, error: 'selection', restored: null, preview })
})

it('still waits for fresh preparation on a cache miss', async () => {
  source.preview.mockResolvedValue(null)
  const prepared = deferred<NativeWorkspaceSelection>()
  source.prepare.mockReturnValue(prepared.promise)
  const catalog = await mountCatalog()
  expect(catalog.current).toMatchObject({ pending: true, preview: null, restored: null })
  await act(async () => prepared.resolve(selection))
  expect(catalog.current.restored?.selection).toBe(selection)
})

it('carries the chosen cached note into the fresh selection without replaying cached source', async () => {
  const notes = workspaceScenarioForId(null).notes
  const cached = { ...preview, notes }
  source.preview.mockResolvedValue(cached)
  const prepared = deferred<NativeWorkspaceSelection>()
  source.prepare.mockReturnValue(prepared.promise)
  const catalog = await mountCatalog()
  await act(async () => catalog.current.selectPreviewNote(notes[1].id))
  expect(catalog.current.preview?.selectedNoteId).toBe(notes[1].id)
  expect(catalog.current.restored).toBeNull()
  await act(async () => prepared.resolve(selection))
  expect(catalog.current.restored?.selection).toEqual({ ...selection, selectedNoteId: notes[1].id })
  expect(catalog.current.preview).toBeNull()
})

it('ignores unknown cached selections and never changes an active selection through the preview callback', async () => {
  const prepared = deferred<NativeWorkspaceSelection>()
  source.prepare.mockReturnValue(prepared.promise)
  const catalog = await mountCatalog()
  await act(async () => catalog.current.selectPreviewNote('not-in-preview'))
  expect(catalog.current.preview).toBe(preview)
  await act(async () => prepared.resolve(selection))
  await act(async () => catalog.current.selectPreviewNote('not-in-preview'))
  expect(catalog.current.restored?.selection).toBe(selection)
})

it('retains provisional metadata and selection error reporting when preparation fails', async () => {
  const prepared = deferred<NativeWorkspaceSelection>()
  source.prepare.mockReturnValue(prepared.promise)
  const catalog = await mountCatalog()
  expect(catalog.current.preview).toBe(preview)
  await act(async () => prepared.reject(new Error('recoverFailed')))
  expect(catalog.current).toMatchObject({ pending: false, error: 'selection', preview, restored: null })
})

it('cancels concurrent preparation and presentation on unmount', async () => {
  source.prepare.mockReturnValue(new Promise(() => {}))
  const cached = deferred<WorkspaceSnapshotPreview>()
  source.preview.mockReturnValue(cached.promise)
  const catalog = await mountCatalog()
  const signal = source.preview.mock.calls[0][1]
  await catalog.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => cached.resolve(preview))
  expect(source.prepare).not.toHaveBeenCalled()
})

it('reports an unreadable catalog without reading any selected vault', async () => {
  source.initialize.mockRejectedValue(new Error('catalogUnavailable'))
  const catalog = await mountCatalog()
  expect(catalog.current).toMatchObject({ error: 'catalog', pending: false, preview: null })
  expect(source.local).not.toHaveBeenCalled()
  expect(source.preview).not.toHaveBeenCalled()
})

it('restores Git vaults through their existing recovery path', async () => {
  const git = { id: 'git-qa' }
  source.initialize.mockResolvedValue({ vaults: [git], activeId: git.id })
  source.git.mockResolvedValue(selection)
  source.prepare.mockResolvedValue(selection)
  const catalog = await mountCatalog()
  expect(source.git).toHaveBeenCalledWith(git)
  expect(source.local).not.toHaveBeenCalled()
  expect(catalog.current.restored).toEqual({ git, selection })
})

it('preserves an empty catalog without inventing a selected vault or preview', async () => {
  source.initialize.mockResolvedValue({ vaults: [] })
  source.preview.mockResolvedValue(null)
  source.prepare.mockResolvedValue(null)
  const catalog = await mountCatalog()
  expect(source.prepare).toHaveBeenCalledWith(null, expect.any(AbortSignal))
  expect(catalog.current).toMatchObject({ localVaults: [], pending: false, restored: { selection: null, git: null }, preview: null })
})

it('does not start preparation after unmount during selected-vault recovery', async () => {
  const restored = deferred<NativeWorkspaceSelection>()
  source.local.mockReturnValue(restored.promise)
  const catalog = await mountCatalog()
  await catalog.unmount()
  await act(async () => restored.resolve(selection))
  expect(source.prepare).not.toHaveBeenCalled()
  expect(source.preview).not.toHaveBeenCalled()
})

it('does not recover any vault after unmount during catalog IO', async () => {
  const initial = deferred<object>()
  source.initialize.mockReturnValue(initial.promise)
  const catalog = await mountCatalog()
  await catalog.unmount()
  await act(async () => initial.resolve({ vaults: [], activeLocalId: 'qa', localVaults: [{ id: 'qa' }] }))
  expect(source.local).not.toHaveBeenCalled()
})

it('does not let a failed presentation read fail a successful vault restoration', async () => {
  source.preview.mockRejectedValue(new Error('cacheReadFailed'))
  source.prepare.mockResolvedValue(selection)
  const catalog = await mountCatalog()
  expect(catalog.current).toMatchObject({ pending: false, error: null, preview: null, restored: { selection } })
})

it('keeps a retried load isolated from the previous load\'s late cache result', async () => {
  const oldCache = deferred<WorkspaceSnapshotPreview>()
  const preparing = deferred<NativeWorkspaceSelection>()
  const nextPreview = { ...preview, noteListSubtitle: 'next' }
  source.preview.mockReturnValueOnce(oldCache.promise).mockResolvedValueOnce(nextPreview)
  source.prepare.mockReturnValue(preparing.promise)
  const catalog = await mountCatalog()
  const firstSignal = source.preview.mock.calls[0][1]
  await act(async () => catalog.current.retry())
  expect(firstSignal.aborted).toBe(true)
  expect(catalog.current).toMatchObject({ error: null, pending: true, preview: nextPreview })
  await act(async () => oldCache.resolve(preview))
  expect(catalog.current.preview).toBe(nextPreview)
  await act(async () => preparing.resolve(selection))
  expect(catalog.current.preview).toBeNull()
})

it.each(['catalog', 'selection'] as const)('reloads metadata without hiding an unrelated %s failure', async error => {
  if (error === 'catalog') source.initialize.mockRejectedValueOnce(new Error('catalogUnavailable'))
  else source.prepare.mockRejectedValueOnce(new Error('selectionUnavailable'))
  const catalog = await mountCatalog()
  source.initialize.mockResolvedValue({ vaults: [{ id: 'updated' }], localVaults: [] })
  await act(async () => catalog.current.reload())
  expect(catalog.current.vaults).toEqual([{ id: 'updated' }])
  expect(catalog.current.error).toBe(error === 'catalog' ? null : 'selection')
})

async function mountCatalog() {
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  let current: ReturnType<typeof useManagedVaultCatalog>
  function Probe() {
    const value = useManagedVaultCatalog()
    useLayoutEffect(() => { current = value }, [value])
    return null
  }
  await act(async () => root.render(createElement(Probe)))
  return { get current() { return current }, unmount: () => act(async () => root.unmount()) }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
