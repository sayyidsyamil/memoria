import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { MeetingTranscriptReview } from './MeetingTranscriptReview'
import { applySource } from '../lib/sourceImport'
import { webcrypto } from 'node:crypto'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }))
vi.mock('../features/meetings/meetingService', () => ({ meetingService: {
  save: (vaultPath: string, record: unknown) => invoke('wiki_memory', { request: { action: 'save_meeting', vaultPath, record } }),
  list: (vaultPath: string) => listMeetings(vaultPath),
} }))
// The vault's notes come from the backend the sidebar reads; People are its notes of type Person.
vi.mock('../lib/vaultBackend', () => ({ createVaultBackend: (vaultPath: string) => ({ files: { list: () => listVault(vaultPath) } }) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))
vi.mock('../lib/sourceImport', () => ({ applySource: vi.fn(async () => 'reviewed.md') }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn(async () => undefined) }))
const listMeetings = vi.fn()
const listVault = vi.fn()
const draft = { segments: [{ start: 1, end: 2, speaker: 'S01', text: 'Launch Thursday' }], duration: 3, warnings: [], text: 'Launch Thursday' }
beforeEach(() => {
  vi.clearAllMocks()
  listMeetings.mockReset().mockResolvedValue([])
  listVault.mockReset().mockResolvedValue([])
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
it('labels and publishes trimmed timing as an original interval rather than an aligned text start', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test"
    initialDraft={{ ...draft, segments: [{ start: 38, end: 46, speaker: 'S01', text: 'the interface', contextTrimmed: true, timingStatus: 'unresolved-context-trim', rawWindowStart: 38, rawWindowEnd: 46, rawWindowText: 'my role is the interface' }] }} onClose={async () => undefined} />)
  expect(screen.getByRole('button', { name: 'Play original interval from 0:38; text timing unresolved' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Refine transcript and speakers' })).toBeInTheDocument()
  fireEvent.click(screen.getByText('Save reviewed transcript'))
  await waitFor(() => expect(applySource).toHaveBeenCalledTimes(1))
  expect(vi.mocked(applySource).mock.calls[0][0].pages[0]).toContain('[0:38 · original interval; text timing unresolved]')
  expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'save_meeting', record: expect.objectContaining({ turns: [expect.objectContaining({ contextTrimmed: true, timingStatus: 'unresolved-context-trim' })] }) }) })
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

// Observed natively: the picker offered only "Add a name…", so a name from the previous meeting or a People note had to be retyped.
const reviewing = (props: Partial<Parameters<typeof MeetingTranscriptReview>[0]> = {}) => <MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test" initialDraft={draft} onClose={async () => undefined} {...props} />
const savedMeeting = (id: string, names: Record<string, string>) => ({ id, title: `Meeting ${id}`, status: 'transcript-reviewed', pagePath: `meetings/${id}.md`, names })
const personNote = (title: string, patch: object = {}) => ({ path: `/vault/${title}.md`, filename: `${title}.md`, title, isA: 'Person', archived: false, ...patch })
const optionsOf = (picker: HTMLElement) => Array.from(picker.querySelectorAll('option'), option => option.textContent)
const optionValue = (picker: HTMLElement, name: string) => (within(picker).getByRole('option', { name }) as HTMLOptionElement).value

it('offers names from other meetings and People notes, once each and sorted, beside the remembered voices', async () => {
  listMeetings.mockResolvedValue([
    savedMeeting('earlier', { S01: 'Alex Tan', S02: 'maya lim' }), savedMeeting('session', { S01: 'Only named in this meeting' }),
    savedMeeting('oldest', { S01: '  alex   tan ', S02: '   ' }),
  ])
  listVault.mockResolvedValue([
    personNote('Sam Ortiz'), personNote('Maya Lim'), personNote('Priya Nair', { archived: true }),
    personNote('Person', { isA: 'Type' }), personNote('Launch plan', { isA: 'Project' }), personNote('scan', { fileKind: 'binary' }),
  ])
  render(reviewing({ initialDraft: { ...draft, profiles: [{ id: 'voice-sam', name: 'sam ortiz' }] } }))
  const picker = screen.getByRole('combobox', { name: 'Name S01' })
  await waitFor(() => expect(optionsOf(picker)).toContain('Alex Tan'))
  // Remembered voices keep their own entry; each other name appears once, in the People note's spelling, in alphabetical order.
  expect(optionsOf(picker)).toEqual(['Speaker 1 · not named yet', 'sam ortiz', 'Alex Tan', 'Maya Lim', 'Add a name…'])
  expect(within(picker).getByRole('group', { name: 'Known names' })).toBeInTheDocument()
  expect(listMeetings).toHaveBeenCalledWith('/vault')
  expect(listVault).toHaveBeenCalledWith('/vault')
})

it('offers the same known names for every speaker', async () => {
  listVault.mockResolvedValue([personNote('Alex Tan')])
  render(reviewing({ initialDraft: { ...draft, segments: [...draft.segments, { start: 3, end: 4, speaker: 'S02', text: 'Agreed' }] } }))
  await waitFor(() => expect(optionsOf(screen.getByRole('combobox', { name: 'Name S02' }))).toContain('Alex Tan'))
  expect(optionsOf(screen.getByRole('combobox', { name: 'Name S01' }))).toEqual(['Speaker 1 · not named yet', 'Alex Tan', 'Add a name…'])
  expect(optionsOf(screen.getByRole('combobox', { name: 'Name S02' }))).toEqual(['Speaker 2 · not named yet', 'Alex Tan', 'Add a name…'])
})

/** Names speaker S01, saves the reviewed transcript and returns everything the review wrote. */
async function nameAndSave(assign: (picker: HTMLElement) => Promise<void> | void) {
  vi.mocked(invoke).mockReset().mockImplementation(async (_command, args) => (args as { request: { action: string } }).request.action === 'save_voice_profiles' ? { skipped: [] } : [])
  vi.mocked(applySource).mockClear()
  const view = render(reviewing())
  // Remembering voices is opt-in; both paths opt in so their voice-memory requests can be compared.
  fireEvent.click(screen.getByRole('checkbox', { name: 'Remember named voices in this workspace' }))
  await assign(screen.getByRole('combobox', { name: 'Name S01' }))
  fireEvent.click(screen.getByText('Save reviewed transcript'))
  await screen.findByRole('region', { name: 'Review knowledge' })
  // Only what the review itself writes: later knowledge-building requests carry a fresh job id.
  const writes = vi.mocked(invoke).mock.calls.filter(([, args]) => ['save_voice_profiles', 'save_meeting'].includes((args as { request: { action: string } }).request.action))
  const written = { calls: writes.map(([command, args]) => [command, args]), page: vi.mocked(applySource).mock.calls[0][0].pages[0] }
  view.unmount()
  return written
}

it('assigns a chosen known name exactly as typing it would, and the review shows it like any other name', async () => {
  listVault.mockResolvedValue([personNote('Alex Tan')])
  const typed = await nameAndSave(picker => {
    fireEvent.change(picker, { target: { value: 'new' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'New name for S01' }), { target: { value: 'Alex Tan' } })
  })
  const picked = await nameAndSave(async picker => {
    await waitFor(() => expect(optionsOf(picker)).toContain('Alex Tan'))
    fireEvent.change(picker, { target: { value: optionValue(picker, 'Alex Tan') } })
    expect(picker).toHaveDisplayValue('Alex Tan')
    expect(screen.queryByRole('textbox', { name: 'New name for S01' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Speaker for turn 1' })).toHaveDisplayValue('Alex Tan')
  })
  expect(picked.page).toContain('Alex Tan: Launch Thursday')
  // The same voice-memory request, the same saved record, the same published page.
  expect(picked).toEqual(typed)
  expect(picked.calls).toContainEqual(['wiki_memory', { request: expect.objectContaining({ action: 'save_voice_profiles', assignments: [{ speaker: 'S01', name: 'Alex Tan', profileId: '' }] }) }])
  expect(picked.calls).toContainEqual(['wiki_memory', { request: expect.objectContaining({ action: 'save_meeting', record: expect.objectContaining({ names: { S01: 'Alex Tan' }, profileIds: { S01: '' }, status: 'transcript-reviewed' }) }) }])
})

it('lets a chosen name be replaced by a typed one or cleared, and keeps a typed name that matches a known one in its field', async () => {
  listVault.mockResolvedValue([personNote('Alex Tan')])
  render(reviewing())
  const picker = screen.getByRole('combobox', { name: 'Name S01' })
  await waitFor(() => expect(optionsOf(picker)).toContain('Alex Tan'))
  fireEvent.change(picker, { target: { value: optionValue(picker, 'Alex Tan') } })
  expect(picker).toHaveDisplayValue('Alex Tan')
  fireEvent.change(picker, { target: { value: 'new' } })
  const field = screen.getByRole('textbox', { name: 'New name for S01' })
  expect(field).toHaveValue('')
  expect(screen.getByRole('combobox', { name: 'Speaker for turn 1' })).toHaveDisplayValue('Speaker 1')
  // Typing the whole of a known name must not swap the field for the picker half way through a longer name.
  fireEvent.change(field, { target: { value: 'Alex Tan' } })
  expect(screen.getByRole('textbox', { name: 'New name for S01' })).toHaveValue('Alex Tan')
  expect(picker).toHaveDisplayValue('Add a name…')
  fireEvent.change(screen.getByRole('textbox', { name: 'New name for S01' }), { target: { value: 'Alex Tanner' } })
  expect(screen.getByRole('combobox', { name: 'Speaker for turn 1' })).toHaveDisplayValue('Alex Tanner')
  fireEvent.change(picker, { target: { value: optionValue(picker, 'Alex Tan') } })
  fireEvent.change(picker, { target: { value: '' } })
  expect(picker).toHaveDisplayValue('Speaker 1 · not named yet')
  expect(screen.getByRole('combobox', { name: 'Speaker for turn 1' })).toHaveDisplayValue('Speaker 1')
})

it('prefers a remembered voice over a known name, and a known name over nothing', async () => {
  listMeetings.mockResolvedValue([savedMeeting('earlier', { S01: 'Maya' })])
  render(reviewing({ initialDraft: { ...draft, profiles: [{ id: 'voice-maya', name: 'Maya' }] } }))
  const picker = screen.getByRole('combobox', { name: 'Name S01' })
  await waitFor(() => expect(listMeetings).toHaveBeenCalled())
  await new Promise(resolve => setTimeout(resolve, 0))
  // The voice is offered once, with its voice attached, and the same name is not offered a second time.
  expect(optionsOf(picker)).toEqual(['Speaker 1 · not named yet', 'Maya', 'Add a name…'])
  fireEvent.change(picker, { target: { value: 'voice-maya' } })
  expect(picker).toHaveDisplayValue('Maya')
})

it.each([
  ['the meeting list and the vault both fail', () => { listMeetings.mockRejectedValue(new Error('Meetings unavailable')); listVault.mockRejectedValue(new Error('Vault unavailable')) }, []],
  ['the meeting service throws as soon as it is asked', () => { listMeetings.mockImplementation(() => { throw new Error('Not available') }) }, ['Maya Lim']],
  ['the vault cannot be read', () => { listMeetings.mockResolvedValue([savedMeeting('earlier', { S01: 'Alex Tan' })]); listVault.mockRejectedValue(new Error('Vault unavailable')) }, ['Alex Tan']],
  ['the vault does not answer with notes', () => { listMeetings.mockResolvedValue([savedMeeting('earlier', { S01: 'Alex Tan' })]); listVault.mockResolvedValue({ entries: [] }) }, ['Alex Tan']],
  ['the meeting list is malformed', () => { listMeetings.mockResolvedValue({ meetings: [] }) }, ['Maya Lim']],
  ['a saved record has no names', () => { listMeetings.mockResolvedValue([null, { id: 'x' }, { id: 'y', names: 'Alex' }, savedMeeting('z', { S01: 'Alex Tan' })]) }, ['Alex Tan', 'Maya Lim']],
])('only leaves out the extra names when %s, and review carries on', async (_name, arrange, offered) => {
  listVault.mockResolvedValue([personNote('Maya Lim')])
  arrange()
  render(reviewing())
  const picker = screen.getByRole('combobox', { name: 'Name S01' })
  await waitFor(() => expect(listVault).toHaveBeenCalled())
  await waitFor(() => expect(optionsOf(picker)).toEqual(['Speaker 1 · not named yet', ...offered, 'Add a name…']))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  // Naming by hand and saving are untouched.
  fireEvent.change(picker, { target: { value: 'new' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'New name for S01' }), { target: { value: 'Jordan' } })
  expect(screen.getByRole('combobox', { name: 'Speaker for turn 1' })).toHaveDisplayValue('Jordan')
  expect(screen.getByText('Save reviewed transcript')).toBeEnabled()
})

it('never waits for the names: the review is usable while they are still loading', async () => {
  listMeetings.mockReturnValue(new Promise(() => undefined))
  listVault.mockReturnValue(new Promise(() => undefined))
  render(reviewing())
  const picker = screen.getByRole('combobox', { name: 'Name S01' })
  expect(picker).toBeEnabled()
  expect(optionsOf(picker)).toEqual(['Speaker 1 · not named yet', 'Add a name…'])
  fireEvent.change(picker, { target: { value: 'new' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'New name for S01' }), { target: { value: 'Jordan' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Transcript turn 1' }), { target: { value: 'Launch on Thursday' } })
  expect(screen.getByText('Save reviewed transcript')).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('status', { name: /loading/i })).not.toBeInTheDocument()
})

it('does not look names up before there is a speaker to name, and does once the transcript is refined', async () => {
  vi.mocked(invoke).mockResolvedValue({ segments: [{ start: 1, end: 2, speaker: 'S01', text: 'Friday launch' }], duration: 3, warnings: [], text: 'raw' })
  listVault.mockResolvedValue([personNote('Alex Tan')])
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Test" liveText="Existing live words" onClose={async () => undefined} />)
  // Let anything the review started in the background run before looking: a lookup would already have been made by now.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(listMeetings).not.toHaveBeenCalled()
  expect(listVault).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Refine transcript and speakers' }))
  const picker = await screen.findByRole('combobox', { name: 'Name S01' })
  await waitFor(() => expect(optionsOf(picker)).toContain('Alex Tan'))
  expect(listMeetings).toHaveBeenCalledTimes(1)
  expect(listVault).toHaveBeenCalledTimes(1)
})

it('forgets a chosen name when the transcript is refined again', async () => {
  listVault.mockResolvedValue([personNote('Alex Tan')])
  vi.mocked(invoke).mockResolvedValue({ segments: [{ start: 1, end: 2, speaker: 'S01', text: 'Launch Thursday' }], duration: 3, warnings: [], text: 'raw' })
  render(reviewing({ initialDraft: { ...draft, segments: [{ ...draft.segments[0], contextTrimmed: true, timingStatus: 'unresolved-context-trim' as const }] } }))
  const picker = screen.getByRole('combobox', { name: 'Name S01' })
  await waitFor(() => expect(optionsOf(picker)).toContain('Alex Tan'))
  fireEvent.change(picker, { target: { value: optionValue(picker, 'Alex Tan') } })
  expect(picker).toHaveDisplayValue('Alex Tan')
  fireEvent.click(screen.getByRole('button', { name: 'Refine transcript and speakers' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Name S01' })).toHaveDisplayValue('Speaker 1 · not named yet'))
  expect(screen.queryByRole('textbox', { name: 'New name for S01' })).not.toBeInTheDocument()
})

it('remembers voices only when asked, and can forget every remembered voice', async () => {
  vi.mocked(invoke).mockReset().mockImplementation(async (_command, args) => {
    const action = (args as { request: { action: string } }).request.action
    return action === 'forget_voice_profiles' ? { forgotten: 2 } : action === 'save_voice_profiles' ? { skipped: [] } : []
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(reviewing({ initialDraft: { segments: [{ start: 1, end: 2, speaker: 'S01', text: 'Launch Thursday' }], duration: 3, warnings: [], text: '',
    profiles: [{ id: 'p1', name: 'Maya' }, { id: 'p2', name: 'Raj' }] } }))
  expect(screen.getByRole('checkbox', { name: 'Remember named voices in this workspace' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Forget remembered voices' }))
  expect(await screen.findByText(/Forgot 2 remembered voices/)).toBeInTheDocument()
  expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: { action: 'forget_voice_profiles', vaultPath: '/vault' } })
  expect(screen.queryByRole('button', { name: 'Forget remembered voices' })).not.toBeInTheDocument()
})

it('drops the draft voice embeddings once the review is saved', async () => {
  vi.mocked(invoke).mockReset().mockImplementation(async () => [])
  vi.mocked(applySource).mockClear()
  render(reviewing())
  fireEvent.click(screen.getByText('Save reviewed transcript'))
  await screen.findByRole('region', { name: 'Review knowledge' })
  expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: { action: 'drop_voice_embeddings', vaultPath: '/vault', sessionId: 'session' } })
  expect(invoke).not.toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'save_voice_profiles' }) })
})
it('states the meeting once: no status line above the title, speakers counted plainly, and folds that read as folds', () => {
  render(<MeetingTranscriptReview vaultPath="/vault" sessionId="session" originalPath="/vault/audio.webm" title="Weekly sync" created="2026-11-03T02:00:00Z"
    initialDraft={{ ...draft, segments: [{ start: 1, end: 2, speaker: 'S01', text: 'Hello' }, { start: 3, end: 4, speaker: 'S02', text: 'Hi' }, { start: 5, end: 6, speaker: 'unassigned', text: 'Sorry I am late' }] }}
    initialMarks={[{ at: 1, label: '' }]} onClose={async () => undefined} />)
  expect(screen.queryByText(/^(Meeting ended|Reviewed meeting)$/)).not.toBeInTheDocument()
  expect(screen.getByText(/· 2 speakers$/)).toBeInTheDocument()
  expect(screen.getByText('Draft — check before saving')).toBeInTheDocument()
  const marked = screen.getByText(/Marked moments · 1/).closest('summary')!
  expect(marked.querySelector('svg.review-fold-caret')).toHaveAttribute('aria-hidden', 'true')
})
it('shows a reopened meeting’s known speaker names in the picker, not as "Add a name…" beside a text field', async () => {
  listMeetings.mockResolvedValue([savedMeeting('earlier', { S01: 'Aisha', S02: 'Raj' })])
  render(reviewing({ initialDraft: { ...draft, segments: [...draft.segments, { start: 3, end: 4, speaker: 'S02', text: 'Agreed' }],
    speakerMatches: { S01: { id: '', name: 'Aisha' }, S02: { id: '', name: 'Someone new' } } } }))
  const known = screen.getByRole('combobox', { name: 'Name S01' })
  await waitFor(() => expect(known).toHaveDisplayValue('Aisha'))
  expect(screen.queryByRole('textbox', { name: 'New name for S01' })).not.toBeInTheDocument()
  // A name no other meeting or People note uses stays a typed name.
  expect(screen.getByRole('combobox', { name: 'Name S02' })).toHaveDisplayValue('Add a name…')
  expect(screen.getByRole('textbox', { name: 'New name for S02' })).toHaveValue('Someone new')
  expect(screen.getByRole('combobox', { name: 'Speaker for turn 1' })).toHaveDisplayValue('Aisha')
})
