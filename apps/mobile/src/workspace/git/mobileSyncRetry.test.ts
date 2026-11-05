import { afterEach, expect, it, vi } from 'vitest'
import { createMobileAutoGit } from './mobileAutoGit'
import { syncFailureKind } from '../syncFailure'

afterEach(() => vi.useRealTimers())

it('backs off transient failures without a new edit and resets after success', async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockResolvedValueOnce({ retry: true }).mockResolvedValueOnce({ retry: true }).mockResolvedValue(undefined)
  const scheduler = createMobileAutoGit(run, 10)
  scheduler.update({ enabled: true, foreground: true, blocked: false })
  scheduler.dirty()
  await vi.advanceTimersByTimeAsync(10)
  expect(run).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(29_999)
  expect(run).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(run).toHaveBeenCalledTimes(2)
  scheduler.dirty()
  await vi.advanceTimersByTimeAsync(59_999)
  expect(run).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(run).toHaveBeenCalledTimes(3)
  scheduler.dirty()
  await vi.advanceTimersByTimeAsync(10)
  expect(run).toHaveBeenCalledTimes(4)
  scheduler.dispose()
})

it('pauses retries in the background or on disposal', async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockResolvedValue({ retry: true })
  const scheduler = createMobileAutoGit(run, 10)
  scheduler.update({ enabled: true, foreground: true, blocked: false })
  scheduler.dirty()
  await vi.advanceTimersByTimeAsync(10)
  scheduler.update({ enabled: true, foreground: false, blocked: false })
  await vi.advanceTimersByTimeAsync(600_000)
  expect(run).toHaveBeenCalledOnce()
  scheduler.update({ enabled: true, foreground: true, blocked: false })
  await vi.advanceTimersByTimeAsync(10)
  expect(run).toHaveBeenCalledTimes(2)
  scheduler.dispose()
  await vi.advanceTimersByTimeAsync(600_000)
  expect(run).toHaveBeenCalledTimes(2)
})

it('uses reconnection as a retry hint without waiting for the previous deadline', async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockResolvedValueOnce({ retry: true }).mockResolvedValue(undefined)
  const scheduler = createMobileAutoGit(run, 10)
  scheduler.update({ enabled: true, foreground: true, blocked: false })
  scheduler.dirty()
  await vi.advanceTimersByTimeAsync(10)
  scheduler.reconnect()
  await vi.advanceTimersByTimeAsync(10)
  expect(run).toHaveBeenCalledTimes(2)
  scheduler.dispose()
})

it('caps repeated retry delays at five minutes', async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockResolvedValue({ retry: true })
  const scheduler = createMobileAutoGit(run, 10)
  scheduler.update({ enabled: true, foreground: true, blocked: false })
  scheduler.dirty()
  await vi.advanceTimersByTimeAsync(10)
  for (const [index, delay] of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000].entries()) {
    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(run).toHaveBeenCalledTimes(index + 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(index + 2)
  }
  scheduler.dispose()
})

it.each([
  [new Error('githubNetworkFailed'), 'retry'],
  [new Error('linkedFolderUnavailable'), 'provider'],
  [Object.assign(new Error('folderOpenFailed'), { name: 'FolderOpenFailure' }), 'provider'],
  [new TypeError('Network request failed'), 'retry'],
  [Object.assign(new Error('HTTP'), { data: { statusCode: 503 } }), 'retry'],
  [Object.assign(new Error('HTTP'), { data: { statusCode: 401 } }), 'authentication'],
  [new Error('githubAuthorizationExpired'), 'authentication'],
  [new Error('mergeConflict'), 'conflict'],
  [new Error('disk full'), 'local'],
])('classifies failures without retrying credential or local corruption errors', (error, kind) => {
  expect(syncFailureKind(error)).toBe(kind)
})
