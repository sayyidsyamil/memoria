import type { default as git, HttpClient } from 'isomorphic-git'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createExpoGitFileSystem } from './expoGitFileSystem'
import { cloneGitVault } from './gitRemote'

const clone = vi.hoisted(() => vi.fn<(options: Parameters<typeof git.clone>[0]) => Promise<void>>())
vi.mock('isomorphic-git', async importOriginal => {
  const actual = await importOriginal<typeof import('isomorphic-git')>()
  return { ...actual, default: { ...actual.default, clone } }
})
beforeEach(() => { vi.useFakeTimers(); clone.mockReset(); clone.mockResolvedValue(undefined) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it.each([1, 20])('keeps progress independently budgeted after %i native reads', async (reads) => {
  const { fs, now, progress, onProgress } = await fixture()
  now.mockReturnValue(17)
  for (let index = 0; index < reads; index++) {
    const read = fs.promises.readdir('/vault')
    await vi.runAllTimersAsync()
    await read
  }
  const result = progress?.({ phase: 'Updating workdir', loaded: 20, total: 3000 })
  expect(onProgress).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)
  await vi.runAllTimersAsync()
  await result
  expect(onProgress).toHaveBeenCalledOnce()
})

it('observes cancellation while waiting for the progress task boundary', async () => {
  const controller = new AbortController()
  const { fs, now, progress, onProgress } = await fixture(controller.signal)
  now.mockReturnValue(17)
  const read = fs.promises.readdir('/vault')
  await vi.runAllTimersAsync()
  await read
  const result = Promise.resolve(progress?.({ phase: 'Updating workdir', loaded: 20, total: 3000 }))
    .then(() => null, error => error)
  controller.abort()
  await vi.runAllTimersAsync()
  expect(await result).toMatchObject({ message: 'syncDeferred' })
  expect(onProgress).not.toHaveBeenCalled()
})

async function fixture(signal?: AbortSignal) {
  const now = vi.spyOn(performance, 'now').mockReturnValue(0)
  const module = {
    File: class {
      bytes = async () => new Uint8Array()
      info = () => ({ exists: true })
      write = vi.fn()
      delete = vi.fn()
    },
    Directory: class { create = vi.fn(); delete = vi.fn() },
    Paths: { info: () => ({ exists: true, isDirectory: true }) },
  }
  const fs = createExpoGitFileSystem('file:///sandbox/Vault', module, async () => [])
  const http: HttpClient = { request: vi.fn() }
  const onProgress = vi.fn()
  await cloneGitVault({ fs, dir: '/vault', http, onProgress, signal }, 'https://github.com/team/vault')
  return { fs, now, onProgress, progress: clone.mock.calls[0][0].onProgress }
}
