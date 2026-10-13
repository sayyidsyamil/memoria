import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../../types'
import { requestOpenLedger } from '../../utils/memoriaWorkflow'
import { LedgerPanel } from '../LedgerPanel'
import { BRIEF, freshState, GOLIVE_EVIDENCE, makeEngine, type FakeState } from './fakeEngine'

const invokeMock = vi.fn()
const clipboard = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('../../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn() }))
vi.mock('../../utils/clipboardText', () => ({ writeClipboardText: (text: string) => clipboard(text) }))

const note = (path: string, title: string, isA: string | null = 'Transcript'): VaultEntry => ({ path, title, isA, archived: false }) as VaultEntry
const ENTRIES = [note('/vault/transcripts/steering-1.md', 'Steering 1'), note('/vault/transcripts/steering-2.md', 'Steering 2'), note('/vault/projects.md', 'Projects', 'Project')]

let state: FakeState
const onSaveNote = vi.fn()

async function openPanel(tab?: Parameters<typeof requestOpenLedger>[0]) {
  render(<LedgerPanel vaultPath="/vault" entries={ENTRIES} onSaveNote={onSaveNote} />)
  act(() => requestOpenLedger(tab))
  await screen.findByRole('tab', { name: /^Now/ })
}

const clickTab = (name: RegExp | string) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 })
const callsOf = (method: string) => state.calls.filter((c) => c.method === method)

beforeEach(() => {
  state = freshState()
  invokeMock.mockReset().mockImplementation(makeEngine(state))
  clipboard.mockReset().mockResolvedValue(undefined)
  onSaveNote.mockReset()
})
afterEach(cleanup)

describe('LedgerPanel: opening and the Now tab', () => {
  it('does not start the engine until the panel is opened', () => {
    render(<LedgerPanel vaultPath="/vault" entries={ENTRIES} onSaveNote={onSaveNote} />)
    expect(invokeMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Decisions & commitments')).toBeNull()
  })

  it('shows current values grouped by tracked item, with owner-style values readable', async () => {
    await openPanel()
    expect(await screen.findByText('Go-live date')).toBeInTheDocument()
    expect(screen.getByText('15 Dec 2026')).toBeInTheDocument()
    expect(screen.getByText('280,000')).toBeInTheDocument()
    expect(screen.getByText(/since 16 Nov 2026 · from Steering 1/)).toBeInTheDocument()
    expect(screen.getByText('changed 1 time')).toBeInTheDocument()
  })

  it('opens the requested tab from the open event', async () => {
    await openPanel({ tab: 'ask' })
    expect(await screen.findByLabelText('Your question')).toBeInTheDocument()
  })

  it('switches tabs and shows a count badge on To review', async () => {
    await openPanel()
    expect(screen.getByLabelText('1 waiting')).toBeInTheDocument()
    clickTab(/To review/)
    expect(await screen.findByText(/Memoria wants to record/)).toBeInTheDocument()
    clickTab('Setup')
    expect(await screen.findByText(/Tracked items are the things your team decides/)).toBeInTheDocument()
  })

  it('opens the evidence dialog with the verbatim quote, speaker and meeting title, and Esc closes it', async () => {
    await openPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Evidence: Go-live date Date' }))
    const dialog = await screen.findByRole('dialog', { name: /Evidence: Go-live date/ })
    expect(within(dialog).getByText(`\u201C${GOLIVE_EVIDENCE.quote}\u201D`)).toBeInTheDocument()
    expect(within(dialog).getByText('Wei Ling')).toBeInTheDocument()
    expect(within(dialog).getByText(/in Steering 1 at 2:30/)).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Evidence/ })).toBeNull())
    expect(screen.getByRole('dialog', { name: /Decisions/ })).toBeInTheDocument()
  })

  it('shows the history timeline: what each value replaced, with quotes', async () => {
    await openPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'History: Go-live date Date' }))
    const dialog = await screen.findByRole('dialog', { name: /History: Go-live date/ })
    await within(dialog).findAllByText('1 Dec 2026')
    expect(callsOf('facts.history')[0].params).toEqual({ object_id: 'golive', attribute: 'date' })
    expect(within(dialog).getByText('Current')).toBeInTheDocument()
    expect(within(dialog).getByText(/Replaced/)).toHaveTextContent('Replaced 1 Dec 2026')
    expect(within(dialog).getByText(/Go-live is the first of December/)).toBeInTheDocument()
  })
})

describe('LedgerPanel: fixing and removing', () => {
  it('requires a reason before a correction can be saved, then sends it', async () => {
    await openPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Fix: Go-live date Date' }))
    const dialog = await screen.findByRole('dialog', { name: /Fix: Go-live date/ })
    const save = within(dialog).getByRole('button', { name: 'Save correction' })
    fireEvent.change(within(dialog).getByLabelText('Correct value'), { target: { value: '2026-12-20' } })
    expect(save).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(/Why are you changing it/), { target: { value: 'Chair said 20 Dec' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(callsOf('facts.correct')).toHaveLength(1))
    expect(callsOf('facts.correct')[0].params).toEqual({ fact_id: 3, value: '2026-12-20', reason: 'Chair said 20 Dec' })
    await screen.findByText(/Saved: Go-live date/)
    expect(callsOf('facts.current').length).toBeGreaterThan(1)
  })

  it('shows a promise with no recorded status as "open"', async () => {
    state.facts.push({ fact_id: 8, object_id: 'training', attribute: 'owner', label: 'Staff training', kind: 'commitment', value: 'raj', n_changes: 0, valid_from: '2026-10-19', decided_at: '2026-10-19T09:40:00', evidence: [] })
    await openPanel()
    const card = (await screen.findByRole('heading', { name: 'Staff training' })).closest('div')!.parentElement!
    expect(within(card).getByText('Status')).toBeInTheDocument()
    expect(within(card).getByText(/^open/)).toBeInTheDocument()
  })

  it('sends numbers as numbers when fixing the budget', async () => {
    await openPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Fix: Pilot budget (RM) Amount' }))
    const dialog = await screen.findByRole('dialog', { name: /Fix: Pilot budget/ })
    fireEvent.change(within(dialog).getByLabelText('Correct value'), { target: { value: '275000' } })
    fireEvent.change(within(dialog).getByLabelText(/Why are you changing it/), { target: { value: 'Minutes were wrong' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(callsOf('facts.correct')).toHaveLength(1))
    expect(callsOf('facts.correct')[0].params).toMatchObject({ fact_id: 5, value: 275000 })
  })

  it('shows an engine error inside the dialog and keeps it open', async () => {
    await openPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Fix: Go-live date Date' }))
    const dialog = await screen.findByRole('dialog', { name: /Fix: Go-live date/ })
    fireEvent.change(within(dialog).getByLabelText('Correct value'), { target: { value: '2026-12-20' } })
    fireEvent.change(within(dialog).getByLabelText(/Why are you changing it/), { target: { value: 'Chair said so' } })
    state.failWith = 'The ledger refused this change.'
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The ledger refused this change.')
  })

  it('asks for confirmation and a reason before removing a value', async () => {
    await openPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove: Pilot budget (RM) Amount' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this value?' })
    const remove = within(dialog).getByRole('button', { name: 'Remove' })
    expect(remove).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(/Why are you removing it/), { target: { value: 'Never agreed' } })
    fireEvent.click(remove)
    await waitFor(() => expect(callsOf('facts.retract')).toHaveLength(1))
    expect(callsOf('facts.retract')[0].params).toEqual({ fact_id: 5, reason: 'Never agreed' })
  })
})

describe('LedgerPanel: review inbox', () => {
  const openReview = async () => { await openPanel({ tab: 'review' }); return screen.findByRole('region', { hidden: true }).catch(() => null) }

  it('explains the conflict in plain words with the quote', async () => {
    await openReview()
    expect(await screen.findByText(/Memoria wants to record/)).toHaveTextContent('10 Dec 2026, but 30 Nov 2026 is recorded now.')
    expect(screen.getByText('This differs from what is already recorded, so it needs your decision.')).toBeInTheDocument()
    expect(screen.getByText(/Maybe the training can slip/)).toBeInTheDocument()
    expect(screen.queryByText('confirm_conflicts')).toBeNull()
  })

  it('accepts a suggestion as it is', async () => {
    await openReview()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(callsOf('proposals.accept')).toHaveLength(1))
    expect(callsOf('proposals.accept')[0].params).toEqual({ proposal_id: 7 })
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument()
  })

  it('explains a stale suggestion in plain words, refreshes, and lets the user dismiss it', async () => {
    state.failOnce['proposals.accept'] = {
      message: '[StaleProposal] proposal 7 was made against a belief that has since changed',
      apply: () => { state.proposals[0].current_value = '2026-12-01' },
    }
    await openReview()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('This suggestion is out of date because something newer was recorded. It has been refreshed.')).toBeInTheDocument()
    expect(screen.queryByText(/StaleProposal|has since changed/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(callsOf('proposals.list').length).toBeGreaterThan(1)
    expect(callsOf('facts.current').length).toBeGreaterThan(1)
    expect(screen.getByText(/1 Dec 2026/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(callsOf('proposals.reject')).toHaveLength(1))
    expect(callsOf('proposals.reject')[0].params).toEqual({ proposal_id: 7 })
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument()
  })

  it('quietly refreshes when the suggestion was already reviewed elsewhere', async () => {
    state.failOnce['proposals.accept'] = {
      message: '[AlreadyDone] proposal 7 was already accepted',
      apply: () => { state.proposals = [] },
    }
    await openReview()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/already accepted|AlreadyDone|out of date/)).toBeNull()
  })

  it('quietly refreshes when rejecting a suggestion that was already reviewed', async () => {
    state.failOnce['proposals.reject'] = { message: '[AlreadyDone] proposal 7 was already rejected', apply: () => { state.proposals = [] } }
    await openReview()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('still shows other engine errors on the card without the technical prefix', async () => {
    state.failOnce['proposals.accept'] = { message: '[ValueError] value is not a date' }
    await openReview()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('value is not a date')
    expect(screen.queryByText(/ValueError/)).toBeNull()
  })

  it('accepts an edited value', async () => {
    await openReview()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit then accept' }))
    fireEvent.change(screen.getByLabelText('Value to record'), { target: { value: '2026-12-12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and accept' }))
    await waitFor(() => expect(callsOf('proposals.accept')).toHaveLength(1))
    expect(callsOf('proposals.accept')[0].params).toEqual({ proposal_id: 7, edits: { value: '2026-12-12' } })
  })

  it('rejects a suggestion', async () => {
    await openReview()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(callsOf('proposals.reject')).toHaveLength(1))
    expect(callsOf('proposals.reject')[0].params).toEqual({ proposal_id: 7 })
  })
})

describe('LedgerPanel: empty and error states', () => {
  it('guides a first-time user to the sample setup when nothing is tracked', async () => {
    state.registry = { objects: [], people: {} }
    state.facts = []
    await openPanel()
    expect(await screen.findByText('Nothing is tracked yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set up tracked items' }))
    expect(await screen.findByRole('button', { name: 'Load sample setup' })).toBeInTheDocument()
  })

  it('tells the user to add a meeting when items exist but no meeting does', async () => {
    state.facts = []
    state.meetings = []
    await openPanel()
    expect(await screen.findByText('No meetings added yet', { selector: 'div' })).toBeInTheDocument()
  })

  it('shows a readable error with a retry when the engine cannot start', async () => {
    state.failWith = 'Python 3.11 was not found at /opt/homebrew/bin/python3.11.'
    render(<LedgerPanel vaultPath="/vault" entries={ENTRIES} onSaveNote={onSaveNote} />)
    act(() => requestOpenLedger())
    expect(await screen.findByRole('alert')).toHaveTextContent('Python 3.11 was not found at /opt/homebrew/bin/python3.11.')
    state.failWith = null
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Go-live date')).toBeInTheDocument()
  })
})

describe('LedgerPanel: Ask', () => {
  const ask = async (question: string) => {
    await openPanel({ tab: 'ask' })
    fireEvent.change(await screen.findByLabelText('Your question'), { target: { value: question } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  }
  const route = { type: 'current' as const, object_id: 'golive', attribute: 'date', valid_at: null, tx_at: null, ok: true, reason: '' }

  it('shows the answer, its type and the evidence quote', async () => {
    state.askResult = { ok: true, route, label: 'Go-live date', seconds: 1, type: 'current', answer: '2026-12-15', evidence: [GOLIVE_EVIDENCE] }
    await ask('What is the current go-live date?')
    const answer = await screen.findByRole('region', { name: 'Answer' })
    expect(within(answer).getByText('Current value')).toBeInTheDocument()
    expect(within(answer).getByText('The Go-live date is 15 Dec 2026.')).toBeInTheDocument()
    expect(within(answer).getByText(/Migration testing slipped/)).toBeInTheDocument()
    expect(callsOf('ask')[0].params).toEqual({ question: 'What is the current go-live date?' })
  })

  it('never shows a confident answer without evidence (AC6)', async () => {
    state.askResult = { ok: true, route, label: 'Go-live date', seconds: 1, type: 'current', answer: '2026-12-15', evidence: [] }
    await ask('What is the current go-live date?')
    expect(await screen.findByText('I could not find this in your meetings.')).toBeInTheDocument()
    expect(screen.queryByText(/15 Dec 2026/)).toBeNull()
  })

  it('says it could not find an unknown question instead of guessing', async () => {
    await ask('Who won the football?')
    expect(await screen.findByText('I could not find this in your meetings.')).toBeInTheDocument()
  })

  it('answers "how many times" using the evidence of every version', async () => {
    state.askResult = { ok: true, route: { ...route, type: 'n_changes' }, label: 'Go-live date', seconds: 1, type: 'n_changes', answer: 1, evidence: [] }
    await ask('How many times did the go-live date change?')
    const answer = await screen.findByRole('region', { name: 'Answer' })
    expect(within(answer).getByText('The Go-live date changed 1 time.')).toBeInTheDocument()
    expect(within(answer).getByText(/Go-live is the first of December/)).toBeInTheDocument()
    expect(callsOf('facts.history')).toHaveLength(1)
  })

  it('answers a past-date question with that date', async () => {
    state.askResult = { ok: true, route: { ...route, type: 'as_of_valid', object_id: 'budget', attribute: 'amount', valid_at: '2026-09-20' }, label: 'Pilot budget (RM)', seconds: 1, type: 'as_of_valid', answer: 250000, evidence: [GOLIVE_EVIDENCE] }
    await ask('What was the budget on 20 September?')
    expect(await screen.findByText('On 20 Sep 2026, the Pilot budget (RM) was 250,000.')).toBeInTheDocument()
  })
})

describe('LedgerPanel: Prepare', () => {
  it('lists open commitments and recent changes', async () => {
    await openPanel({ tab: 'prepare' })
    expect(await screen.findByText('Open commitments')).toBeInTheDocument()
    expect(screen.getByText('Staff training').closest('li')).toHaveTextContent('Raj')
    expect(screen.getByText(/due 30 Nov 2026/)).toBeInTheDocument()
    expect(screen.getByText('What changed recently')).toBeInTheDocument()
  })

  it('copies the brief as markdown', async () => {
    await openPanel({ tab: 'prepare' })
    fireEvent.click(await screen.findByRole('button', { name: 'Copy as markdown' }))
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1))
    expect(clipboard.mock.calls[0][0]).toContain('- **Staff training**: Raj, due 30 Nov 2026')
    expect(await screen.findByText(/Brief copied/)).toBeInTheDocument()
  })

  it('saves the brief as a Brief-type note named with the date', async () => {
    await openPanel({ tab: 'prepare' })
    fireEvent.click(await screen.findByRole('button', { name: 'Save as note' }))
    await waitFor(() => expect(onSaveNote).toHaveBeenCalledTimes(1))
    const [title, markdown] = onSaveNote.mock.calls[0]
    expect(title).toMatch(/^Meeting brief - \d{4}-\d{2}-\d{2}$/)
    expect(markdown.startsWith('---\ntype: Brief\n---')).toBe(true)
    expect(markdown).toContain('## Open commitments')
    expect(BRIEF.meetings).toBe(1)
  })

  it('has a plain empty state before any meeting is added', async () => {
    state.meetings = []
    state.facts = []
    const original = makeEngine(state)
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) =>
      (args as { method?: string } | undefined)?.method === 'brief' ? { ...BRIEF, meetings: 0, open_commitments: [], recent_changes: [] } : original(command, args))
    await openPanel({ tab: 'prepare' })
    expect(await screen.findByText('Nothing to prepare yet')).toBeInTheDocument()
  })
})

describe('LedgerPanel: Meetings', () => {
  it('shows added meetings by note title and marks them as already added', async () => {
    await openPanel({ tab: 'meetings' })
    const added = await screen.findByRole('region', { name: 'Meetings in the ledger' })
    expect(within(added).getByText('Steering 1')).toBeInTheDocument()
    expect(within(added).getByText(/3 items recorded/)).toBeInTheDocument()
    expect(screen.getByText('Already added')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Steering 1' })).toBeNull()
  })

  it('offers only transcript notes by default, and every note when asked', async () => {
    await openPanel({ tab: 'meetings' })
    await screen.findByText('Already added')
    expect(screen.getByRole('button', { name: 'Add Steering 2' })).toBeInTheDocument()
    expect(screen.queryByText('Projects')).toBeNull()
    fireEvent.click(screen.getByLabelText('Show all notes'))
    expect(screen.getByText('Projects')).toBeInTheDocument()
  })

  it('adds a transcript note with a stable id, parsed turns and the note date, then summarises', async () => {
    await openPanel({ tab: 'meetings' })
    fireEvent.click(await screen.findByRole('button', { name: 'Add Steering 2' }))
    await waitFor(() => expect(callsOf('meetings.ingest')).toHaveLength(1))
    expect(callsOf('meetings.ingest')[0].params).toEqual({
      meeting_id: 'transcripts/steering-2.md',
      turns: [{ speaker: 'Aisha', text: 'Welcome back.', start: 5 }, { speaker: 'Raj', text: 'Training is done.', start: 40 }],
      occurred_at: expect.stringMatching(/^2026-11-30/),
    })
    expect(await screen.findByText(/Steering 2: 1 decision or promise recorded, 1 waiting for your review, 0 ignored\./)).toBeInTheDocument()
  })

  it('prevents adding the same note twice', async () => {
    await openPanel({ tab: 'meetings' })
    fireEvent.click(await screen.findByRole('button', { name: 'Add Steering 2' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add Steering 2' })).toBeNull())
    expect(screen.getAllByText('Already added')).toHaveLength(2)
    expect(callsOf('meetings.ingest')).toHaveLength(1)
  })

  it('reports a note that has no spoken lines without calling the engine', async () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) =>
      command === 'get_note_content' ? '# Plan\n\nJust notes.' : makeEngine(state)(command, args))
    await openPanel({ tab: 'meetings' })
    fireEvent.click(await screen.findByRole('button', { name: 'Add Steering 2' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('has no spoken lines');
    expect(callsOf('meetings.ingest')).toHaveLength(0)
  })

  it('explains how to get a transcript when the vault has none', async () => {
    render(<LedgerPanel vaultPath="/vault" entries={[]} onSaveNote={onSaveNote} />)
    act(() => requestOpenLedger({ tab: 'meetings' }))
    expect(await screen.findByText('No transcripts found')).toBeInTheDocument()
  })
})

describe('LedgerPanel: Setup', () => {
  it('installs the built-in sample registry in one click', async () => {
    state.registry = { objects: [], people: {} }
    await openPanel({ tab: 'setup' })
    fireEvent.click(await screen.findByRole('button', { name: 'Load sample setup' }))
    await waitFor(() => expect(callsOf('registry.set')).toHaveLength(1))
    const sent = callsOf('registry.set')[0].params as { objects: { object_id: string }[]; people: Record<string, string> }
    expect(sent.objects.map((o) => o.object_id)).toContain('golive')
    expect(sent.people).toEqual({ aisha: 'Aisha', raj: 'Raj', wei_ling: 'Wei Ling' })
    expect(await screen.findByText('Tracked items (6)')).toBeInTheDocument()
  })

  it('adds a new tracked item with a typed detail', async () => {
    await openPanel({ tab: 'setup' })
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Launch event' } })
    fireEvent.change(screen.getByLabelText('Detail 1 name'), { target: { value: 'Venue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    await waitFor(() => expect(callsOf('registry.set')).toHaveLength(1))
    expect(callsOf('registry.set')[0].params).toEqual({
      objects: [{ object_id: 'launch_event', kind: 'decision', label: 'Launch event', attributes: [{ name: 'venue', type: 'text', values: [], change_kind: 'REVISE' }] }],
      people: {},
    })
  })

  it('refuses a choice with fewer than two values and a duplicate name, without calling the engine', async () => {
    await openPanel({ tab: 'setup' })
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Mood' } })
    fireEvent.change(screen.getByLabelText('Detail 1 name'), { target: { value: 'Level' } })
    fireEvent.change(screen.getByLabelText('Detail 1 type'), { target: { value: 'enum' } })
    fireEvent.change(screen.getByLabelText('Detail 1 allowed values'), { target: { value: 'High' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('at least two allowed values')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Go-live date' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already an item called'))
    expect(callsOf('registry.set')).toHaveLength(0)
  })
})
