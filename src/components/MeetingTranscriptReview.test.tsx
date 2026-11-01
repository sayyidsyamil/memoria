import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { MeetingTranscriptReview } from './MeetingTranscriptReview'
import { applySource } from '../lib/sourceImport'
import { webcrypto } from 'node:crypto'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))
vi.mock('../lib/sourceImport', () => ({ applySource: vi.fn(async () => 'reviewed.md') }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn(async () => undefined) }))
const draft = { segments: [{ start: 1, end: 2, speaker: 'S01', text: 'Launch Thursday' }], duration: 3, warnings: [], text: 'Launch Thursday' }
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(async () => undefined) })
})

it('keeps the machine draft separate and saves only after explicit review', async () => {
  vi.mocked(invoke).mockResolvedValue({ segments: [{ start: 1, end: 2, speaker: 'S01', text: 'Friday launch' }, { start: 2, end: 3, speaker: 'S01', text: 'I will send it' }], duration: 3, warnings: ['Check speaker labels'], text: 'raw' })
  const done = vi.fn(async () => undefined)
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test meeting" onClose={done} />)
  expect(invoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Create transcript' }))
  const editor = await screen.findByRole('textbox', { name: 'Transcript turn 1' })
  expect(applySource).not.toHaveBeenCalled()
  fireEvent.change(editor, { target: { value: 'Thursday launch' } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByRole('combobox', { name: 'Name S01' }), { target: { value: 'new' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'New name for S01' }), { target: { value: 'Maya' } })
  expect(screen.getAllByText('Maya').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByText('Save reviewed transcript'))
  expect(await screen.findByRole('region', { name: 'Review knowledge' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(done).not.toHaveBeenCalled()
  expect(vi.mocked(applySource).mock.calls[0][0].pages[0]).toContain('Maya: Thursday launch')
  expect(vi.mocked(applySource).mock.calls[0][0].pages[0]).toContain('[0:02] Maya: I will send it')
})
it('opens the existing live transcript without launching a second transcription', () => {
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test meeting" liveText="Existing live words" onClose={async () => undefined} />)
  expect(screen.getByRole('textbox', { name: 'Transcript turn 1' })).toHaveValue('Existing live words')
  expect(invoke).not.toHaveBeenCalled()
  expect(screen.getByText('Refine transcript and speakers')).toBeInTheDocument()
})
it('shows a failed save while Summary remains selected', async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const action = (args as { request?: { action: string } })?.request?.action
    if (action === 'save_meeting') throw new Error('Disk unavailable')
    return []
  })
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test" initialDraft={draft} transcriptPath="reviewed.md" initialTab="summary" onClose={async () => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save & close' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Disk unavailable')
  expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: 'Save & close' })).toBeEnabled()
})
it('reuses the completed MOSS session with speaker review and no full-recording ASR pass', () => {
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test" initialDraft={{ ...draft, segments: [{ start: 1, end: 2, speaker: 'S01', text: 'Meeting words' }] }} onClose={async () => undefined} />)
  expect(screen.getByRole('combobox', { name: 'Name S01' })).toBeInTheDocument()
  expect(screen.queryByText('Refine transcript and speakers')).not.toBeInTheDocument()
  expect(invoke).not.toHaveBeenCalled()
})
it('saves edited drafts as unreviewed and clears the reviewed link', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  const close = vi.fn(async () => undefined)
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test" transcriptPath="reviewed.md" initialDraft={{ ...draft, segments: [{ start: 1, end: 2, speaker: 'S01', text: 'Old words' }] }} onClose={close} />)
  expect(invoke).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Transcript turn 1' }), { target: { value: 'Edited words' } })
  fireEvent.click(screen.getByText('Save & close'))
  await waitFor(() => expect(close).toHaveBeenCalled())
  expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'save_meeting', record: expect.objectContaining({ status: 'needs-review', transcriptPath: null }) }) })
})
it('continues evidence publication when voice enrolment fails', async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    if ((args as { request: { action: string } }).request.action === 'save_voice_profiles') throw new Error('Voice unavailable')
    return []
  })
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test" initialDraft={draft} onClose={async () => undefined} />)
  fireEvent.click(screen.getByText('Save reviewed transcript'))
  await waitFor(() => expect(applySource).toHaveBeenCalledTimes(1))
  await screen.findByRole('region', { name: 'Review knowledge' })
  expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'save_meeting', record: expect.objectContaining({ status: 'transcript-reviewed', transcriptPath: 'reviewed.md' }) }) })
})
it('keeps Summary and Ask locked until a reviewed transcript exists, then opens the summary', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test" initialDraft={draft} onClose={async () => undefined} />)
  expect(screen.getByRole('tab', { name: 'Summary' })).toBeDisabled()
  expect(screen.getByRole('tab', { name: 'Ask' })).toBeDisabled()
  expect(screen.getByText('Draft — check before saving')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Save reviewed transcript'))
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('data-state', 'active'))
  expect(screen.getByText('Transcript reviewed')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Ask' })).toBeEnabled()
})
it('resumes saved outcomes without starting another model build', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test" transcriptPath="reviewed.md" outcomesStatus="approved" initialTab="summary" initialDraft={draft} onClose={async () => undefined} />)
  expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('data-state', 'active')
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'approved' }) }))
  expect(invoke).not.toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'compile' }) })
})
it('saves a renamed meeting title, marked moments and consistent unknown-voice labels', async () => {
  vi.mocked(invoke).mockResolvedValue({})
  const close = vi.fn(async () => undefined)
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Meeting · Sun, 1 Nov, 11:05" draggable={false}
    initialMarks={[{ at: 12.5, label: '' }]}
    initialDraft={{ segments: [{ start: 65, end: 70, speaker: 'unassigned', text: 'Hello' }, { start: 80, end: 81, speaker: 'S02', text: 'Hi there' }], duration: 90, warnings: [], text: 'x' }} onClose={close} />)
  expect(screen.getByRole('combobox', { name: 'Speaker for turn 1' })).toHaveDisplayValue('Unknown speaker')
  expect(screen.getByRole('combobox', { name: 'Speaker for turn 2' })).toHaveDisplayValue('Speaker 2')
  expect(screen.getByRole('button', { name: 'Play from 1:05' })).toBeInTheDocument()
  fireEvent.click(screen.getByText(/Marked moments · 1/))
  fireEvent.change(screen.getByRole('textbox', { name: 'Label for moment at 0:12' }), { target: { value: 'Budget question' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Meeting title' }), { target: { value: 'Pilot kickoff' } })
  fireEvent.click(screen.getByText('Save & close'))
  await waitFor(() => expect(close).toHaveBeenCalled())
  expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'save_meeting', record: expect.objectContaining({ title: 'Pilot kickoff', marks: [{ at: 12.5, label: 'Budget question' }] }) }) })
})
it('highlights the line being played and lets a marked moment be removed', () => {
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test" initialSeek={65} initialMarks={[{ at: 5, label: 'Early' }]}
    initialDraft={{ segments: [{ start: 1, end: 2, speaker: 'S01', text: 'First' }, { start: 60, end: 70, speaker: 'S02', text: 'Second' }], duration: 90, warnings: [], text: 'x' }} onClose={async () => undefined} />)
  const rows = screen.getAllByRole('article')
  expect(rows[1]).toHaveAttribute('data-active')
  expect(rows[0]).not.toHaveAttribute('data-active')
  expect(screen.getByLabelText('Elapsed time')).toHaveTextContent('1:05')
  fireEvent.click(screen.getByText(/Marked moments · 1/))
  fireEvent.click(screen.getByRole('button', { name: 'Remove moment at 0:05' }))
  expect(screen.queryByRole('region', { name: 'Marked moments' })).not.toBeInTheDocument()
})
