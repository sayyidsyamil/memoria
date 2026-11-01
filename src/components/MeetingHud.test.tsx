import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { Blob as NodeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { MeetingHud } from './MeetingHud'
import { applySource } from '../lib/sourceImport'
import { startMeetingLiveSpeech } from '../lib/meetingLiveSpeech'

const close = vi.fn(async () => undefined)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (path: string) => path }))
vi.mock('@tauri-apps/api/window', () => ({ LogicalSize: class {}, getCurrentWindow: () => ({ close, center: vi.fn(async () => undefined), setSize: vi.fn(async () => undefined), startDragging: vi.fn(), onCloseRequested: vi.fn(async () => () => undefined) }) }))
vi.mock('../lib/sourceImport', () => ({ applySource: vi.fn(async (source: {originalPath?: string}) => { source.originalPath = '/vault/audio.webm'; return 'meeting.md' }) }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn(async () => undefined) }))
vi.mock('../lib/meetingLiveSpeech', () => ({ startMeetingLiveSpeech: vi.fn(async () => ({activate:vi.fn(async () => undefined),pause:vi.fn(),stop:vi.fn(async () => undefined)})) }))
const stopTrack = vi.fn()
let capture: FakeRecorder
class FakeRecorder {
  static isTypeSupported() { return true }
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable?: (event: { data: Blob }) => void
  onstop?: () => void
  onerror?: () => void
  // eslint-disable-next-line @typescript-eslint/no-this-alias -- tests need the live recorder instance
  constructor() { capture = this }
  start() { this.state = 'recording' }
  pause() { this.state = 'paused' }
  resume() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.onstop?.() }
}
beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/?meetingHud=1&vault=%2Fvault')
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('Blob', NodeBlob)
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({
    getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [],
  })) } })
})
it('starts once in StrictMode, hides only after capture succeeds, and preserves capture while opening workspace', async () => {
  render(<StrictMode><MeetingHud /></StrictMode>)
  await screen.findByText('Recording')
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith('meeting_capture_ready')
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }))
  expect(capture.state).toBe('recording')
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  expect(capture.state).toBe('paused')
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
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
  expect(capture.state).toBe('inactive')
  expect(invoke).not.toHaveBeenCalledWith('meeting_capture_ready')
  expect(screen.queryByLabelText('Meeting duration')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Toggle live captions' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel preparation' })).toBeEnabled()
  await act(async () => ready({activate:vi.fn(async () => undefined),pause:vi.fn(),stop:vi.fn(async () => undefined)}))
  await screen.findByText('Recording')
  expect(capture.state).toBe('recording')
})
it('preparation failure leaves recording off and workspace visible', async () => {
  vi.mocked(startMeetingLiveSpeech).mockRejectedValueOnce(new Error('MOSS failed'))
  render(<MeetingHud />)
  expect(await screen.findByRole('alert')).toHaveTextContent('MOSS failed')
  expect(capture.state).toBe('inactive')
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
  await act(async () => ready({activate:vi.fn(async () => undefined),pause:vi.fn(),stop:vi.fn(async () => undefined)}))
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
    return { activate: vi.fn(async () => undefined), pause: vi.fn(), stop: vi.fn(async () => undefined) }
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
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(screen.getByLabelText('Meeting duration')).toHaveTextContent('00:05')
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
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
