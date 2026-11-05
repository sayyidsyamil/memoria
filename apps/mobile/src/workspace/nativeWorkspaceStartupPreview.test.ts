import { beforeEach, expect, it, vi } from 'vitest'
import { readNativeWorkspaceStartupPreview } from './nativeWorkspaceStartupPreview'
import { withWorkspaceOperation } from './git/workspaceOperationQueue'
import type { WorkspaceSnapshotPreview } from './workspaceSnapshotPreview'
import type { WorkspaceSnapshotIdentity } from './workspaceSnapshotEnvelope'

const native = vi.hoisted(() => ({ module: null as { recoverWorkspaceText?: () => boolean } | null,
  recover: vi.fn(), config: vi.fn(), preview: vi.fn() }))
vi.mock('./nativeWorkspaceAccess', () => ({ optionalNativeWorkspaceAccessModule: () => native.module }))
vi.mock('./expoWorkspaceFileSystem', () => ({ expoWorkspaceFileSystem: { recoverPendingWrites: native.recover, readVaultConfig: native.config } }))
vi.mock('./workspaceSnapshotPreview', () => ({ readWorkspaceSnapshotPreview: native.preview }))
beforeEach(() => { native.module = null; native.recover.mockReset(); native.config.mockReset(); native.preview.mockReset() })

function fixture() {
  const selection = { vaultAlias: 'fixture', vaultLabel: 'Fixture', vaultRootUri: 'file:///fixture' }
  const preview: WorkspaceSnapshotPreview = { kind: 'provisional', notes: [], allNotes: [], typeDefinitions: {},
    sidebarSections: [], noteListSubtitle: '' }
  const calls: string[] = []
  const dependencies = {
    recover: vi.fn(() => { calls.push('recover') }),
    readConfig: vi.fn(() => { calls.push('config'); return { defaultNoteWidth: 'wide' as const } }),
    readPreview: vi.fn<(identity: WorkspaceSnapshotIdentity, signal?: AbortSignal) => Promise<WorkspaceSnapshotPreview>>(
      async () => { calls.push('preview'); return preview }),
  }
  return { selection, preview, calls, dependencies }
}

it('validates/replays the root before reading config or cached metadata', async () => {
  const f = fixture()
  expect(await readNativeWorkspaceStartupPreview(f.selection, undefined, f.dependencies)).toBe(f.preview)
  expect(f.calls).toEqual(['recover', 'config', 'preview'])
  expect(f.dependencies.recover).toHaveBeenCalledWith(f.selection.vaultRootUri)
  expect(f.dependencies.readPreview).toHaveBeenCalledWith({ vaultPath: 'file:///fixture', vaultLabel: 'Fixture', vaultAlias: 'fixture',
    vaultConfig: { defaultNoteWidth: 'wide' } }, expect.any(AbortSignal))
})

it('does not bypass the active workspace operation barrier', async () => {
  const f = fixture()
  const gate = deferred<void>()
  const entered = deferred<void>()
  const mutation = withWorkspaceOperation(f.selection.vaultRootUri, async () => { entered.resolve(); await gate.promise })
  await entered.promise
  const reading = readNativeWorkspaceStartupPreview(f.selection, undefined, f.dependencies)
  expect(f.calls).toEqual([])
  gate.resolve()
  await mutation
  expect(await reading).toBe(f.preview)
})

it('releases the workspace barrier before waiting for private cache IO', async () => {
  const f = fixture()
  const cached = deferred<WorkspaceSnapshotPreview>()
  f.dependencies.readPreview.mockImplementation(() => cached.promise)
  const reading = readNativeWorkspaceStartupPreview(f.selection, undefined, f.dependencies)
  await withWorkspaceOperation(f.selection.vaultRootUri, async () => { f.calls.push('fresh-index') })
  expect(f.calls).toEqual(['recover', 'config', 'fresh-index'])
  cached.resolve(f.preview)
  expect(await reading).toBe(f.preview)
})

it.each(['recover', 'readConfig', 'readPreview'] as const)('treats %s failure as a preview miss, not a vault failure', async method => {
  const f = fixture()
  f.dependencies[method].mockImplementation(() => { throw new Error('unavailable') })
  expect(await readNativeWorkspaceStartupPreview(f.selection, undefined, f.dependencies)).toBeNull()
  if (method !== 'readPreview') expect(f.dependencies.readPreview).not.toHaveBeenCalled()
})

it('does not read private cache for an absent or already cancelled selection', async () => {
  const f = fixture()
  const controller = new AbortController()
  controller.abort()
  expect(await readNativeWorkspaceStartupPreview(null, undefined, f.dependencies)).toBeNull()
  expect(await readNativeWorkspaceStartupPreview(f.selection, controller.signal, f.dependencies)).toBeNull()
  expect(f.calls).toEqual([])
})

it('ignores a cache result that arrives after cancellation', async () => {
  const f = fixture()
  const controller = new AbortController()
  f.dependencies.readPreview.mockImplementation(async () => { controller.abort(); return f.preview })
  expect(await readNativeWorkspaceStartupPreview(f.selection, controller.signal, f.dependencies)).toBeNull()
})

it('fails closed without the native managed-root/recovery capability', async () => {
  const f = fixture()
  expect(await readNativeWorkspaceStartupPreview(f.selection)).toBeNull()
  native.module = {}
  expect(await readNativeWorkspaceStartupPreview(f.selection)).toBeNull()
  expect(native.preview).not.toHaveBeenCalled()
  expect(native.config).not.toHaveBeenCalled()
})

it('uses the production root/recovery and cache adapters without transferring sources or indexing', async () => {
  const f = fixture()
  native.module = { recoverWorkspaceText: () => false }
  native.config.mockReturnValue(undefined)
  native.preview.mockResolvedValue(f.preview)
  expect(await readNativeWorkspaceStartupPreview(f.selection)).toBe(f.preview)
  expect(native.recover).toHaveBeenCalledWith('file:///fixture')
  expect(native.preview).toHaveBeenCalledWith({ vaultPath: 'file:///fixture', vaultAlias: 'fixture', vaultLabel: 'Fixture', vaultConfig: null },
    undefined, expect.any(AbortSignal))
})

it('does not read cache after cancellation while queued behind a workspace operation', async () => {
  const f = fixture()
  const gate = deferred<void>()
  const mutation = withWorkspaceOperation(f.selection.vaultRootUri, async () => gate.promise)
  const controller = new AbortController()
  const reading = readNativeWorkspaceStartupPreview(f.selection, controller.signal, f.dependencies)
  controller.abort()
  gate.resolve()
  await mutation
  expect(await reading).toBeNull()
  expect(f.calls).toEqual([])
})

it('does not read cache if the request is cancelled during root/config preparation', async () => {
  const f = fixture()
  const controller = new AbortController()
  f.dependencies.recover.mockImplementation(() => { controller.abort() })
  expect(await readNativeWorkspaceStartupPreview(f.selection, controller.signal, f.dependencies)).toBeNull()
  expect(f.dependencies.readPreview).not.toHaveBeenCalled()
})

it('bounds cache waiting without cancelling authoritative source preparation, and ignores late IO', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    const cache = deferred<WorkspaceSnapshotPreview>()
    const parent = new AbortController()
    f.dependencies.readPreview.mockReturnValue(cache.promise)
    const reading = readNativeWorkspaceStartupPreview(f.selection, parent.signal, f.dependencies)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await reading).toBeNull()
    expect(parent.signal.aborted).toBe(false)
    const child = f.dependencies.readPreview.mock.calls[0][1]
    expect(child?.aborted).toBe(true)
    cache.resolve(f.preview)
    expect(await reading).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})

it('does not discard a valid cache on a slow device when startup explicitly prioritizes cache IO', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    const cache = deferred<WorkspaceSnapshotPreview>()
    f.dependencies.readPreview.mockReturnValue(cache.promise)
    const reading = readNativeWorkspaceStartupPreview(f.selection, undefined, f.dependencies, true)
    let settled = false
    void reading.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toBe(false)
    cache.resolve(f.preview)
    expect(await reading).toBe(f.preview)
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
