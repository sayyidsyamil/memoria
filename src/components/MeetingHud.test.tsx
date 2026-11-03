import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { Blob as NodeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { MeetingHud } from './MeetingHud'
import { applySource } from '../lib/sourceImport'
import { startMeetingLiveSpeech, type LiveSpeechEvent } from '../lib/meetingLiveSpeech'
import type { RecordingMetadata } from '../features/meetings/recordingService'
import type { LiveCue } from '../features/temporal/liveAssistanceService'
import { APP_STORAGE_KEYS } from '../constants/appStorage'

const close = vi.fn(async () => undefined)
// The real queue, with its update callback kept so that a test can publish cues as the queue would.
let publishCues: (cues: LiveCue[], notice: string) => void = () => undefined
vi.mock('../features/temporal/liveEvidenceQueue', async importOriginal => {
  const { LiveEvidenceQueue } = await importOriginal<typeof import('../features/temporal/liveEvidenceQueue')>()
  return { LiveEvidenceQueue: class extends LiveEvidenceQueue {
    constructor(vaultPath: string, onUpdate: (cues: LiveCue[], notice: string) => void) { super(vaultPath, onUpdate); publishCues = onUpdate }
  } }
})
vi.mock('../features/meetings/meetingService', () => ({ meetingService: {
  save: (vaultPath: string, record: unknown) => invoke('wiki_memory', { request: { action: 'save_meeting', vaultPath, record } }),
} }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (path: string) => path }))
vi.mock('@tauri-apps/api/window', () => ({ LogicalSize: class {}, getCurrentWindow: () => ({ close, center: vi.fn(async () => undefined), setSize: vi.fn(async () => undefined), startDragging: vi.fn(), onCloseRequested: vi.fn(async () => () => undefined) }) }))
vi.mock('../lib/sourceImport', () => ({ applySource: vi.fn(async (source: {originalPath?: string}) => { source.originalPath ??= '/vault/audio.webm'; return 'meeting.md' }) }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn(async () => undefined) }))
vi.mock('../lib/meetingLiveSpeech', () => ({ startMeetingLiveSpeech: vi.fn(async () => fakeSession()) }))
function fakeSession() {
  return {
    recordingStream: new MediaStream(), activate: vi.fn(async () => undefined), pause: vi.fn(async () => undefined),
    finishCapture: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), setCallAudio: vi.fn(async () => undefined),
    audioProgress: () => ({ acceptedSamples: 0, processedSamples: 0, queuedSamples: 0, refusedSamples: 0, unacknowledgedSamples: 0, sampleRate: 16000 }),
  }
}
const stopTrack = vi.fn()
let capture: FakeRecorder
let metadata: RecordingMetadata
class FakeRecorder {
  static instances: FakeRecorder[] = []
  static isTypeSupported() { return true }
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable?: (event: { data: Blob }) => void
  onstop?: () => void
  onerror?: () => void
  // eslint-disable-next-line @typescript-eslint/no-this-alias -- tests need the live recorder instance
  constructor() { capture = this; FakeRecorder.instances.push(this) }
  start() { this.state = 'recording' }
  pause() { this.state = 'paused' }
  resume() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.onstop?.() }
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.removeItem(APP_STORAGE_KEYS.liveCheck)
  localStorage.removeItem(APP_STORAGE_KEYS.callAudio)
  FakeRecorder.instances.length = 0
  window.history.replaceState({}, '', '/?meetingHud=1&vault=%2Fvault')
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('MediaStream', class { getTracks() { return [] }; getAudioTracks() { return [] } })
  vi.stubGlobal('Blob', NodeBlob)
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({
    getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [],
  })) } })
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'begin_meeting_recording') metadata = (args as { metadata: RecordingMetadata }).metadata
    if (command === 'finalize_meeting_recording') {
      const request = args as { sessionId: string; expectedChunks: number }
      return { sessionId: request.sessionId, originalPath: `/vault/.memoria-recordings/${request.sessionId}/original.webm`,
        sha256: 'a'.repeat(64), byteLength: 3, chunkCount: request.expectedChunks, metadata, warnings: [], interrupted: false }
    }
    return command === 'wiki_memory' ? null : undefined
  })
})
it('starts once in StrictMode, hides only after capture succeeds, and preserves capture while opening workspace', async () => {
  render(<StrictMode><MeetingHud /></StrictMode>)
  await screen.findByText('Recording')
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ echoCancellation: false, noiseSuppression: false }) })
  expect(invoke).toHaveBeenCalledWith('meeting_capture_ready')
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }))
  expect(capture.state).toBe('recording')
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  await screen.findByText('Paused')
  expect(capture.state).toBe('paused')
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
  await screen.findByText('Recording')
  expect(capture.state).toBe('recording')
  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('finish_meeting_hud'))
  expect(stopTrack).toHaveBeenCalled()
})
it('keeps the workspace visible when microphone permission fails', async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new Error('Permission denied'))
  render(<MeetingHud />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied')
  expect(invoke).not.toHaveBeenCalledWith('meeting_capture_ready')
  expect(invoke).toHaveBeenCalledWith('show_meeting_workspace')
})
it('does not record, hide the workspace, or run the timer while MOSS is preparing', async () => {
  let ready!: (session: Awaited<ReturnType<typeof startMeetingLiveSpeech>>) => void
  vi.mocked(startMeetingLiveSpeech).mockImplementationOnce(() => new Promise(resolve => { ready = resolve }))
  render(<MeetingHud />)
  await screen.findByText('Preparing')
  expect(FakeRecorder.instances).toHaveLength(0)
  expect(invoke).not.toHaveBeenCalledWith('meeting_capture_ready')
  expect(screen.queryByLabelText('Meeting duration')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Toggle live captions' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel preparation' })).toBeEnabled()
  await act(async () => ready(fakeSession()))
  await screen.findByText('Recording')
  expect(capture.state).toBe('recording')
})
it('preparation failure leaves recording off and workspace visible', async () => {
  vi.mocked(startMeetingLiveSpeech).mockRejectedValueOnce(new Error('MOSS failed'))
  render(<MeetingHud />)
  expect(await screen.findByRole('alert')).toHaveTextContent('MOSS failed')
  expect(FakeRecorder.instances).toHaveLength(0)
  expect(invoke).not.toHaveBeenCalledWith('meeting_capture_ready')
  expect(stopTrack).toHaveBeenCalled()
})
it('keeps captured audio and a stable publication identity when saving fails', async () => {
  vi.mocked(applySource).mockRejectedValueOnce(new Error('Disk unavailable'))
  render(<MeetingHud />)
  await screen.findByText('Recording')
  const blob = new Blob([new Uint8Array([1, 2, 3])])
  await act(async () => { capture.ondataavailable?.({ data: blob }) })
  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  await screen.findByText(/Audio could not be saved/)
  expect(close).not.toHaveBeenCalled()
  const source = vi.mocked(applySource).mock.calls[0][0]
  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  await screen.findByText('Review transcript')
  expect(vi.mocked(applySource).mock.calls[1][0]).toBe(source)
})

it('shows real preparation steps and a level meter that follows the microphone', async () => {
  let emit!: (event: { sessionId: string; stage?: string }) => void
  let level!: (value: number) => void
  let ready!: (session: Awaited<ReturnType<typeof startMeetingLiveSpeech>>) => void
  vi.mocked(startMeetingLiveSpeech).mockImplementationOnce((_stream, _vault, _id, update, _signal, onLevel) => {
    emit = update; level = onLevel!
    return new Promise(resolve => { ready = resolve })
  })
  render(<MeetingHud />)
  const steps = await screen.findByRole('list', { name: 'Preparation steps' })
  await waitFor(() => expect(within(steps).getByText('Microphone').closest('li')).toHaveAttribute('data-state', 'done'))
  expect(within(steps).getByText('Speech model').closest('li')).toHaveAttribute('data-state', 'active')
  act(() => emit({ sessionId: 'x', stage: 'Warming MOSS · not recording' }))
  expect(within(steps).getByText('Speech model').closest('li')).toHaveAttribute('data-state', 'done')
  expect(within(steps).getByText('Live captions').closest('li')).toHaveAttribute('data-state', 'active')
  await act(async () => ready(fakeSession()))
  await screen.findByText('Recording')
  expect(screen.queryByRole('list', { name: 'Preparation steps' })).not.toBeInTheDocument()
  act(() => level(1))
  const bars = document.querySelectorAll('.meeting-hud-meter span')
  expect(bars).toHaveLength(20)
  expect((bars[19] as HTMLElement).style.height).toBe('100%')
  expect((bars[0] as HTMLElement).style.height).toBe('14%')
})
it('opens the Record view with a large timer, waveform and live captions that follow speakers', async () => {
  let emit!: (event: { sessionId: string; turns?: { start: number; end: number; speaker: string; text: string }[] }) => void
  vi.mocked(startMeetingLiveSpeech).mockImplementationOnce(async (_stream, _vault, _id, update) => {
    emit = update
    return fakeSession()
  })
  render(<MeetingHud />)
  await screen.findByText('Recording')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  expect(screen.getByRole('region', { name: 'Recording' })).toBeInTheDocument()
  expect(screen.getByLabelText('Meeting duration')).toHaveTextContent('00:00')
  expect(document.querySelectorAll('.meeting-hud-wave span').length).toBeGreaterThan(40)
  act(() => emit({ sessionId: 's', turns: [{ start: 0, end: 2, speaker: 'S01', text: 'First point.' }, { start: 3, end: 5, speaker: 'unassigned', text: 'Second point.' }] }))
  const turns = document.querySelectorAll('.meeting-hud-live-turn')
  expect(turns).toHaveLength(2)
  expect(turns[1]).toHaveAttribute('data-latest')
  expect(turns[0]).not.toHaveAttribute('data-latest')
  expect(turns[1]).toHaveTextContent('Unknown speaker: Second point.')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  expect(screen.queryByRole('region', { name: 'Recording' })).not.toBeInTheDocument()
})
it('marks moments by button or the M key and saves them with the meeting', async () => {
  render(<MeetingHud />)
  await screen.findByText('Recording')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  fireEvent.click(screen.getByRole('button', { name: /Mark moment/ }))
  expect(await screen.findByText(/^Marked 00:0\d$/)).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'm' })
  fireEvent.keyDown(window, { key: 'm', metaKey: true })
  const blob = new Blob([new Uint8Array([1, 2, 3])])
  await act(async () => { capture.ondataavailable?.({ data: blob }) })
  fireEvent.click(screen.getByRole('button', { name: 'End meeting' }))
  await screen.findByText('Review transcript')
  const save = vi.mocked(invoke).mock.calls.find(([command, args]) => command === 'wiki_memory' && (args as { request: { action: string } }).request.action === 'save_meeting')
  const record = (save![1] as { request: { record: { marks: { at: number; label: string }[]; title: string } } }).request.record
  expect(record.marks).toHaveLength(2)
  expect(record.marks.every(mark => mark.at >= 0 && mark.label === '')).toBe(true)
  expect(record.title).toMatch(/^Meeting · /)
  expect(screen.getByRole('region', { name: 'Marked moments' })).toBeInTheDocument()
})
it('keeps the timer and marks on recorded time, excluding paused time', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  try {
    render(<MeetingHud />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByText('Recording')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByLabelText('Meeting duration')).toHaveTextContent('00:05')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause' })); await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(screen.getByLabelText('Meeting duration')).toHaveTextContent('00:05')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resume' })); await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.getByLabelText('Meeting duration')).toHaveTextContent('00:08')
  } finally { vi.useRealTimers() }
})
it('says so when the microphone step is still waiting, and clears the hint once it resolves', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  try {
    let allow!: (stream: MediaStream) => void
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(() => new Promise<MediaStream>(resolve => { allow = resolve }))
    render(<MeetingHud />)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText('Recording starts when everything is ready.')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(screen.getByText('Waiting for microphone permission…')).toBeInTheDocument()
    await act(async () => { allow({ getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [] } as unknown as MediaStream) })
    expect(screen.queryByText('Waiting for microphone permission…')).not.toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it('retains and retries a failed audio checkpoint before publishing the original', async () => {
  const normal = vi.mocked(invoke).getMockImplementation()!
  let fail = true
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'save_meeting_chunk' && fail) { fail = false; throw new Error('checkpoint write failed') }
    return normal(command, args)
  })
  render(<MeetingHud />); await screen.findByText('Recording')
  await act(async () => { capture.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) }) })
  expect(await screen.findByRole('alert')).toHaveTextContent('checkpoint write failed')
  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  await screen.findByText('Review transcript')
  const checkpoints = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_meeting_chunk')
  expect(checkpoints).toHaveLength(2)
  expect(checkpoints[0][1]).toEqual(checkpoints[1][1])
  expect(invoke).toHaveBeenCalledWith('finalize_meeting_recording', expect.objectContaining({ expectedChunks: 1 }))
})

it('persists original audio before a slow transcript drain and publishes the final draft afterward', async () => {
  let finish!: () => void
  const session = fakeSession()
  session.stop.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  vi.mocked(startMeetingLiveSpeech).mockResolvedValueOnce(session)
  render(<MeetingHud />); await screen.findByText('Recording')
  await act(async () => { capture.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) }) })
  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  await screen.findByText('Finishing transcript')
  expect(applySource).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'save_meeting', record: expect.objectContaining({ sourcePath: 'meeting.md' }) }) })
  expect(invoke).not.toHaveBeenCalledWith('complete_meeting_recording', expect.anything())
  await act(async () => finish())
  await screen.findByText('Review transcript')
  expect(invoke).toHaveBeenCalledWith('complete_meeting_recording', expect.objectContaining({ sourcePath: 'meeting.md' }))
})

it('prerecorded setup never requests a microphone and waits for explicit replay start', async () => {
  window.history.replaceState({}, '', '/?meetingHud=1&vault=%2Fvault&replay=1')
  render(<MeetingHud />)
  expect(screen.getByRole('heading', { name: 'Replay a recording' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start replay' })).toBeDisabled()
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  expect(startMeetingLiveSpeech).not.toHaveBeenCalled()
})

it('says why the meeting did not start when microphone access never comes, in plain words', async () => {
  // The 30-second wait used to end preparation silently: its message was dropped as if the user had cancelled.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  try {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(() => new Promise<MediaStream>(() => undefined))
    render(<MeetingHud />)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(screen.getByRole('alert')).toHaveTextContent(/^Meeting did not start: Microphone access is taking too long\. Check for the macOS permission prompt, then start the meeting again\.$/)
    expect(invoke).toHaveBeenCalledWith('show_meeting_workspace')
  } finally { vi.useRealTimers() }
})

it('reports failures without engineering terms or a doubled "Error:"', async () => {
  vi.mocked(applySource).mockRejectedValueOnce(new Error('Disk unavailable'))
  render(<MeetingHud />)
  await screen.findByText('Recording')
  await act(async () => { capture.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) }) })
  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/^Audio could not be saved: Disk unavailable\. What was recorded is kept\. Keep this window open and press End again\.$/)
})

it('says nothing about caption audio while captions keep up, and how far behind they are when they do not', async () => {
  let emit!: (event: LiveSpeechEvent) => void
  vi.mocked(startMeetingLiveSpeech).mockImplementationOnce(async (_stream, _vault, _id, update) => { emit = update; return fakeSession() })
  render(<MeetingHud />)
  await screen.findByText('Recording')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  const progress = { acceptedSamples: 0, processedSamples: 160000, queuedSamples: 0, refusedSamples: 0, unacknowledgedSamples: 0, sampleRate: 16000 }
  act(() => emit({ sessionId: 's', audioProgress: progress }))
  expect(screen.queryByLabelText('Caption audio progress')).toBeNull()
  // Each piece of audio is processed as it arrives: saying so flickered a status line several times a second.
  act(() => emit({ sessionId: 's', progress: { phase: 'processing', receivedChunks: 4, receivedSamples: 16384, processedSamples: 12288 } }))
  expect(screen.queryByLabelText('Caption audio progress')).toBeNull()
  act(() => emit({ sessionId: 's', audioProgress: { ...progress, queuedSamples: 48000 } }))
  expect(screen.getByLabelText('Caption audio progress')).toHaveTextContent('Captions 3 s behind')
  act(() => emit({ sessionId: 's', progress: { phase: 'finalizing', receivedChunks: 9, receivedSamples: 36864, processedSamples: 36864 } }))
  expect(screen.getByLabelText('Caption audio progress')).toHaveTextContent(/^Captions 3 s behind · Finishing captions$/)
})

it('shows the words being spoken until an event replaces or clears them, and never asks with them', async () => {
  let emit!: (event: LiveSpeechEvent & { partial?: string }) => void
  vi.mocked(startMeetingLiveSpeech).mockImplementationOnce(async (_stream, _vault, _id, update) => { emit = update; return fakeSession() })
  render(<MeetingHud />)
  await screen.findByText('Recording')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  const transcript = screen.getByLabelText('Live transcript')
  act(() => emit({ sessionId: 's', partial: 'Gamma Solutions is' }))
  expect(within(transcript).getByText('Gamma Solutions is')).toHaveClass('meeting-hud-partial')
  expect(within(transcript).queryByText('Listening for speech…')).not.toBeInTheDocument()
  const turns = [{ start: 0, end: 2, speaker: 'S01', text: 'Gamma Solutions is our vendor now.' }]
  act(() => emit({ sessionId: 's', turns, transcript: turns[0].text }))
  expect(within(transcript).getByText('Gamma Solutions is our vendor now.')).toBeInTheDocument()
  expect(within(transcript).getByText('Gamma Solutions is')).toHaveClass('meeting-hud-partial')
  act(() => emit({ sessionId: 's', partial: 'and the budget' }))
  expect(within(transcript).getByText('and the budget')).toHaveClass('meeting-hud-partial')
  fireEvent.click(screen.getByRole('button', { name: 'Ask this meeting' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Meeting question' }), { target: { value: 'Who is the vendor?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('live_ask', expect.objectContaining({ question: 'Who is the vendor?', sessionText: '[00:00] Speaker 1: Gamma Solutions is our vendor now.' })))
  act(() => emit({ sessionId: 's', partial: '' }))
  expect(transcript.querySelector('.meeting-hud-partial')).toBeNull()
  expect(transcript.querySelectorAll('.meeting-hud-live-turn')).toHaveLength(1)
})

const vendorCue: LiveCue = {
  factId: 5, label: 'Vendor', attribute: 'outcome', currentValue: 'Beta Cloud', quote: 'We move to Beta Cloud.', speaker: 'Aisha',
  meeting: 'earlier', at: 39.84, reason: 'Names another vendor.', heardAt: 3,
}
const budgetCue: LiveCue = { ...vendorCue, factId: 9, label: 'Pilot budget (RM)', attribute: 'amount', currentValue: 280000, reason: 'Sets another amount.' }
const toastRegion = () => screen.queryByRole('region', { name: 'New earlier decision' })
const layouts = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'layout_meeting_hud').map(([, args]) => args)
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
async function publish(cues: LiveCue[]) { act(() => publishCues(cues, '')); await wait(0) }
async function compactWithLiveCheck() {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  render(<MeetingHud />)
  await wait(50)
  // The live check is on by default.
  expect(screen.queryByRole('checkbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  expect(screen.getByRole('checkbox', { name: 'Flag statements that contradict a decision' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  await wait(0)
}

it('keeps the live check on by default and remembers turning it off', async () => {
  const first = render(<MeetingHud />)
  await screen.findByText('Recording')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  const toggle = screen.getByRole('checkbox', { name: 'Flag statements that contradict a decision' })
  expect(toggle).toBeChecked()
  fireEvent.click(toggle)
  expect(localStorage.getItem(APP_STORAGE_KEYS.liveCheck)).toBe('off')
  first.unmount()
  render(<MeetingHud />)
  await screen.findByText('Recording')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  expect(screen.getByRole('checkbox', { name: 'Flag statements that contradict a decision' })).not.toBeChecked()
})

it('shows a new cue under the compact notch for eight seconds, growing the window while it shows', async () => {
  try {
    await compactWithLiveCheck()
    expect(layouts().at(-1)).toEqual({ width: 392, height: 68, review: false })
    await publish([vendorCue])
    expect(toastRegion()).toHaveTextContent('Vendor is Beta Cloud')
    expect(layouts().at(-1)).toEqual({ width: 392, height: 170, review: false })
    await wait(7999)
    expect(toastRegion()).toBeInTheDocument()
    await wait(1)
    expect(toastRegion()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 earlier decision to check' })).toBeInTheDocument()
    await wait(0)
    expect(layouts().at(-1)).toEqual({ width: 392, height: 68, review: false })
    await publish([vendorCue])
    expect(toastRegion()).not.toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it('holds the toast while the pointer is on it, then lets it run out the time it had left', async () => {
  try {
    await compactWithLiveCheck()
    await publish([vendorCue])
    await wait(5000)
    fireEvent.mouseEnter(toastRegion()!)
    await wait(20000)
    expect(toastRegion()).toBeInTheDocument()
    fireEvent.mouseLeave(toastRegion()!)
    await wait(2999)
    expect(toastRegion()).toBeInTheDocument()
    await wait(1)
    expect(toastRegion()).not.toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it('shows the newest of several cues, opens the cards on click, and stays quiet for cues seen expanded', async () => {
  try {
    await compactWithLiveCheck()
    await publish([vendorCue])
    await publish([budgetCue, vendorCue])
    expect(toastRegion()).toHaveTextContent('Pilot budget is RM 280,000')
    expect(within(toastRegion()!).getByText('+1 more')).toBeInTheDocument()
    fireEvent.click(within(toastRegion()!).getByText(/^Pilot budget is/))
    await wait(0)
    expect(screen.getByRole('region', { name: 'Earlier decisions to check' })).toBeInTheDocument()
    expect(layouts().at(-1)).toEqual({ width: 620, height: 620, review: false })
    await publish([{ ...vendorCue, factId: 12, label: 'Go-live date', reason: 'Names another date.' }, budgetCue, vendorCue])
    fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
    await wait(0)
    expect(toastRegion()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3 earlier decisions to check' })).toBeInTheDocument()
    expect(layouts().at(-1)).toEqual({ width: 392, height: 68, review: false })
  } finally { vi.useRealTimers() }
})

it('dismisses the toast and keeps the badge', async () => {
  try {
    await compactWithLiveCheck()
    await publish([vendorCue])
    fireEvent.click(within(toastRegion()!).getByRole('button', { name: 'Dismiss' }))
    await wait(0)
    expect(toastRegion()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 earlier decision to check' })).toBeInTheDocument()
    expect(layouts().at(-1)).toEqual({ width: 392, height: 68, review: false })
  } finally { vi.useRealTimers() }
})

const RECORDING_CALL_AUDIO = 'Recording the microphone and audio playing on this Mac'
async function meetingWithCallAudio(remembered: 'on' | 'off' | null) {
  if (remembered) localStorage.setItem(APP_STORAGE_KEYS.callAudio, remembered)
  let emit!: (event: LiveSpeechEvent) => void
  const session = fakeSession()
  vi.mocked(startMeetingLiveSpeech).mockImplementationOnce(async (_stream, _vault, _id, update) => { emit = update; return session })
  render(<MeetingHud />)
  return { session, emit: (event: Partial<LiveSpeechEvent>) => act(() => emit({ sessionId: 's', ...event })) }
}

it('keeps call audio off by default, remembers turning it on, and switches it during the meeting', async () => {
  const { session } = await meetingWithCallAudio(null)
  await screen.findByText('Recording')
  const toggle = screen.getByRole('button', { name: 'Call audio' })
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(toggle).toHaveAttribute('title', 'Also record audio playing on this Mac, such as the other side of a call')
  expect(session.setCallAudio).not.toHaveBeenCalled()
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(session.setCallAudio).toHaveBeenLastCalledWith(true)
  expect(localStorage.getItem(APP_STORAGE_KEYS.callAudio)).toBe('on')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(session.setCallAudio).toHaveBeenLastCalledWith(false)
  expect(localStorage.getItem(APP_STORAGE_KEYS.callAudio)).toBe('off')
  expect(capture.state).toBe('recording')
})

it('applies remembered call audio once recording runs, and says what is recorded only when it arrives', async () => {
  const { session, emit } = await meetingWithCallAudio('on')
  await screen.findByText('Recording')
  expect(session.setCallAudio).toHaveBeenCalledWith(true)
  expect(session.activate.mock.invocationCallOrder[0]).toBeLessThan(session.setCallAudio.mock.invocationCallOrder[0])
  expect(screen.getByRole('button', { name: 'Call audio' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  expect(screen.queryByText(RECORDING_CALL_AUDIO)).not.toBeInTheDocument()
  emit({ callAudioStarted: true })
  expect(screen.getByText(RECORDING_CALL_AUDIO)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Call audio' }))
  expect(screen.queryByText(RECORDING_CALL_AUDIO)).not.toBeInTheDocument()
})

it('turns a call audio failure into a notice and keeps recording the microphone', async () => {
  const { emit } = await meetingWithCallAudio('on')
  await screen.findByText('Recording')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
  emit({ callAudioError: 'Call audio stopped: could not create the system audio tap. Recording continues with the microphone.' })
  expect(screen.getByText('Call audio stopped: could not create the system audio tap. Recording continues with the microphone.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Call audio' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Recording' })).toHaveTextContent('Recording')
  expect(capture.state).toBe('recording')
  // The choice stays for the next meeting; turning it on again here retries.
  expect(localStorage.getItem(APP_STORAGE_KEYS.callAudio)).toBe('on')
})

it('says when macOS has not let call audio start, and when nothing has been heard from this Mac', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  try {
    const { emit } = await meetingWithCallAudio('on')
    await wait(50)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle live captions' }))
    await wait(2900)
    expect(screen.queryByText(/waiting for macOS/)).not.toBeInTheDocument()
    await wait(200)
    expect(screen.getByText(/Call audio is waiting for macOS/)).toBeInTheDocument()
    emit({ callAudioStarted: true })
    expect(screen.queryByText(/waiting for macOS/)).not.toBeInTheDocument()
    expect(screen.getByText(RECORDING_CALL_AUDIO)).toBeInTheDocument()
    await wait(20000)
    expect(screen.getByText(/Nothing heard from this Mac yet/)).toHaveTextContent('System Settings › Privacy & Security › Screen & System Audio Recording › System Audio Recording Only')
    emit({ callAudioHeard: true })
    expect(screen.queryByText(/Nothing heard/)).not.toBeInTheDocument()
    expect(screen.getByText(RECORDING_CALL_AUDIO)).toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it('describes the saved recording as including this Mac’s audio only when call audio was heard', async () => {
  const { emit } = await meetingWithCallAudio('on')
  await screen.findByText('Recording')
  emit({ callAudioStarted: true })
  emit({ callAudioHeard: true })
  await act(async () => { capture.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) }) })
  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  await screen.findByText('Review transcript')
  expect(vi.mocked(applySource).mock.calls[0][0].pages[0]).toContain('audio played on this Mac while Call audio was on')
})

it('describes a recording without heard call audio as the microphone recording', async () => {
  const { emit } = await meetingWithCallAudio('on')
  await screen.findByText('Recording')
  emit({ callAudioStarted: true })
  await act(async () => { capture.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) }) })
  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  await screen.findByText('Review transcript')
  expect(vi.mocked(applySource).mock.calls[0][0].pages[0]).toMatch(/^Original microphone recording\./)
})
