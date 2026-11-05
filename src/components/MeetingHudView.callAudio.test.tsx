import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MeetingHudView, type HudViewProps } from './MeetingHudView'

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ startDragging: vi.fn() }) }))

const base: HudViewProps = {
  state: 'recording', saveStage: '', seconds: 125, levels: [], prep: 0, captionsOpen: false, liveTurns: [], caption: '',
  captionError: '', marks: [], markNotice: '', error: '', onToggleCaptions: vi.fn(), onOpenWorkspace: vi.fn(),
  onPause: vi.fn(), onEnd: vi.fn(), onMark: vi.fn(),
}

it.each([false, true])('offers call audio as a pressed or released toggle (expanded: %s)', captionsOpen => {
  const onToggleCallAudio = vi.fn()
  const { rerender } = render(<MeetingHudView {...base} captionsOpen={captionsOpen} callAudio={false} onToggleCallAudio={onToggleCallAudio} />)
  const toggle = screen.getByRole('button', { name: 'Call audio' })
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(toggle).toHaveAttribute('title', 'Also record audio playing on this Mac, such as the other side of a call')
  fireEvent.click(toggle)
  expect(onToggleCallAudio).toHaveBeenLastCalledWith(true)
  rerender(<MeetingHudView {...base} captionsOpen={captionsOpen} callAudio onToggleCallAudio={onToggleCallAudio} />)
  expect(screen.getByRole('button', { name: 'Call audio' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Call audio' }))
  expect(onToggleCallAudio).toHaveBeenLastCalledWith(false)
})

it('offers no call audio toggle without a handler, as in a prerecorded test, and none while preparing', () => {
  const { rerender } = render(<MeetingHudView {...base} sourceKind="replay" />)
  expect(screen.queryByRole('button', { name: 'Call audio' })).not.toBeInTheDocument()
  rerender(<MeetingHudView {...base} state="starting" onToggleCallAudio={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Call audio' })).not.toBeInTheDocument()
})

it('cannot switch call audio while the meeting is saving', () => {
  render(<MeetingHudView {...base} state="saving" saveStage="Saving recording" callAudio onToggleCallAudio={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Call audio' })).toBeDisabled()
})

it('shows what call audio is doing and why it stopped in the record view', () => {
  render(<MeetingHudView {...base} captionsOpen callAudio onToggleCallAudio={vi.fn()} callAudioStatus="Recording the microphone and audio playing on this Mac"
    callAudioNotice="Call audio stopped: could not start capturing. Recording continues with the microphone." />)
  expect(screen.getByText('Recording the microphone and audio playing on this Mac')).toHaveAttribute('role', 'status')
  expect(screen.getByText(/^Call audio stopped/)).toHaveAttribute('role', 'status')
})
