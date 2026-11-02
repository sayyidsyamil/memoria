import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { startMeetingLiveSpeech, type LiveSpeechEvent } from './meetingLiveSpeech'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

let receive!: (event: { payload: LiveSpeechEvent }) => void
let tap!: FakeTap
const unlisten = vi.fn()
const connection = () => ({ connect: vi.fn(), disconnect: vi.fn() })
class FakeContext {
  sampleRate = 16000
  audioWorklet = { addModule: vi.fn(async () => undefined) }
  destination = {}
  suspend = vi.fn(async () => undefined)
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
  createMediaStreamSource = connection
  createMediaStreamDestination = () => ({ ...connection(), stream: new MediaStream() })
  createGain = () => ({ ...connection(), gain: { value: 0 } })
}
class FakeTap {
  connect = vi.fn()
  disconnect = vi.fn()
  port: {
    onmessage: (event: { data: Float32Array | { flushed: boolean; command?: string } }) => void
    postMessage: (command: string) => void
  } = {
    onmessage: () => undefined,
    postMessage: (command: string) => this.port.onmessage({ data: { flushed: true, command } }),
  }
  // eslint-disable-next-line @typescript-eslint/no-this-alias -- tests drive the live worklet instance
  constructor() { tap = this }
  audio(samples = 4096) { this.port.onmessage({ data: new Float32Array(samples) }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeTap)
  vi.stubGlobal('MediaStream', class {})
  vi.mocked(listen).mockImplementation(async (_event, handler) => {
    receive = event => handler({ event: 'meeting-live-speech', id: 0, payload: event.payload })
    return unlisten
  })
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'start_live_speech') receive({ payload: { sessionId: 'session', stage: 'Live captions ready' } })
    if (command === 'end_live_speech') receive({ payload: { sessionId: 'session', done: true } })
  })
})

it('End waits for every accepted PCM block, even when draining takes more than five seconds', async () => {
  vi.useFakeTimers()
  try {
    let acknowledge!: () => void
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'start_live_speech') receive({ payload: { sessionId: 'session', stage: 'Live captions ready' } })
      if (command === 'feed_live_speech') await new Promise<void>(resolve => { acknowledge = resolve })
      if (command === 'end_live_speech') receive({ payload: { sessionId: 'session', done: true } })
    })
    const session = await startMeetingLiveSpeech(new MediaStream(), '/vault', 'session', vi.fn())
    await session.activate()
    tap.audio()
    await Promise.resolve()
    const stopping = session.stop()
    await vi.advanceTimersByTimeAsync(5500)
    expect(invoke).not.toHaveBeenCalledWith('end_live_speech', expect.anything())
    acknowledge()
    await stopping
    expect(invoke).toHaveBeenCalledWith('feed_live_speech', expect.objectContaining({ index: 0 }))
    expect(unlisten).toHaveBeenCalledTimes(1)
  } finally { vi.useRealTimers() }
})

it('overload refuses new audio but still drains the already accepted sequence', async () => {
  let acknowledge!: () => void
  let first = true
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'start_live_speech') receive({ payload: { sessionId: 'session', stage: 'Live captions ready' } })
    if (command === 'feed_live_speech' && first) {
      first = false
      await new Promise<void>(resolve => { acknowledge = resolve })
    }
    if (command === 'end_live_speech') receive({ payload: { sessionId: 'session', done: true } })
  })
  const update = vi.fn()
  const session = await startMeetingLiveSpeech(new MediaStream(), '/vault', 'session', update)
  await session.activate()
  for (let index = 0; index < 120; index++) tap.audio()
  await Promise.resolve()
  acknowledge()
  await session.stop()
  const feeds = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'feed_live_speech')
  expect(feeds).toHaveLength(Math.floor(16000 * 30 / 4096))
  expect(feeds.map(([, args]) => (args as { index: number }).index)).toEqual(feeds.map((_, index) => index))
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('30 seconds') }))
})

it('a transport failure is reported rather than pretending finalization succeeded', async () => {
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'start_live_speech') receive({ payload: { sessionId: 'session', stage: 'Live captions ready' } })
    if (command === 'feed_live_speech') throw new Error('worker unavailable')
    if (command === 'end_live_speech') receive({ payload: { sessionId: 'session', done: true } })
  })
  const update = vi.fn()
  const session = await startMeetingLiveSpeech(new MediaStream(), '/vault', 'session', update)
  await session.activate()
  tap.audio()
  await expect(session.stop()).rejects.toThrow('worker unavailable')
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('worker unavailable') }))
})
