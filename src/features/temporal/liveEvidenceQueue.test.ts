import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { checkLiveStatement } from './liveAssistanceService'
import { LiveEvidenceQueue } from './liveEvidenceQueue'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('./liveAssistanceService', () => ({ checkLiveStatement: vi.fn() }))
const quiet = { status: 'quiet' as const, cues: [], warnings: [], seconds: 0 }
const turn = (text: string, start = 0) => ({ text, start, end: start + 1, speaker: 'S01' })
beforeEach(() => { vi.clearAllMocks(); vi.mocked(checkLiveStatement).mockResolvedValue(quiet) })

it('checks the newest turn as soon as it is published, without waiting for the next one', async () => {
  const queue = new LiveEvidenceQueue('/vault', vi.fn())
  queue.setEnabled(true)
  await queue.inspect([turn('Budget is 200.')])
  expect(checkLiveStatement).toHaveBeenCalledWith('/vault', 'Budget is 200.', expect.any(String))
  expect(await queue.finish([turn('Budget is 200.')])).toMatchObject({ checkedTurns: 1, uncheckedTurns: 0 })
  expect(checkLiveStatement).toHaveBeenCalledTimes(1)
})

it('a single final turn is checked at End when live checking never reached it', async () => {
  const queue = new LiveEvidenceQueue('/vault', vi.fn())
  queue.setEnabled(true)
  expect(await queue.finish([turn('Budget is 200.')])).toMatchObject({ checkedTurns: 1, uncheckedTurns: 0 })
  expect(checkLiveStatement).toHaveBeenCalledWith('/vault', 'Budget is 200.', expect.any(String))
})

it('checks turns oldest first, one at a time', async () => {
  const queue = new LiveEvidenceQueue('/vault', vi.fn())
  queue.setEnabled(true)
  const turns = [turn('First.'), turn('Second.', 2)]
  await queue.inspect(turns); await queue.inspect(turns); await queue.inspect(turns)
  expect(vi.mocked(checkLiveStatement).mock.calls.map(call => call[1])).toEqual(['First.', 'Second.'])
})

it('finalization checks the final turn first and does not repeat acknowledged earlier turns', async () => {
  const queue = new LiveEvidenceQueue('/vault', vi.fn())
  queue.setEnabled(true)
  const turns = [turn('First.'), turn('Last.', 2)]
  await queue.inspect(turns)
  expect(await queue.finish(turns)).toMatchObject({ checkedTurns: 2, uncheckedTurns: 0 })
  await queue.finish(turns)
  expect(checkLiveStatement).toHaveBeenCalledTimes(2)
})

it('disable cancels the owned job and suppresses its late cues', async () => {
  let resolve!: (result: typeof quiet) => void
  vi.mocked(checkLiveStatement).mockImplementation(() => new Promise(done => { resolve = done }))
  const update = vi.fn()
  const queue = new LiveEvidenceQueue('/vault', update)
  queue.setEnabled(true)
  const pending = queue.inspect([turn('First.'), turn('Last.', 2)])
  const id = vi.mocked(checkLiveStatement).mock.calls[0][2]
  queue.setEnabled(false); await queue.cancel()
  expect(invoke).toHaveBeenCalledWith('cancel_wiki_memory', { jobId: id })
  resolve(quiet); await pending
  expect(update).not.toHaveBeenCalled()
})

it('failed checks remain visibly unchecked after bounded retries', async () => {
  vi.mocked(checkLiveStatement).mockRejectedValue(new Error('inference failed'))
  const queue = new LiveEvidenceQueue('/vault', vi.fn())
  queue.setEnabled(true)
  const turns = [turn('First.'), turn('Last.', 2)]
  await queue.inspect(turns); await queue.inspect(turns); await queue.inspect(turns)
  const result = await queue.finish(turns)
  expect(checkLiveStatement).toHaveBeenCalledTimes(4) // two attempts per turn, never more
  expect(result).toMatchObject({ checkedTurns: 0, uncheckedTurns: 2 })
  expect(result.warnings.join(' ')).toContain('inference failed')
})

it('a stalled final check is cancelled and reported instead of holding End indefinitely', async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(checkLiveStatement).mockImplementation(() => new Promise(() => undefined))
    const queue = new LiveEvidenceQueue('/vault', vi.fn())
    queue.setEnabled(true)
    const pending = queue.finish([turn('Last.')])
    await vi.advanceTimersByTimeAsync(30001)
    const result = await pending
    expect(result).toMatchObject({ checkedTurns: 0, uncheckedTurns: 1 })
    expect(result.warnings.join(' ')).toContain('30 seconds')
    expect(invoke).toHaveBeenCalledWith('cancel_wiki_memory', { jobId: expect.any(String) })
  } finally { vi.useRealTimers() }
})
