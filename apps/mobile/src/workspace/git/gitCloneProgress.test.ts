import fs from 'node:fs'
import type { GitProgressEvent, HttpClient } from 'isomorphic-git'
import { beforeEach, expect, it, vi } from 'vitest'
import { cloneGitVault } from './gitRemote'

const clone = vi.hoisted(() => vi.fn())
vi.mock('isomorphic-git', async importOriginal => {
  const actual = await importOriginal<typeof import('isomorphic-git')>()
  return { ...actual, default: { ...actual.default, clone } }
})
const http: HttpClient = { request: vi.fn() }
const context = { fs, dir: '/unused-clone-fixture', http }
const progress: GitProgressEvent = { phase: 'Updating workdir', loaded: 7, total: 10 }
beforeEach(() => { clone.mockReset() })

it('forwards library progress including its phase and actual counts', async () => {
  const onProgress = vi.fn()
  clone.mockImplementation(async options => { await options.onProgress(progress) })
  await cloneGitVault({ ...context, onProgress }, 'https://github.com/team/vault')
  expect(onProgress).toHaveBeenCalledWith(progress)
})

it('does not start a clone that was cancelled while waiting for its operation queue', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(cloneGitVault({ ...context, signal: controller.signal }, 'https://github.com/team/vault'))
    .rejects.toThrow('syncDeferred')
  expect(clone).not.toHaveBeenCalled()
})

it('stops at a progress boundary after cancellation without publishing another update', async () => {
  const controller = new AbortController()
  const onProgress = vi.fn(() => controller.abort())
  clone.mockImplementation(async options => {
    await options.onProgress(progress)
    await options.onProgress({ ...progress, loaded: 8 })
  })
  await expect(cloneGitVault({ ...context, signal: controller.signal, onProgress }, 'https://github.com/team/vault'))
    .rejects.toThrow('syncDeferred')
  expect(onProgress).toHaveBeenCalledTimes(1)
})

it('does not accept completion after the final progress callback cancelled the clone', async () => {
  const controller = new AbortController()
  clone.mockImplementation(async options => { await options.onProgress({ ...progress, loaded: 10 }) })
  await expect(cloneGitVault({ ...context, signal: controller.signal, onProgress: () => controller.abort() }, 'https://github.com/team/vault'))
    .rejects.toThrow('syncDeferred')
})
