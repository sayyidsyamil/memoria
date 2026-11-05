import { afterEach, expect, it, vi } from 'vitest'
import { measureEventLoopDelay } from './measureEventLoopDelay'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

function clock() {
  vi.useFakeTimers()
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  return (value: number) => { now = value }
}

it('reports responsive ticks without inventing stalls', async () => {
  const setTime = clock()
  const measured = await measureEventLoopDelay(async () => {
    for (const time of [16, 32, 48]) {
      setTime(time)
      vi.advanceTimersByTime(16)
    }
    return 'done'
  })
  expect(measured).toEqual({ result: 'done', eventLoop: {
    elapsedMs: 48, sampleCount: 3, longDelayCount: 0, maxDelayMs: 0,
  } })
  expect(vi.getTimerCount()).toBe(0)
})

it('measures late callbacks and a blocked final segment', async () => {
  const setTime = clock()
  const measured = await measureEventLoopDelay(async () => {
    setTime(116)
    vi.advanceTimersByTime(16)
    setTime(216)
  })
  expect(measured.eventLoop).toEqual({ elapsedMs: 216, sampleCount: 2, longDelayCount: 2, maxDelayMs: 100 })
})

it('does not count a short final partial frame as a stalled timer', async () => {
  const setTime = clock()
  const measured = await measureEventLoopDelay(async () => { setTime(4) })
  expect(measured.eventLoop).toEqual({ elapsedMs: 4, sampleCount: 0, longDelayCount: 0, maxDelayMs: 0 })
})

it('stops sampling when the operation fails', async () => {
  clock()
  await expect(measureEventLoopDelay(async () => { throw new Error('failed') })).rejects.toThrow('failed')
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps aggregate measurements while attributing samples to named phases', async () => {
  const setTime = clock()
  const measured = await measureEventLoopDelay(async enter => {
    enter('checkpoint')
    setTime(116)
    vi.advanceTimersByTime(16)
    setTime(120)
    enter('fetch')
    setTime(136)
    vi.advanceTimersByTime(16)
    setTime(140)
    return 'done'
  })
  expect(measured.eventLoop).toEqual({ elapsedMs: 140, sampleCount: 2, longDelayCount: 1, maxDelayMs: 100 })
  expect(measured.phases).toEqual([
    { phase: 'checkpoint', elapsedMs: 120, sampleCount: 1, longDelayCount: 1, maxDelayMs: 100 },
    { phase: 'fetch', elapsedMs: 20, sampleCount: 1, longDelayCount: 0, maxDelayMs: 0 },
  ])
  expect(measured.result).toBe('done')
  expect(vi.getTimerCount()).toBe(0)
})

it('attributes a blocked phase boundary before the next timer callback', async () => {
  const setTime = clock()
  const measured = await measureEventLoopDelay(async enter => {
    enter('checkpoint')
    setTime(116)
    enter('fetch')
    setTime(132)
    vi.advanceTimersByTime(16)
  })
  expect(measured.phases).toEqual([
    { phase: 'checkpoint', elapsedMs: 116, sampleCount: 1, longDelayCount: 1, maxDelayMs: 100 },
    { phase: 'fetch', elapsedMs: 16, sampleCount: 1, longDelayCount: 0, maxDelayMs: 0 },
  ])
  expect(measured.eventLoop.maxDelayMs).toBe(116)
})

it('retains repeated phases separately and ignores callbacks after completion', async () => {
  const setTime = clock()
  let enterLate: (phase: string) => void = () => undefined
  const measured = await measureEventLoopDelay(async enter => {
    enterLate = enter
    enter('fetch')
    setTime(16)
    vi.advanceTimersByTime(16)
    enter('fetch')
    setTime(32)
    vi.advanceTimersByTime(16)
  })
  const expected = { phase: 'fetch', elapsedMs: 16, sampleCount: 1, longDelayCount: 0, maxDelayMs: 0 }
  expect(measured.phases).toEqual([expected, expected])
  const calls = vi.mocked(performance.now).mock.calls.length
  setTime(1000)
  enterLate('late')
  expect(measured.phases).toEqual([expected, expected])
  expect(vi.mocked(performance.now).mock.calls).toHaveLength(calls)
  expect(vi.getTimerCount()).toBe(0)
})

it('closes named phases after failure without swallowing the original error', async () => {
  clock()
  let enterLate: (phase: string) => void = () => undefined
  const error = new Error('failedPhase')
  await expect(measureEventLoopDelay(async enter => {
    enterLate = enter
    enter('checkpoint')
    throw error
  })).rejects.toBe(error)
  const calls = vi.mocked(performance.now).mock.calls.length
  enterLate('late')
  expect(vi.mocked(performance.now).mock.calls).toHaveLength(calls)
  expect(vi.getTimerCount()).toBe(0)
})
