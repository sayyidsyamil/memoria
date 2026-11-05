import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { startMeetingLiveSpeech, type LiveSpeechEvent } from './meetingLiveSpeech'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

let receive!: (event: { payload: LiveSpeechEvent }) => void
let receiveCall!: (payload: { sessionId: string; data?: string; error?: string }) => void
let tap!: FakeNode
let callNode!: FakeNode
const unlisten = vi.fn()
const unlistenCall = vi.fn()
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
/** The meeting-pcm tap answers its commands with a flush; the call audio node keeps what it is sent. */
class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
  posted: unknown[] = []
  port: {
    onmessage: (event: { data: Float32Array | { flushed: boolean; command?: string } }) => void
    postMessage: (message: unknown) => void
  }
  constructor(_context: unknown, name: string) {
    this.port = {
      onmessage: () => undefined,
      postMessage: message => {
        this.posted.push(message instanceof Float32Array ? Array.from(message) : message)
        if (name === 'meeting-pcm') this.port.onmessage({ data: { flushed: true, command: message as string } })
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- tests drive the live worklet instances
    if (name === 'meeting-pcm') tap = this; else callNode = this
  }
  audio(samples = 4096) { this.port.onmessage({ data: new Float32Array(samples) }) }
}
const frame = (values: number[]) => Buffer.from(new Float32Array(values).buffer).toString('base64')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeNode)
  vi.stubGlobal('MediaStream', class {})
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    if (event === 'meeting-call-audio') {
      receiveCall = payload => handler({ event, id: 1, payload })
      return unlistenCall
    }
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

it('mixes call audio into the tap, playing only this session’s frames, and reports when it starts and is heard', async () => {
  const update = vi.fn()
  const session = await startMeetingLiveSpeech(new MediaStream(), '/vault', 'session', update)
  await session.activate()
  expect(callNode.connect).toHaveBeenCalledWith(tap)
  expect(invoke).not.toHaveBeenCalledWith('start_call_audio', expect.anything())
  await session.setCallAudio(true)
  expect(invoke).toHaveBeenCalledWith('start_call_audio', { sessionId: 'session' })
  receiveCall({ sessionId: 'another', data: frame([0.9]) })
  receiveCall({ sessionId: 'session', data: frame([0, 0]) })
  expect(update).toHaveBeenCalledWith({ sessionId: 'session', callAudioStarted: true })
  expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ callAudioHeard: true }))
  receiveCall({ sessionId: 'session', data: frame([0.5, -0.25]) })
  receiveCall({ sessionId: 'session', data: frame([0.125]) })
  expect(callNode.posted).toEqual([[0, 0], [0.5, -0.25], [0.125]])
  expect(update.mock.calls.filter(([event]) => event.callAudioHeard)).toHaveLength(1)
  await session.setCallAudio(false)
  expect(invoke).toHaveBeenCalledWith('stop_call_audio', { sessionId: 'session' })
  expect(unlistenCall).toHaveBeenCalledTimes(1)
  expect(callNode.posted.at(-1)).toBe('clear')
  await session.stop()
})

it('a call audio failure becomes one notice, stops the helper and leaves the meeting running', async () => {
  const update = vi.fn()
  const session = await startMeetingLiveSpeech(new MediaStream(), '/vault', 'session', update)
  await session.activate()
  await session.setCallAudio(true)
  receiveCall({ sessionId: 'session', error: 'could not create the system audio tap' })
  receiveCall({ sessionId: 'session', error: 'the call audio helper stopped unexpectedly' })
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('stop_call_audio', { sessionId: 'session' }))
  const notices = update.mock.calls.map(([event]) => event.callAudioError).filter(Boolean)
  expect(notices).toEqual(['Call audio stopped: could not create the system audio tap. Recording continues with the microphone.'])
  expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ error: expect.anything() }))
  tap.audio()
  await expect(session.stop()).resolves.toBeUndefined()
})

it('a refused start is reported, and call audio can be turned on again', async () => {
  let refuse = true
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'start_live_speech') receive({ payload: { sessionId: 'session', stage: 'Live captions ready' } })
    if (command === 'end_live_speech') receive({ payload: { sessionId: 'session', done: true } })
    if (command === 'start_call_audio' && refuse) { refuse = false; throw 'the call audio helper could not start (No such file or directory).' }
  })
  const update = vi.fn()
  const session = await startMeetingLiveSpeech(new MediaStream(), '/vault', 'session', update)
  await session.activate()
  await session.setCallAudio(true)
  expect(update).toHaveBeenCalledWith({ sessionId: 'session', callAudioError: 'Call audio stopped: the call audio helper could not start (No such file or directory). Recording continues with the microphone.' })
  expect(unlistenCall).toHaveBeenCalledTimes(1)
  await session.setCallAudio(true)
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'start_call_audio')).toHaveLength(2)
  receiveCall({ sessionId: 'session', data: frame([0.25]) })
  expect(callNode.posted.at(-1)).toEqual([0.25])
  await session.stop()
})

it('ending the meeting stops call audio before the audio graph closes', async () => {
  const session = await startMeetingLiveSpeech(new MediaStream(), '/vault', 'session', vi.fn())
  await session.activate()
  await session.setCallAudio(true)
  await session.stop()
  expect(invoke).toHaveBeenCalledWith('stop_call_audio', { sessionId: 'session' })
  expect(unlistenCall).toHaveBeenCalledTimes(1)
  expect(callNode.disconnect).toHaveBeenCalled()
  await session.setCallAudio(true)
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'start_call_audio')).toHaveLength(1)
})
