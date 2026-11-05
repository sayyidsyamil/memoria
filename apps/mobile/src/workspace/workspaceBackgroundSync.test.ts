import { expect, it, vi } from 'vitest'
import { withWorkspaceBackgroundSync } from './workspaceBackgroundSync'
import type { NativeWorkspaceAccessModule } from './nativeWorkspaceAccess'

function fixture(granted = true) {
  let expire: (event: { identifier: string }) => void = () => {}
  const remove = vi.fn()
  const module: NativeWorkspaceAccessModule = {
    importWorkspace: vi.fn(), restoreWorkspace: vi.fn(),
    createWorkspaceOperationId: () => 'lease-1',
    beginWorkspaceSync: vi.fn().mockResolvedValue(granted),
    endWorkspaceSync: vi.fn().mockResolvedValue(undefined),
    addListener: (_event, callback) => { expire = callback; return { remove } },
  }
  return { module, remove, expire: (identifier = 'lease-1') => expire({ identifier }) }
}

it('acquires the native lease before saving and releases it after completion', async () => {
  const { module, remove } = fixture()
  await withWorkspaceBackgroundSync(async signal => {
    expect(module.beginWorkspaceSync).toHaveBeenCalledWith('lease-1')
    expect(module.endWorkspaceSync).not.toHaveBeenCalled()
    expect(signal.aborted).toBe(false)
  }, module)
  expect(module.endWorkspaceSync).toHaveBeenCalledWith('lease-1')
  expect(remove).toHaveBeenCalledOnce()
})

it('cancels only its own lease and still balances release when the operation fails', async () => {
  const { module, expire, remove } = fixture()
  await expect(withWorkspaceBackgroundSync(async signal => {
    expire('another-lease')
    expect(signal.aborted).toBe(false)
    expire()
    expect(signal.aborted).toBe(true)
    throw new Error('interrupted')
  }, module)).rejects.toThrow('interrupted')
  expect(module.endWorkspaceSync).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledOnce()
})

it('defers when iOS denies background execution', async () => {
  const { module, remove } = fixture(false)
  const run = vi.fn()
  await withWorkspaceBackgroundSync(run, module)
  expect(run).not.toHaveBeenCalled()
  expect(module.endWorkspaceSync).not.toHaveBeenCalled()
  expect(remove).toHaveBeenCalledOnce()
})

it('removes the listener if acquisition fails', async () => {
  const { module, remove } = fixture()
  module.beginWorkspaceSync = vi.fn().mockRejectedValue(new Error('unavailable'))
  await expect(withWorkspaceBackgroundSync(vi.fn(), module)).rejects.toThrow('unavailable')
  expect(remove).toHaveBeenCalledOnce()
})

it('runs best-effort without a native execution lease on unsupported platforms', async () => {
  const run = vi.fn().mockResolvedValue(undefined)
  await withWorkspaceBackgroundSync(run, null)
  expect(run).toHaveBeenCalledOnce()
})
