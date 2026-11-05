import { afterEach, expect, it, vi } from 'vitest'
import { createMobileAutoGit } from './mobileAutoGit'

afterEach(() => vi.useRealTimers())

it('flushes immediately after leaving the foreground instead of losing the idle timer', async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockResolvedValue(undefined)
  const auto = createMobileAutoGit(run)
  auto.update({ enabled: true, foreground: true, blocked: false })
  auto.dirty()
  auto.update({ enabled: true, foreground: false, blocked: false })
  await auto.flush()
  expect(run).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(run).toHaveBeenCalledOnce()
  auto.dispose()
})

it.each([
  { enabled: false, foreground: false, blocked: false },
  { enabled: true, foreground: false, blocked: true },
])('does not start a background operation when disabled or blocked: %j', async state => {
  const run = vi.fn()
  const auto = createMobileAutoGit(run)
  auto.update(state)
  auto.dirty()
  await auto.flush()
  expect(run).not.toHaveBeenCalled()
  auto.dispose()
})

it('joins an existing sync and cancels its transport when the background lease expires', async () => {
  let finish = () => {}
  const run = vi.fn<(signal?: AbortSignal) => Promise<void>>(() => new Promise(resolve => { finish = resolve }))
  const auto = createMobileAutoGit(run)
  auto.update({ enabled: true, foreground: true, blocked: false })
  const foreground = auto.flush()
  await Promise.resolve()
  auto.update({ enabled: true, foreground: false, blocked: true })
  const controller = new AbortController()
  const background = auto.flush(controller.signal)
  controller.abort()
  expect(run).toHaveBeenCalledOnce()
  expect(run.mock.calls[0][0]?.aborted).toBe(true)
  finish()
  await foreground
  await background
  auto.dispose()
})

it('skips an already-expired lease and a disposed scheduler', async () => {
  const run = vi.fn()
  const auto = createMobileAutoGit(run)
  auto.update({ enabled: true, foreground: false, blocked: false })
  const controller = new AbortController()
  controller.abort()
  await auto.flush(controller.signal)
  auto.dispose()
  await auto.flush()
  expect(run).not.toHaveBeenCalled()
})

it('retries deferred work on foreground return without repeatedly syncing while suspended', async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const auto = createMobileAutoGit(run, 100)
  auto.update({ enabled: true, foreground: false, blocked: false })
  await auto.flush()
  await vi.advanceTimersByTimeAsync(1000)
  expect(run).toHaveBeenCalledOnce()
  auto.update({ enabled: true, foreground: true, blocked: false })
  auto.dirty()
  await vi.advanceTimersByTimeAsync(100)
  expect(run).toHaveBeenCalledTimes(2)
  auto.dispose()
})
