import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { TemporalMemoryPanel } from './TemporalMemoryPanel'
import type { TemporalFact, TemporalHistoryFact, TemporalOverview } from './temporalService'
import { formatDayTime } from '../../lib/format'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const MEETING_1 = '3f2a8c1e-5b7d-4e9a-8c3f-1a2b3c4d5e6f'
const MEETING_2 = '9d41b7a2-6c0e-4f58-b1d3-7e2f9a8c5b04'
const UNKNOWN_MEETING = 'c0ffee00-1d2e-4a3b-9c4d-5e6f7a8b9c0d'

const fact: TemporalFact = {
  fact_id: 2, object_id: 'launch', label: 'Launch project', attribute: 'budget', value: 100, kind: 'decision',
  evidence: [{ quote: 'We agreed on a budget of 100.', speaker: 'Maya', meeting: MEETING_1, audio_start: 65 }],
  valid_from: '2026-11-01', n_changes: 2,
}
const historicalFact: TemporalHistoryFact = {
  fact_id: 1, object_id: 'launch', label: 'Launch project', attribute: 'budget', value: 80,
  evidence: [{ quote: 'Let us start with 80.', speaker: 'Sam', meeting: MEETING_2, audio_start: 12.5 }], claim_from: '2026-10-01', claim_to: '2026-11-01',
  decided_at: '2026-10-02T10:00:00Z', retracted: null, corrects: null,
}
const currentInHistory: TemporalHistoryFact = {
  ...historicalFact, fact_id: 2, value: 100, evidence: fact.evidence, claim_from: '2026-11-01', claim_to: null, decided_at: '2026-11-01T10:00:12Z',
}
const base: TemporalOverview = {
  registry: { objects: [{ object_id: 'launch', label: 'Launch project', kind: 'decision', attributes: [{ name: 'budget', type: 'number' }] }] },
  facts: [fact],
  proposals: [{ proposal_id: 1, object_id: 'launch', label: 'Launch project', attribute: 'budget', value: 120, current_value: 100,
    quote: 'The budget should now be 120.', speaker: 'Maya', meeting: MEETING_1 }],
  check: { ok: true, problems: [] },
}
// The shapes the ledger really answers with: the value, when it was decided and the source quotes.
const citation = { quote: 'We agreed on a budget of 100.', speaker: 'Maya', meeting: MEETING_1, audio_start: 65, char_start: 0, char_end: 29, confidence: 0.9, extractor: 'workspace-qwen' }
const earlier = { quote: 'Let us start with 80.', speaker: 'Sam', meeting: MEETING_2, audio_start: 12.5, char_start: 0, char_end: 21, confidence: 1, extractor: 'workspace-qwen' }
const answers: Record<string, unknown> = {
  current: { type: 'current', answer: 100, decided_at: '2026-11-01T10:00:12Z', evidence: [citation] },
  as_of_valid: { type: 'as_of_valid', answer: 80, decided_at: '2026-10-02T10:00:12Z', evidence: [earlier] },
  as_of_tx: { type: 'as_of_tx', answer: 80, decided_at: '2026-10-02T10:00:12Z', evidence: [earlier] },
  n_changes: { type: 'n_changes', answer: 1, evidence: [earlier, citation, citation], history: [{ fact_id: 1, value: 80, evidence: [earlier] }, { fact_id: 2, value: 100, evidence: [citation] }] },
}

/** A timestamp as the app writes it in the viewer's zone, whatever zone the tests run in. */
const at = (iso: string) => formatDayTime(new Date(iso))

type Request = { vaultPath: string; method: string; params: Record<string, unknown> }
type MeetingRequest = { vaultPath: string; operation: string }
const meetingRecord = (id: string, title: string, created?: string) => ({ id, title, status: 'needs-review', pagePath: `meetings/meeting-${id}.md`, ...(created ? { created } : {}) })
let overview: TemporalOverview
let history: TemporalHistoryFact[]
let requests: Request[]
let meetingRequests: MeetingRequest[]
let respond: (request: Request) => unknown
let respondMeetings: (request: MeetingRequest) => unknown
let calls: string[]

beforeEach(() => {
  overview = structuredClone(base)
  history = [structuredClone(historicalFact), structuredClone(currentInHistory)]
  requests = []
  meetingRequests = []
  calls = []
  respondMeetings = () => [meetingRecord(MEETING_1, 'Pilot review'), meetingRecord(MEETING_2, 'Budget workshop')]
  respond = request => request.method === 'overview' ? structuredClone(overview)
    : request.method === 'facts.history' ? structuredClone(history)
      : request.method === 'query' ? answers[String(request.params.type)]
        : request.method === 'ingest_reviewed_meeting' ? { items: overview.proposals, counts: { proposed: 1 } } : { ok: true }
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    const request = (args as { request: Request & MeetingRequest }).request
    calls.push(String(command))
    if (command === 'meetings_api') {
      meetingRequests.push(request)
      return respondMeetings(request) as never
    }
    expect(command).toBe('temporal_api')
    requests.push(request)
    return respond(request) as never
  })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

async function load(meetingId?: string, onOpenMoment?: (meeting: string, at: number) => void) {
  const view = render(<TemporalMemoryPanel vaultPath="/vault" meetingId={meetingId} onOpenMoment={onOpenMoment} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
  return view
}

function input(name: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
}

function open(fold: 'Look up a past value' | 'Tracked items') {
  const toggle = screen.getByRole('button', { name: fold })
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
  return screen.getByRole('region', { name: fold })
}

const card = (name: string) => screen.getByRole('article', { name })
const suggestion = (name: string) => screen.getByRole('article', { name: `Suggestion: ${name}` })
const status = () => within(screen.getByRole('region', { name: /Decision board|Decisions from this meeting/ })).getAllByRole('status')[0]

async function lookUp(type: string, { item = 'launch', attribute = 'budget', when = '' } = {}) {
  const fold = open('Look up a past value')
  fireEvent.change(within(fold).getByRole('combobox', { name: 'Query item' }), { target: { value: item } })
  fireEvent.change(within(fold).getByRole('combobox', { name: 'Query attribute' }), { target: { value: attribute } })
  fireEvent.change(within(fold).getByRole('combobox', { name: 'Time perspective' }), { target: { value: type } })
  if (when) input('As of (ISO date or timestamp)', when)
  fireEvent.click(within(fold).getByRole('button', { name: 'Look up value' }))
  return within(fold).findByRole('status')
}

async function openHistory(name: RegExp | string) {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.findByRole('region', { name: /^History: / })
}

/** The ledger as the procurement pilot left it: three decisions, three commitments, one value corrected by the reviewer. */
function procurementLedger() {
  const quote = (text: string, speaker: string, meeting: string, audio_start: number) => [{ quote: text, speaker, meeting, audio_start }]
  overview.registry.objects = [
    { object_id: 'vendor', label: 'Vendor', kind: 'decision', attributes: [{ name: 'outcome', type: 'enum', values: ['Alpha Systems', 'Beta Cloud'] }] },
    { object_id: 'budget', label: 'Pilot budget (RM)', kind: 'decision', attributes: [{ name: 'amount', type: 'number' }] },
    { object_id: 'golive', label: 'Go-live date', kind: 'decision', attributes: [{ name: 'date', type: 'date' }] },
    { object_id: 'training', label: 'Staff training', kind: 'commitment', attributes: [{ name: 'owner', type: 'text' }, { name: 'deadline', type: 'date' }, { name: 'status', type: 'enum', values: ['done', 'cancelled'] }] },
    { object_id: 'migration', label: 'Data migration', kind: 'commitment', attributes: [{ name: 'owner', type: 'text' }, { name: 'deadline', type: 'date' }, { name: 'status', type: 'enum', values: ['done', 'cancelled'] }] },
    { object_id: 'security', label: 'Security review', kind: 'commitment', attributes: [{ name: 'owner', type: 'text' }, { name: 'deadline', type: 'date' }, { name: 'status', type: 'enum', values: ['done', 'cancelled'] }] },
  ]
  const row = (fact_id: number, object_id: string, label: string, attribute: string, value: TemporalFact['value'], kind: string, evidence: TemporalFact['evidence'], extra: Partial<TemporalFact> = {}): TemporalFact =>
    ({ fact_id, object_id, label, attribute, value, kind, evidence, valid_from: '2026-09-14T01:30:00Z', n_changes: 0, change_type: 'INITIAL', corrects: null, retracted: null, ...extra })
  const securityQuote = quote('I can do it. I will own the security review and have it done by 5 October.', 'Wei Ling', MEETING_2, 95.07)
  overview.facts = [
    row(5, 'vendor', 'Vendor', 'outcome', 'Beta Cloud', 'decision', quote('We drop Alpha Systems and move to Beta Cloud. This is final.', 'Aisha', MEETING_2, 39.84), { n_changes: 1 }),
    row(6, 'budget', 'Pilot budget (RM)', 'amount', 280000, 'decision', quote('The pilot budget has to go from 250,000 to 280,000 ringgit.', 'Raj', MEETING_2, 52.25), { n_changes: 1 }),
    row(2, 'golive', 'Go-live date', 'date', '2026-11-09', 'decision', quote('Then the go-live date is now 9 November 2026.', 'Aisha', MEETING_1, 45.69), { n_changes: 1 }),
    row(18, 'training', 'Staff training', 'owner', 'Raj', 'commitment', quote('I will coordinate it with HR myself.', 'Aisha', MEETING_2, 134.98), { change_type: 'CORRECT', corrects: 16 }),
    row(3, 'training', 'Staff training', 'deadline', '2026-11-03', 'commitment', quote('I will move training to 3 November.', 'Aisha', MEETING_1, 58.06), { n_changes: 1 }),
    row(14, 'migration', 'Data migration', 'owner', 'Wei Ling', 'commitment', quote('I will own the data migration.', 'Wei Ling', MEETING_2, 125.57)),
    row(1, 'migration', 'Data migration', 'deadline', '2026-10-23', 'commitment', quote('Data migration is now due on 23 October, same owner.', 'Aisha', MEETING_1, 21.6), { n_changes: 1 }),
    row(9, 'security', 'Security review', 'owner', 'Wei Ling', 'commitment', securityQuote),
    row(10, 'security', 'Security review', 'deadline', '2026-10-05', 'commitment', securityQuote),
    row(4, 'security', 'Security review', 'status', 'done', 'commitment', quote('Security review is done.', 'Aisha', MEETING_1, 69.54), { change_type: 'COMPLETE' }),
  ]
  overview.proposals = []
  history = [
    { ...historicalFact, fact_id: 16, object_id: 'training', attribute: 'owner', label: 'Staff training', value: 'Aisha', claim_from: '2026-09-14T01:32:14Z', claim_to: null, decided_at: '2026-09-14T01:32:14Z',
      evidence: quote('I will coordinate it with HR myself.', 'Aisha', MEETING_2, 134.98), retracted: { tx: 1, by: 'user', reason: 'corrected: The chair said Raj will do the staff training from now on.' } },
    { ...historicalFact, fact_id: 18, object_id: 'training', attribute: 'owner', label: 'Staff training', value: 'Raj', claim_from: '2026-09-14T01:32:14Z', claim_to: null, decided_at: '2026-09-14T01:32:14Z',
      evidence: quote('I will coordinate it with HR myself.', 'Aisha', MEETING_2, 134.98), corrects: 16, change_type: 'CORRECT',
      correction: { reviewer: 'user', reason: 'The chair said Raj will do the staff training from now on.', replaced_fact_id: 16 } },
  ]
}

describe('the decision board', () => {
  it('loads values with their quotes and ledger check problems without performing writes', async () => {
    overview.check = { ok: false, problems: ['Overlapping valid intervals'] }
    await load()
    const current = card('Launch project')
    expect(within(current).getByRole('heading', { level: 4 })).toHaveTextContent('Launch project')
    expect(within(current).getByText('We agreed on a budget of 100.')).toBeInTheDocument()
    expect(await within(current).findByText('Pilot review')).toBeInTheDocument()
    expect(current.querySelector('.board-cite')).toHaveTextContent('Maya · Pilot review · 1:05')
    expect(current).not.toHaveTextContent(MEETING_1)
    // Not even on hover: ids stay inside the ledger.
    expect(current.querySelector(`[title*="${MEETING_1}"], [title*="ID"]`)).toBeNull()
    expect(within(current).getByRole('button', { name: 'Changed 2×: history of Launch project' })).toHaveTextContent('changed 2×')
    expect(screen.getByRole('alert')).toHaveTextContent('Overlapping valid intervals')
    expect(requests).toEqual([{ vaultPath: '/vault', method: 'overview', params: {} }])
    expect(meetingRequests).toEqual([{ vaultPath: '/vault', operation: 'list' }])
    // The ledger is requested first; the titles only label its citations.
    expect(calls).toEqual(['temporal_api', 'meetings_api'])
  })

  it('reads as one board: suggestions first, then decisions, then commitments, with the tools folded at the bottom', async () => {
    procurementLedger()
    overview.proposals = [{ ...base.proposals[0], object_id: 'golive', label: 'Go-live date', attribute: 'date', value: '2026-11-16', current_value: '2026-11-09' }]
    await load()
    const board = screen.getByRole('region', { name: 'Decision board' })
    expect(within(board).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Needs review (1)', 'Decisions 3', 'Commitments 3', 'Look up a past value', 'Tracked items'])
    expect(within(screen.getByRole('region', { name: /^Decisions/ })).getAllByRole('article').map(item => item.getAttribute('aria-label'))).toEqual(['Vendor', 'Pilot budget', 'Go-live date'])
    // Folded by default: the setup form is not even reachable until asked for.
    expect(screen.getByRole('button', { name: 'Tracked items' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Object ID' })).not.toBeInTheDocument()
    open('Tracked items')
    expect(screen.getByRole('textbox', { name: 'Object ID' })).toBeVisible()
  })

  it('writes values for people: money with its unit, one date style, and no internal ids', async () => {
    procurementLedger()
    await load()
    expect(card('Pilot budget').querySelector('.board-value')).toHaveTextContent('RM 280,000')
    expect(card('Go-live date').querySelector('.board-value time')).toHaveAttribute('dateTime', '2026-11-09')
    expect(card('Go-live date').querySelector('.board-value')).toHaveTextContent('9 Nov 2026')
    expect(card('Security review').querySelectorAll('.board-value')[2]).toHaveTextContent('Done')
    for (const section of screen.getAllByRole('region', { name: /^(Decisions|Commitments) / })) {
      expect(section).not.toHaveTextContent(/#\d|fact_id|Corrects fact|Item ID|280000|2026-\d\d-\d\d|Pilot budget \(RM\)|[0-9a-f]{8}-[0-9a-f]{4}/)
    }
  })

  it('shows a commitment as one card: owner, due date and status, flagged against today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 2, 12))
    procurementLedger()
    await load()
    const commitments = within(screen.getByRole('region', { name: /^Commitments/ })).getAllByRole('article')
    expect(commitments.map(item => item.getAttribute('aria-label'))).toEqual(['Data migration', 'Staff training', 'Security review'])
    const migration = card('Data migration')
    expect(Array.from(migration.querySelectorAll('.board-row-label'), label => label.textContent)).toEqual(['Owner', 'Due'])
    expect(migration).toHaveAttribute('data-tone', 'overdue')
    expect(within(migration).getByText('Overdue')).toBeInTheDocument()
    expect(within(card('Staff training')).getByText('Due tomorrow')).toBeInTheDocument()
    const security = card('Security review')
    expect(security).toHaveAttribute('data-tone', 'done')
    expect(within(security).getByText('Done', { selector: '.mui-chip' })).toBeInTheDocument()
    // Owner and due date were set by one sentence: it is quoted once, under the last of them.
    expect(within(security).getAllByText('I can do it. I will own the security review and have it done by 5 October.')).toHaveLength(1)
  })

  it('proves a corrected value with the reason, and keeps the replaced quote for its history', async () => {
    procurementLedger()
    await load()
    const training = card('Staff training')
    expect(await within(training).findByText('The chair said Raj will do the staff training from now on.')).toBeInTheDocument()
    expect(training.querySelector('.board-corrected')).toHaveTextContent('Corrected by you: The chair said Raj will do the staff training from now on.')
    expect(training).not.toHaveTextContent('I will coordinate it with HR myself.')
    // The overview names the replaced fact only; its history holds the reason.
    expect(requests.filter(request => request.method === 'facts.history').map(request => request.params)).toEqual([{ object_id: 'training', attribute: 'owner' }])
    const opened = await openHistory('History: history of Staff training owner')
    const [now, replaced] = within(opened).getAllByRole('listitem')
    expect(now).toHaveTextContent('Raj')
    expect(now).toHaveTextContent('Corrected by you: The chair said Raj will do the staff training from now on.')
    expect(now).not.toHaveTextContent('decided')
    expect(replaced).toHaveTextContent('Aisha')
    expect(replaced).toHaveTextContent(`Replaced by a correction · decided ${at('2026-09-14T01:32:14Z')}`)
    expect(within(replaced).getByText('I will coordinate it with HR myself.')).toBeInTheDocument()
    expect(within(replaced).queryByRole('button', { name: /Correct/ })).not.toBeInTheDocument()
  })

  it('opens the meeting at the moment a quote was said', async () => {
    const openMoment = vi.fn()
    await load(undefined, openMoment)
    fireEvent.click(await within(card('Launch project')).findByRole('button', { name: 'Play Pilot review from 1:05' }))
    expect(openMoment).toHaveBeenCalledWith(MEETING_1, 65)
  })

  it.each([
    [0, null], [1, 'changed 1×'], [2, 'changed 2×'], [11, 'changed 11×'],
  ])('offers the history of a value that changed %i times as %j', async (count, text) => {
    overview.facts[0] = { ...fact, n_changes: count }
    await load()
    const button = within(card('Launch project')).queryByRole('button', { name: /history of/ })
    if (text === null) expect(button).not.toBeInTheDocument()
    else expect(button).toHaveTextContent(text)
  })

  it('says so when nothing is approved yet', async () => {
    overview.facts = []
    overview.proposals = []
    await load()
    expect(screen.getByRole('heading', { name: 'No decisions yet' })).toBeInTheDocument()
    expect(screen.getByText(/Find decisions and commitments/)).toBeInTheDocument()
  })
})

describe('suggestions that need review', () => {
  it.each([
    ['Accept', 'proposals.accept', 'Suggestion accepted.'],
    ['Reject', 'proposals.reject', 'Suggestion rejected.'],
  ])('explicitly performs %s and refreshes the list', async (button, method, message) => {
    await load()
    const original = respond
    respond = request => {
      if (request.method === method) { overview.proposals = []; return { ok: true } }
      return original(request)
    }
    fireEvent.click(within(suggestion('Launch project')).getByRole('button', { name: button }))
    await screen.findByText(message)
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Suggestion: Launch project' })).not.toBeInTheDocument())
    expect(requests.find(request => request.method === method)).toEqual({ vaultPath: '/vault', method, params: { proposal_id: 1 } })
  })

  it('shows the quote, who said it and the value it would replace', async () => {
    await load()
    const item = suggestion('Launch project')
    expect(item.querySelector('.board-value')).toHaveTextContent('120now 100')
    expect(within(item).getByText('The budget should now be 120.')).toBeInTheDocument()
    expect(await within(item).findByText('Pilot review')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Needs review (1)' })).toBeInTheDocument()
  })

  it('accepts an edited value in the form the ledger stores', async () => {
    await load()
    fireEvent.click(within(suggestion('Launch project')).getByRole('button', { name: 'Edit' }))
    const value = screen.getByRole('textbox', { name: 'Value' })
    expect(value).toHaveValue('120')
    expect(value).toHaveFocus()
    input('Value', 'RM 1,250')
    fireEvent.click(screen.getByRole('button', { name: 'Save and accept' }))
    await screen.findByText('Suggestion accepted with your edit.')
    expect(requests.find(request => request.method === 'proposals.accept')?.params).toEqual({ proposal_id: 1, edits: { value: 1250 } })
  })

  it('holds back an edit the ledger could not store, and cancels without a write', async () => {
    await load()
    fireEvent.click(within(suggestion('Launch project')).getByRole('button', { name: 'Edit' }))
    input('Value', 'about a hundred')
    fireEvent.click(screen.getByRole('button', { name: 'Save and accept' }))
    expect(await within(suggestion('Launch project')).findByRole('alert')).toHaveTextContent('Enter a number, for example 280,000.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(within(suggestion('Launch project')).getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(requests.some(request => request.method === 'proposals.accept')).toBe(false)
  })

  it('lists suggestions in the order the meetings were held', async () => {
    respondMeetings = () => [meetingRecord(MEETING_1, 'Kick-off', '2026-09-14T01:30:00Z'), meetingRecord(MEETING_2, 'Progress check', '2026-09-28T01:30:00Z')]
    overview.proposals = [
      { ...base.proposals[0], proposal_id: 1, quote: 'Budget is 100.', meeting: MEETING_1 },
      { ...base.proposals[0], proposal_id: 2, quote: 'Budget is now 120.', meeting: MEETING_2 },
      { ...base.proposals[0], proposal_id: 3, quote: 'Owner is Sam.', meeting: MEETING_1 },
    ]
    await load()
    await waitFor(() => expect(Array.from(document.querySelectorAll('.board-proposal .board-quote'), quote => quote.textContent))
      .toEqual(['Budget is 100.', 'Owner is Sam.', 'Budget is now 120.']))
  })

  it('explains a suggestion that went out of date in plain words', async () => {
    await load()
    const original = respond
    respond = request => { if (request.method === 'proposals.accept') throw { message: 'proposal 1 was made against a belief that has since changed' }; return original(request) }
    fireEvent.click(within(suggestion('Launch project')).getByRole('button', { name: 'Accept' }))
    const alert = await within(suggestion('Launch project')).findByRole('alert')
    expect(alert).toHaveTextContent('This suggestion is out of date')
    expect(alert).not.toHaveTextContent(/proposal 1|belief/)
  })

  it('guards duplicate actions and disables other actions while a write is pending', async () => {
    await load()
    let finish!: (result: unknown) => void
    const original = respond
    respond = request => request.method === 'proposals.accept' ? new Promise(resolve => { finish = resolve }) : original(request)
    const accept = within(suggestion('Launch project')).getByRole('button', { name: 'Accept' })
    fireEvent.click(accept)
    fireEvent.click(accept)
    expect(within(suggestion('Launch project')).getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(status()).toHaveTextContent('Accepting suggestion…')
    expect(requests.filter(request => request.method === 'proposals.accept')).toHaveLength(1)
    await act(async () => finish({ ok: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
  })
})

describe('corrections and history', () => {
  it('shows history in place and requires a reason before sending a typed numeric correction', async () => {
    await load()
    const opened = await openHistory('Changed 2×: history of Launch project')
    expect(within(card('Launch project')).getByRole('button', { name: /history of Launch project/ })).toHaveAttribute('aria-expanded', 'true')
    const [now, previous] = within(opened).getAllByRole('listitem')
    expect(now).toHaveTextContent(`100Now · decided ${at('2026-11-01T10:00:12Z')}`)
    expect(previous).toHaveTextContent(`80Earlier · decided ${at('2026-10-02T10:00:00Z')} · until 1 Nov 2026`)
    expect(within(previous).getByText('Let us start with 80.')).toBeInTheDocument()
    expect(opened).not.toHaveTextContent(/undefined|NaN|2026-1\d-\d\d|launch\b/)
    expect(requests.find(request => request.method === 'facts.history')?.params).toEqual({ object_id: 'launch', attribute: 'budget' })
    fireEvent.click(within(previous).getByRole('button', { name: 'Correct this earlier value of Launch project' }))
    const save = screen.getByRole('button', { name: 'Save correction' })
    input('Corrected value', '95')
    expect(save).toBeDisabled()
    input('Reason (required)', '  Corrected transcript figure  ')
    fireEvent.click(save)
    await screen.findByText('Correction saved.')
    expect(requests.find(request => request.method === 'facts.correct')?.params).toEqual({ fact_id: 1, value: 95, reason: 'Corrected transcript figure' })
  })

  it('corrects the current value from its row, starting in the value field', async () => {
    await load()
    fireEvent.click(within(card('Launch project')).getByRole('button', { name: 'Correct Launch project' }))
    const form = screen.getByRole('region', { name: 'Correct fact' })
    expect(form).toHaveTextContent('Correct Launch project. Recorded value: 100.')
    expect(screen.getByRole('textbox', { name: 'Corrected value' })).toHaveFocus()
    input('Corrected value', '110')
    input('Reason (required)', 'Misheard figure')
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
    await screen.findByText('Correction saved.')
    expect(requests.find(request => request.method === 'facts.correct')?.params).toEqual({ fact_id: 2, value: 110, reason: 'Misheard figure' })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Correct fact' })).not.toBeInTheDocument())
  })

  it('rejects invalid numeric corrections in place and retains the reason for retry', async () => {
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Correct Launch project' }))
    input('Corrected value', 'not a number')
    input('Reason (required)', 'Transcript correction')
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
    expect(await within(screen.getByRole('region', { name: 'Correct fact' })).findByRole('alert')).toHaveTextContent('Enter a number, for example 280,000.')
    expect(requests.some(request => request.method === 'facts.correct')).toBe(false)
    expect(screen.getByRole('textbox', { name: 'Reason (required)' })).toHaveValue('Transcript correction')
  })

  it.each([
    ['date', '2026-02-30', 'Enter a valid date'],
  ])('validates %s corrections against the tracked definition', async (type, value, error) => {
    overview.registry.objects[0].attributes = [{ name: 'budget', type: type as 'date' }]
    overview.facts[0] = { ...fact, value: '2026-12-01' }
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Correct Launch project' }))
    input('Corrected value', value)
    input('Reason (required)', 'Fix incorrect value')
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(error)
    expect(requests.some(request => request.method === 'facts.correct')).toBe(false)
  })

  it('offers only the allowed values when correcting a value from a list, and still refuses one outside it', async () => {
    overview.registry.objects[0].attributes = [{ name: 'budget', type: 'enum', values: ['planned', 'active'] }]
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Correct Launch project' }))
    const choice = screen.getByRole('combobox', { name: 'Corrected value' })
    // The recorded value stays selected even though the list no longer allows it.
    expect(within(choice).getAllByRole('option').map(option => option.textContent)).toEqual(['planned', 'active', '100'])
    input('Reason (required)', 'Fix incorrect value')
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose one of: planned, active')
    fireEvent.change(choice, { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
    await screen.findByText('Correction saved.')
    expect(requests.find(request => request.method === 'facts.correct')?.params).toEqual({ fact_id: 2, value: 'active', reason: 'Fix incorrect value' })
  })

  it('retracts only with a nonblank reason, and cancels without a write', async () => {
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Correct Launch project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retract instead' }))
    expect(screen.getByRole('region', { name: 'Retract fact' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Corrected value' })).not.toBeInTheDocument()
    input('Reason (required)', '   ')
    expect(screen.getByRole('button', { name: 'Confirm retraction' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(requests.some(request => request.method === 'facts.retract')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Correct Launch project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retract instead' }))
    input('Reason (required)', 'Unsupported by the reviewed recording')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm retraction' }))
    await screen.findByText('Value retracted.')
    expect(requests.find(request => request.method === 'facts.retract')?.params).toEqual({ fact_id: 2, reason: 'Unsupported by the reviewed recording' })
  })

  it('names a retraction and its reason in the history, and offers no edits of withdrawn values', async () => {
    history = [{ ...historicalFact, retracted: { by: 'user', reason: 'Never agreed' } }, structuredClone(currentInHistory)]
    await load()
    const opened = await openHistory(/history of Launch project/)
    const previous = within(opened).getAllByRole('listitem')[1]
    expect(previous).toHaveTextContent('Retracted')
    expect(previous).toHaveTextContent('Reason: Never agreed')
    expect(within(previous).queryByRole('button')).not.toBeInTheDocument()
    fireEvent.click(within(opened).getByRole('button', { name: 'Close history' }))
    expect(screen.queryByRole('region', { name: /^History: / })).not.toBeInTheDocument()
  })

  it('shows meeting titles in the history of a value', async () => {
    await load()
    const opened = await openHistory(/history of Launch project/)
    expect(await within(opened).findByText('Budget workshop')).toBeInTheDocument()
    expect(opened).not.toHaveTextContent(MEETING_2)
  })
})

describe('looking up a past value', () => {
  it.each([
    ['current', {}, '', 'Current', '100', ['We agreed on a budget of 100.'], ['Maya · Pilot review · 1:05']],
    ['as_of_valid', { valid_at: '2026-10-15' }, '2026-10-15', 'Valid at 15 Oct 2026', '80', ['Let us start with 80.'], ['Sam · Budget workshop · 0:12']],
    ['as_of_tx', { tx_at: '2026-10-15' }, '2026-10-15', 'Value valid now, as known on 15 Oct 2026', '80', ['Let us start with 80.'], ['Sam · Budget workshop · 0:12']],
    ['n_changes', {}, '', 'Number of changes', 'Changed once', ['Let us start with 80.', 'We agreed on a budget of 100.'], ['Sam · Budget workshop · 0:12', 'Maya · Pilot review · 1:05']],
  ])('queries %s only after explicit submission and shows a readable answer', async (type, time, when, heading, answer, quotes, captions) => {
    await load()
    const fold = open('Look up a past value')
    fireEvent.change(within(fold).getByRole('combobox', { name: 'Query item' }), { target: { value: 'launch' } })
    fireEvent.change(within(fold).getByRole('combobox', { name: 'Query attribute' }), { target: { value: 'budget' } })
    fireEvent.change(within(fold).getByRole('combobox', { name: 'Time perspective' }), { target: { value: type } })
    if (type.startsWith('as_of')) {
      expect(within(fold).getByRole('button', { name: 'Look up value' })).toBeDisabled()
      input('As of (ISO date or timestamp)', when)
    }
    expect(requests.some(request => request.method === 'query')).toBe(false)
    fireEvent.click(within(fold).getByRole('button', { name: 'Look up value' }))
    const result = await within(fold).findByRole('status')
    expect(within(result).getByRole('heading')).toHaveTextContent(`Launch project — Budget · ${heading}`)
    if (when) expect(within(result).getByRole('heading').querySelector('time')).toHaveAttribute('datetime', when)
    expect(result.querySelector('.temporal-value')?.textContent).toBe(answer)
    for (const quote of quotes) expect(within(result).getAllByText(quote)).toHaveLength(1)
    await waitFor(() => expect(Array.from(result.querySelectorAll('.board-cite'), caption => caption.textContent)).toEqual(captions))
    // Readable, not the ledger's raw answer: no JSON, no extraction internals, no ids.
    expect(result.querySelector('pre')).toBeNull()
    expect(result).not.toHaveTextContent(/"answer"|[{}[\]]|char_start|confidence|extractor|history|[0-9a-f]{8}-[0-9a-f]{4}|Item ID/)
    expect(requests.find(request => request.method === 'query')?.params).toEqual({ type, object_id: 'launch', attribute: 'budget', ...time })
  })

  it('reports a failed lookup next to the form', async () => {
    const original = respond
    respond = request => { if (request.method === 'query') throw { message: 'Unknown temporal query type.' }; return original(request) }
    await load()
    const fold = open('Look up a past value')
    fireEvent.change(within(fold).getByRole('combobox', { name: 'Query item' }), { target: { value: 'launch' } })
    fireEvent.change(within(fold).getByRole('combobox', { name: 'Query attribute' }), { target: { value: 'budget' } })
    fireEvent.click(within(fold).getByRole('button', { name: 'Look up value' }))
    expect(await within(fold).findByRole('alert')).toHaveTextContent('Unknown temporal query type.')
  })

  it('shows when a looked-up value was decided, in the viewer’s own time', async () => {
    await load()
    const result = await lookUp('current')
    expect(within(result).getByText(/^Decided/)).toHaveTextContent(`Decided ${at('2026-11-01T10:00:12Z')}`)
    expect(within(result).getByText(/^Decided/).querySelector('time')).toHaveAttribute('datetime', '2026-11-01T10:00:12Z')
  })

  it.each([[0, 'No changes recorded'], [1, 'Changed once'], [2, 'Changed twice'], [3, 'Changed 3 times']])('answers a lookup of %i changes with a sentence', async (count, sentence) => {
    const original = respond
    respond = request => request.method === 'query' ? { type: 'n_changes', answer: count, evidence: [], history: [] } : original(request)
    await load()
    const result = await lookUp('n_changes')
    expect(result.querySelector('.temporal-value')?.textContent).toBe(sentence)
    expect(result.querySelector('.board-evidence')).toBeNull()
  })

  it('says so when the ledger held no value for the lookup', async () => {
    const original = respond
    respond = request => request.method === 'query' ? { type: 'as_of_valid', answer: null, evidence: [] } : original(request)
    await load()
    const result = await lookUp('as_of_valid', { when: '2026-01-01' })
    expect(result.querySelector('.temporal-value')?.textContent).toBe('No value recorded')
    expect(result.querySelector('.board-evidence')).toBeNull()
    expect(result.querySelector('pre')).toBeNull()
  })

  it('writes a typed lookup timestamp as a readable date and time while keeping its exact value', async () => {
    await load()
    const heading = within(await lookUp('as_of_valid', { when: '2026-10-15T10:00:00Z' })).getByRole('heading')
    expect(heading).toHaveTextContent(`Launch project — Budget · Valid at ${at('2026-10-15T10:00:00Z')}`)
    expect(heading.querySelector('time')).toHaveAttribute('datetime', '2026-10-15T10:00:00Z')
  })

  it('shows a lookup date it cannot read as typed, without a time element', async () => {
    await load()
    const heading = within(await lookUp('as_of_valid', { when: 'last autumn' })).getByRole('heading')
    expect(heading).toHaveTextContent('Launch project — Budget · Valid at last autumn')
    expect(heading.querySelector('time')).toBeNull()
  })

  it('keeps an unfamiliar result shape inspectable instead of crashing', async () => {
    const original = respond
    respond = request => request.method === 'query' ? { surprise: ['a', 1], nested: { ok: true } } : original(request)
    await load()
    const result = await lookUp('current')
    expect(result.querySelector('pre')).toHaveTextContent('"surprise"')
    expect(result.querySelector('pre')).toHaveTextContent('"nested"')
    expect(result.querySelector('.board-evidence')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a bare lookup value as the value', async () => {
    const original = respond
    respond = request => request.method === 'query' ? 'Beta' : original(request)
    await load()
    const result = await lookUp('current')
    expect(result.querySelector('.temporal-value')?.textContent).toBe('Beta')
    expect(result.querySelector('pre')).toBeNull()
  })

  // Observed natively: "History: pilot — supplier" and "pilot — supplier · Number of changes" named the item by its id.
  it('names the item by its label in the history and lookup, whatever its id looks like', async () => {
    overview.registry.objects = [{ object_id: 'pilot', label: 'Pilot', kind: 'decision', attributes: [{ name: 'supplier', type: 'text' }] }]
    overview.facts = [{ ...fact, object_id: 'pilot', label: 'Pilot', attribute: 'supplier', value: 'Beta' }]
    overview.proposals = []
    history = [{ ...currentInHistory, object_id: 'pilot', attribute: 'supplier', value: 'Beta' }]
    await load()
    const opened = await openHistory(/history of Pilot/)
    expect(opened).toHaveAccessibleName('History: Pilot')
    expect(opened).not.toHaveTextContent(/pilot/)
    fireEvent.click(within(opened).getByRole('button', { name: 'Close history' }))
    const result = await lookUp('n_changes', { item: 'pilot', attribute: 'supplier' })
    expect(within(result).getByRole('heading')).toHaveTextContent('Pilot — Supplier · Number of changes')
    expect(within(result).getByRole('heading').textContent).not.toMatch(/pilot —/)
  })
})

describe('dates and values', () => {
  it.each(['Pacific/Pago_Pago', 'America/Los_Angeles'])('keeps date-only values on their own day for a viewer in %s', async zone => {
    const original = process.env.TZ
    process.env.TZ = zone
    try {
      expect(new Date(2026, 9, 10).getTimezoneOffset()).toBeGreaterThan(0)
      overview.registry.objects[0].attributes = [{ name: 'go_live', type: 'date' }]
      overview.facts[0] = { ...fact, attribute: 'go_live', value: '2026-12-01' }
      await load()
      expect(card('Launch project').querySelector('.board-value time')).toHaveTextContent('1 Dec 2026')
      const heading = within(await lookUp('as_of_valid', { attribute: 'go_live', when: '2026-10-15' })).getByRole('heading')
      expect(heading.querySelector('time')).toHaveTextContent('15 Oct 2026')
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })

  it('shows a date attribute value it cannot read as recorded', async () => {
    overview.registry.objects[0].attributes = [{ name: 'go_live', type: 'date' }]
    overview.facts[0] = { ...fact, attribute: 'go_live', value: 'sometime in autumn' }
    await load()
    expect(card('Launch project').querySelector('.board-value')).toHaveTextContent('sometime in autumn')
    expect(card('Launch project').querySelector('.board-value time')).toBeNull()
  })

  it('shows date attributes as readable dates everywhere a value appears, and edits them as typed', async () => {
    overview.registry.objects[0].attributes = [{ name: 'go_live', type: 'date' }]
    overview.facts[0] = { ...fact, attribute: 'go_live', value: '2026-12-01' }
    overview.proposals[0] = { ...base.proposals[0], attribute: 'go_live', current_value: '2026-12-01', value: '2026-12-15' }
    const original = respond
    respond = request => request.method === 'query' ? { type: 'current', answer: '2026-12-15', evidence: [] } : original(request)
    await load()
    const value = card('Launch project').querySelector('.board-value')
    expect(value?.querySelector('time')).toHaveAttribute('datetime', '2026-12-01')
    expect(value?.textContent).toBe('1 Dec 2026')
    const proposed = suggestion('Launch project').querySelector('.board-value')
    expect(Array.from(proposed?.querySelectorAll('time') ?? [], item => item.textContent)).toEqual(['15 Dec 2026', '1 Dec 2026'])

    const result = await lookUp('current', { attribute: 'go_live' })
    expect(result.querySelector('.temporal-value')?.textContent).toBe('15 Dec 2026')
    expect(result.querySelector('.temporal-value time')).toHaveAttribute('datetime', '2026-12-15')

    fireEvent.click(within(card('Launch project')).getByRole('button', { name: 'Correct Launch project' }))
    expect(screen.getByRole('region', { name: 'Correct fact' })).toHaveTextContent('Recorded value: 1 Dec 2026.')
    // Editing stays in the format the ledger validates.
    expect(screen.getByRole('textbox', { name: 'Corrected value' })).toHaveValue('2026-12-01')
  })

  it('shows a date-looking value of a text attribute exactly as recorded', async () => {
    overview.facts[0] = { ...fact, attribute: 'budget', value: '2026-12-01' }
    overview.registry.objects[0].attributes = [{ name: 'budget', type: 'text' }]
    await load()
    const value = card('Launch project').querySelector('.board-value')
    expect(value?.textContent).toBe('2026-12-01')
    expect(value?.querySelector('time')).toBeNull()
  })
})

describe('meeting titles', () => {
  it('shows meeting titles instead of ids in suggestions and falls back to a short labelled id for an unknown meeting', async () => {
    overview.proposals.push({ ...base.proposals[0], proposal_id: 2, meeting: UNKNOWN_MEETING, quote: 'Maybe 150.' })
    overview.proposals.push({ ...base.proposals[0], proposal_id: 3, meeting: null, quote: 'Source not linked.' })
    await load()
    const [known, unknown, unlinked] = screen.getAllByRole('article', { name: 'Suggestion: Launch project' })
    await waitFor(() => expect(known.querySelector('.board-cite')).toHaveTextContent('Maya · Pilot review'))
    expect(unknown.querySelector('.board-cite')).toHaveTextContent('Maya · Meeting c0ff…')
    expect(unlinked.querySelector('.board-cite')).toHaveTextContent('Maya · Meeting not recorded')
    for (const item of [known, unknown, unlinked]) expect(item).not.toHaveTextContent(/[0-9a-f]{8}-[0-9a-f]{4}/)
  })

  it.each([
    ['the service reports an error', () => { throw { code: 'RUNTIME_UNAVAILABLE', message: 'The meeting runtime is unavailable.' } }],
    ['the list is malformed', () => ({ meetings: [] })],
    ['the list holds an invalid record', () => [{ id: MEETING_1 }]],
  ])('keeps working with short labelled ids when %s', async (_name, answer) => {
    respondMeetings = answer
    await load()
    const item = card('Launch project')
    await waitFor(() => expect(meetingRequests).toHaveLength(1))
    await act(async () => { await Promise.resolve() })
    expect(item.querySelector('.board-cite')).toHaveTextContent('Maya · Meeting 3f2a… · 1:05')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(item).getByRole('button', { name: /history of Launch project/ })).toBeEnabled()
    expect(within(suggestion('Launch project')).getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  it('does not wait for meeting titles before showing the ledger', async () => {
    respondMeetings = () => new Promise(() => undefined)
    await load()
    expect(card('Launch project').querySelector('.board-cite')).toHaveTextContent('Maya · Meeting 3f2a… · 1:05')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })

  it('looks meeting titles up again when the ledger is refreshed', async () => {
    await load()
    const item = card('Launch project')
    expect(await within(item).findByText('Pilot review')).toBeInTheDocument()
    respondMeetings = () => [meetingRecord(MEETING_1, 'Pilot review, renamed')]
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await within(card('Launch project')).findByText('Pilot review, renamed')).toBeInTheDocument()
    expect(meetingRequests).toEqual([{ vaultPath: '/vault', operation: 'list' }, { vaultPath: '/vault', operation: 'list' }])
  })
})

describe('a meeting’s own decisions', () => {
  it('takes a reviewed meeting in only on request and never accepts its suggestions', async () => {
    overview.proposals.push({ ...base.proposals[0], proposal_id: 2, meeting: MEETING_2, quote: 'Unrelated meeting evidence' })
    await load(MEETING_1)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Decisions from this meeting')
    expect(screen.queryByText('Unrelated meeting evidence')).not.toBeInTheDocument()
    const item = suggestion('Launch project')
    expect(await within(item).findByText('Pilot review')).toBeInTheDocument()
    expect(item).not.toHaveTextContent(MEETING_1)
    expect(screen.queryByRole('button', { name: 'Tracked items' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Look up a past value' })).not.toBeInTheDocument()
    expect(requests.every(request => request.method === 'overview')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Find decisions and commitments' }))
    await screen.findByText('1 suggestion to review.')
    await waitFor(() => expect(within(suggestion('Launch project')).getByRole('button', { name: 'Accept' })).toBeEnabled())
    expect(requests.find(request => request.method === 'ingest_reviewed_meeting')?.params).toEqual({ meetingId: MEETING_1 })
    expect(requests.some(request => request.method === 'proposals.accept')).toBe(false)
  })

  it('plays only its own quotes', async () => {
    const seek = vi.fn()
    overview.facts.push({ ...fact, fact_id: 3, object_id: 'other', label: 'Other', attribute: 'note', value: 'x',
      evidence: [{ quote: 'Elsewhere.', speaker: 'Sam', meeting: MEETING_2, audio_start: 3 }, ...fact.evidence] })
    await load(MEETING_1, seek)
    fireEvent.click(await within(card('Launch project')).findByRole('button', { name: 'Play Pilot review from 1:05' }))
    expect(seek).toHaveBeenCalledWith(MEETING_1, 65)
    expect(within(card('Other')).queryByRole('button', { name: /^Play/ })).not.toBeInTheDocument()
  })
})

describe('failures', () => {
  it('reports load and write failures and permits an explicit retry', async () => {
    const original = respond
    respond = () => { throw { message: 'Ledger unavailable' } }
    render(<TemporalMemoryPanel vaultPath="/vault" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Ledger unavailable')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
    respond = original
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByRole('button', { name: 'Accept' })
    respond = request => { if (request.method === 'proposals.accept') throw new Error('Proposal changed; reload before accepting.'); return original(request) }
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Proposal changed')
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  it('reads an overview it does not understand as an error rather than crashing', async () => {
    respond = () => [{ unexpected: true }]
    render(<TemporalMemoryPanel vaultPath="/vault" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('answered in a form this version cannot read')
  })

  it('does not offer duplicate approval if the write succeeds but refreshing fails', async () => {
    await load()
    respond = request => { if (request.method === 'overview') throw new Error('Read failed'); return { ok: true } }
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Suggestion accepted. The updated ledger could not be loaded')
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })

  it('discards late responses when switching vaults', async () => {
    let finish!: (result: unknown) => void
    respond = request => request.vaultPath === '/old' ? new Promise(resolve => { finish = resolve }) : { ...base, facts: [], proposals: [] }
    const view = render(<TemporalMemoryPanel vaultPath="/old" />)
    view.rerender(<TemporalMemoryPanel vaultPath="/new" />)
    await screen.findByRole('heading', { name: 'No decisions yet' })
    await act(async () => finish(base))
    expect(screen.queryByText('We agreed on a budget of 100.')).not.toBeInTheDocument()
    expect(requests.map(request => request.vaultPath)).toEqual(['/old', '/new'])
  })
})

describe('tracked items setup', () => {
  it('saves a new enum attribute while preserving other tracked objects and attributes', async () => {
    const other = { object_id: 'team', label: 'Design team', kind: 'issue', attributes: [{ name: 'owner', type: 'text' as const }] }
    overview.registry.objects.push(other)
    await load()
    open('Tracked items')
    input('Item label', 'Contradictory label')
    fireEvent.change(screen.getByRole('combobox', { name: 'Item kind' }), { target: { value: 'commitment' } })
    input('Object ID', 'launch')
    expect(screen.getByRole('textbox', { name: 'Item label' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Item label' })).toHaveValue('Launch project')
    expect(screen.getByRole('combobox', { name: 'Item kind' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Item kind' })).toHaveValue('decision')
    input('Attribute name', 'status')
    fireEvent.change(screen.getByRole('combobox', { name: 'Attribute type' }), { target: { value: 'enum' } })
    input('Allowed values (required, comma-separated)', 'planned, active, planned')
    fireEvent.click(screen.getByRole('button', { name: 'Save tracked item' }))
    await screen.findByText('Tracked item saved.')
    expect(requests.find(request => request.method === 'registry.set')).toEqual({
      vaultPath: '/vault', method: 'registry.set', params: { objects: [{ ...base.registry.objects[0], attributes: [
        { name: 'budget', type: 'number' }, { name: 'status', type: 'enum', values: ['planned', 'active'] },
      ] }, other] },
    })
  })

  it('reports a refused save next to the form, where it was made', async () => {
    await load()
    const setup = open('Tracked items')
    const original = respond
    respond = request => { if (request.method === 'registry.set') throw { message: 'The ledger refused the change.' }; return original(request) }
    input('Object ID', 'owner')
    input('Item label', 'Owner')
    input('Attribute name', 'name')
    fireEvent.click(screen.getByRole('button', { name: 'Save tracked item' }))
    expect(await within(setup).findByRole('alert')).toHaveTextContent('The ledger refused the change.')
    expect(screen.queryByText('Tracked item saved.')).not.toBeInTheDocument()
  })

  it('lists tracked items by label and kind, never by their ids', async () => {
    await load()
    const setup = open('Tracked items')
    const listed = within(setup).getAllByRole('listitem')[0]
    expect(listed).toHaveTextContent('Launch project Decision')
    expect(listed).not.toHaveTextContent('launch ·')
  })

  it('requires nonempty allowed values before saving an enum definition', async () => {
    // `stage` holds no value yet, so changing its type is free; `budget` (a recorded number) is covered by the guard tests below.
    overview.registry.objects[0].attributes.push({ name: 'stage', type: 'text' })
    await load()
    open('Tracked items')
    fireEvent.click(screen.getByRole('button', { name: 'Edit stage (text)' }))
    expect(screen.getByRole('textbox', { name: 'Object ID' })).toHaveValue('launch')
    fireEvent.change(screen.getByRole('combobox', { name: 'Attribute type' }), { target: { value: 'enum' } })
    const save = screen.getByRole('button', { name: 'Save tracked item' })
    expect(screen.getByRole('textbox', { name: 'Allowed values (required, comma-separated)' })).toBeRequired()
    expect(save).toBeDisabled()
    input('Allowed values (required, comma-separated)', ' , , ')
    expect(save).toBeDisabled()
    fireEvent.submit(save.closest('form')!)
    expect(requests.some(request => request.method === 'registry.set')).toBe(false)
    input('Allowed values (required, comma-separated)', 'planned, active')
    fireEvent.click(screen.getByRole('button', { name: 'Save tracked item' }))
    await screen.findByText('Tracked item saved.')
    expect(requests.find(request => request.method === 'registry.set')?.params).toEqual({ objects: [
      { ...base.registry.objects[0], attributes: [{ name: 'budget', type: 'number' }, { name: 'stage', type: 'enum', values: ['planned', 'active'] }] },
    ] })
  })

  it('explains why an existing item keeps its label and kind, and stays quiet for a new item', async () => {
    await load()
    open('Tracked items')
    expect(screen.queryByText(/is already tracked/)).not.toBeInTheDocument()
    input('Object ID', 'launch')
    const note = screen.getByText(/"Launch project" is already tracked, so its label and kind can't be changed here/)
    expect(screen.getByRole('textbox', { name: 'Item label' })).toHaveAccessibleDescription(note.textContent ?? '')
    expect(screen.getByRole('combobox', { name: 'Item kind' })).toHaveAccessibleDescription(note.textContent ?? '')
    input('Object ID', 'owner')
    expect(screen.queryByText(/is already tracked/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Item label' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'Item kind' })).toBeEnabled()
  })

  // Observed in the engine: a new item whose kind is not issue, decision or commitment is refused, and the form used to start with "object".
  it('offers a new item only the kinds the ledger accepts, starting with decision rather than the refused "object"', async () => {
    await load()
    open('Tracked items')
    const kind = screen.getByRole('combobox', { name: 'Item kind' })
    expect(within(kind).getAllByRole('option').map(option => option.textContent)).toEqual(['Decision', 'Commitment', 'Issue'])
    expect(kind).toHaveValue('decision')
    input('Object ID', 'owner')
    input('Item label', 'Owner')
    input('Attribute name', 'name')
    fireEvent.click(screen.getByRole('button', { name: 'Save tracked item' }))
    await screen.findByText('Tracked item saved.')
    expect(requests.find(request => request.method === 'registry.set')?.params).toEqual({ objects: [
      base.registry.objects[0], { object_id: 'owner', label: 'Owner', kind: 'decision', attributes: [{ name: 'name', type: 'text' }] },
    ] })
  })

  it('saves the kind that was chosen for a new item', async () => {
    await load()
    open('Tracked items')
    input('Object ID', 'owner')
    input('Item label', 'Owner')
    fireEvent.change(screen.getByRole('combobox', { name: 'Item kind' }), { target: { value: 'commitment' } })
    input('Attribute name', 'name')
    fireEvent.click(screen.getByRole('button', { name: 'Save tracked item' }))
    await screen.findByText('Tracked item saved.')
    expect(requests.find(request => request.method === 'registry.set')?.params).toMatchObject({ objects: [expect.anything(), { object_id: 'owner', kind: 'commitment' }] })
  })

  /** One tracked item whose four attributes each hold a value, the shape the ledger really has once facts were approved. */
  function withRecordedValues() {
    overview.registry.objects[0].attributes = [
      { name: 'budget', type: 'number' }, { name: 'owner', type: 'text' },
      { name: 'status', type: 'enum', values: ['planned', 'active'] }, { name: 'go_live', type: 'date' },
    ]
    overview.facts = [
      { ...fact, fact_id: 2, value: 100 }, { ...fact, fact_id: 3, attribute: 'owner', value: 'Maya' },
      { ...fact, fact_id: 4, attribute: 'status', value: 'active' }, { ...fact, fact_id: 5, attribute: 'go_live', value: '2026-12-01' },
    ]
    overview.proposals = []
  }

  function startEditing(name: string, type: string, change: { type?: string; values?: string }) {
    fireEvent.click(screen.getByRole('button', { name: `Edit ${name} (${type})` }))
    if (change.type) fireEvent.change(screen.getByRole('combobox', { name: 'Attribute type' }), { target: { value: change.type } })
    if (change.values !== undefined) input('Allowed values (required, comma-separated)', change.values)
  }

  // The ledger accepts all of these and leaves the old value as it was, so the form is what keeps a number sitting in a date attribute.
  it.each([
    ['budget', 'number', { type: 'text' }, /"budget" has values that would not fit the type "text": 100 \(recorded\)\. First retract the recorded values, or keep the type "number"\./],
    ['budget', 'number', { type: 'date' }, /would not fit the type "date": 100 \(recorded\)/],
    ['budget', 'number', { type: 'enum', values: 'planned, 100' }, /would not fit the type "enum": 100 \(recorded\)/],
    ['owner', 'text', { type: 'number' }, /would not fit the type "number": "Maya" \(recorded\)/],
    ['owner', 'text', { type: 'enum', values: 'Sam, Priya' }, /would not fit the type "enum": "Maya" \(recorded\)/],
    ['status', 'enum', { type: 'number' }, /would not fit the type "number": "active" \(recorded\)/],
    ['status', 'enum', { values: 'planned, done' }, /"status" still has values outside the allowed list: "active" \(recorded\)\. Keep them in the list, or first retract the recorded values\./],
    ['go_live', 'date', { type: 'number' }, /would not fit the type "number": "2026-12-01" \(recorded\)/],
  ] as const)('holds back changing %s (%s) as %j, because its recorded value would no longer fit', async (name, type, change, explanation) => {
    withRecordedValues()
    await load()
    open('Tracked items')
    startEditing(name, type, change)
    const note = screen.getByText(explanation)
    const save = screen.getByRole('button', { name: 'Save tracked item' })
    expect(save).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Attribute type' })).toBeInvalid()
    expect(screen.getByRole('combobox', { name: 'Attribute type' })).toHaveAccessibleDescription(note.textContent ?? '')
    // A forced submission is refused as well; the ledger would otherwise have accepted it.
    fireEvent.submit(save.closest('form')!)
    expect(requests.some(request => request.method === 'registry.set')).toBe(false)
  })

  it.each([
    ['a text value that is on the new list', 'owner', 'text', { type: 'enum', values: 'Maya, Sam' }],
    ['a longer list that keeps the value', 'status', 'enum', { values: 'planned, active, done' }],
    ['the same list in another order', 'status', 'enum', { values: 'active, planned' }],
    ['a value that is text anyway', 'status', 'enum', { type: 'text' }],
    ['a date, which is text', 'go_live', 'date', { type: 'text' }],
    ['no change at all', 'budget', 'number', {}],
  ] as const)('allows %s: changing %s (%s) as %j', async (_reason, name, type, change) => {
    withRecordedValues()
    await load()
    open('Tracked items')
    startEditing(name, type, change)
    expect(screen.queryByText(/would not fit|outside the allowed list/)).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Attribute type' })).toBeValid()
    expect(screen.getByRole('button', { name: 'Save tracked item' })).toBeEnabled()
  })

  it('names every kind of value that stands in the way: recorded values and suggestions, a few at a time', async () => {
    withRecordedValues()
    overview.proposals = [
      { ...base.proposals[0], proposal_id: 1, value: 120 }, { ...base.proposals[0], proposal_id: 2, value: 130 },
      { ...base.proposals[0], proposal_id: 3, value: 140 }, { ...base.proposals[0], proposal_id: 4, attribute: 'owner', value: 'Sam' },
    ]
    await load()
    open('Tracked items')
    startEditing('budget', 'number', { type: 'date' })
    expect(screen.getByText('"budget" has values that would not fit the type "date": 100 (recorded), 120 (suggestion), 130 (suggestion) and 1 more. First retract the recorded values and reject the suggestions, or keep the type "number".')).toBeInTheDocument()
    // Only suggestions in the way: rejecting them is the way out.
    startEditing('owner', 'text', { type: 'number' })
    expect(screen.getByText(/"owner" has values that would not fit the type "number": "Maya" \(recorded\), "Sam" \(suggestion\)\. First retract the recorded values and reject the suggestions/)).toBeInTheDocument()
  })

  it('lets the type change once nothing recorded or suggested is left in the way', async () => {
    withRecordedValues()
    await load()
    open('Tracked items')
    startEditing('budget', 'number', { type: 'text' })
    expect(screen.getByRole('button', { name: 'Save tracked item' })).toBeDisabled()
    // The reviewer retracts the value; the refreshed overview no longer holds it.
    overview.facts = overview.facts.filter(item => item.attribute !== 'budget')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.queryByText(/would not fit/)).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save tracked item' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save tracked item' }))
    await screen.findByText('Tracked item saved.')
    expect(requests.find(request => request.method === 'registry.set')?.params).toMatchObject({ objects: [{ attributes: expect.arrayContaining([{ name: 'budget', type: 'text' }]) }] })
  })

  it('still saves a permitted edit to an attribute that holds a value', async () => {
    withRecordedValues()
    await load()
    open('Tracked items')
    startEditing('owner', 'text', { type: 'enum', values: 'Maya, Sam' })
    fireEvent.click(screen.getByRole('button', { name: 'Save tracked item' }))
    await screen.findByText('Tracked item saved.')
    expect(requests.find(request => request.method === 'registry.set')?.params).toEqual({ objects: [{ ...base.registry.objects[0], attributes: [
      { name: 'budget', type: 'number' }, { name: 'owner', type: 'enum', values: ['Maya', 'Sam'] },
      { name: 'status', type: 'enum', values: ['planned', 'active'] }, { name: 'go_live', type: 'date' },
    ] }] })
  })

  it('does not check a new attribute, or one that holds no value, against anything', async () => {
    withRecordedValues()
    overview.registry.objects[0].attributes.push({ name: 'stage', type: 'number' })
    await load()
    open('Tracked items')
    startEditing('stage', 'number', { type: 'date' })
    expect(screen.queryByText(/would not fit/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save tracked item' })).toBeEnabled()
    input('Attribute name', 'brand_new')
    fireEvent.change(screen.getByRole('combobox', { name: 'Attribute type' }), { target: { value: 'number' } })
    expect(screen.queryByText(/would not fit/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save tracked item' })).toBeEnabled()
  })
})
