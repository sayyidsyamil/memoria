import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORIA_START_MEETING_EVENT } from '../utils/memoriaWorkflow'
import { LiveTranscribePanel } from './LiveTranscribePanel'

const invokeMock = vi.fn()
const channels: { onmessage?: (event: unknown) => void }[] = []

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {
    onmessage?: (event: unknown) => void
    constructor() { channels.push(this) }
  },
}))

const FINAL = {
  type: 'final',
  sessionId: 'sess1',
  duration: 12,
  speakers: [{ id: 'Speaker 0', suggested: null }],
  turns: [{ t0: 0, t1: 4, speaker: 'Speaker 0', text: 'Hello everyone' }],
}

async function reachReview(props: { rememberVoices?: boolean | null; onRememberVoicesChange?: (v: boolean) => void }) {
  const onSave = vi.fn()
  render(<LiveTranscribePanel onSave={onSave} {...props} />)
  act(() => { window.dispatchEvent(new CustomEvent(MEMORIA_START_MEETING_EVENT)) })
  fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
  await waitFor(() => expect(channels.length).toBeGreaterThan(0))
  act(() => { channels[channels.length - 1].onmessage?.(FINAL) })
  const input = await screen.findByPlaceholderText('Speaker 0')
  fireEvent.change(input, { target: { value: 'Aisha' } })
  return { onSave }
}

async function saveNote() {
  fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save note' })).not.toBeInTheDocument())
}

describe('LiveTranscribePanel voice profiles', () => {
  beforeEach(() => { invokeMock.mockReset(); invokeMock.mockResolvedValue(undefined); channels.length = 0 })

  it('saves the note but enrols no names when the setting is unanswered', async () => {
    const { onSave } = await reachReview({ rememberVoices: null, onRememberVoicesChange: vi.fn() })
    await saveNote()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][1]).toContain('**Aisha**')
    expect(invokeMock).toHaveBeenCalledWith('enroll_voices', { sessionId: 'sess1', labels: {} })
  })

  it('enrols no names when the user declined', async () => {
    await reachReview({ rememberVoices: false, onRememberVoicesChange: vi.fn() })
    await saveNote()
    expect(invokeMock).toHaveBeenCalledWith('enroll_voices', { sessionId: 'sess1', labels: {} })
    expect(screen.queryByText(/Save voice profiles on this computer only/)).not.toBeInTheDocument()
  })

  it('enrols the named speakers only when the user opted in', async () => {
    await reachReview({ rememberVoices: true, onRememberVoicesChange: vi.fn() })
    await saveNote()
    expect(invokeMock).toHaveBeenCalledWith('enroll_voices', { sessionId: 'sess1', labels: { 'Speaker 0': 'Aisha' } })
  })

  it('forgets the session voices when the panel is closed without saving', async () => {
    await reachReview({ rememberVoices: true, onRememberVoicesChange: vi.fn() })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('discard_voice_session', { sessionId: 'sess1' }))
    expect(invokeMock).not.toHaveBeenCalledWith('enroll_voices', expect.anything())
  })

  it('asks the plain-words question the first time a speaker is named, and records the answer', async () => {
    const onChange = vi.fn()
    await reachReview({ rememberVoices: null, onRememberVoicesChange: onChange })
    expect(screen.getByText(/Save voice profiles on this computer only\? You can delete them any time\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
