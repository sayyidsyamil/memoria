import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { TemporalMemoryPanel } from './TemporalMemoryPanel'
import type { TemporalFact, TemporalHistoryFact, TemporalOverview } from './temporalService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const MEETING_1 = '3f2a8c1e-5b7d-4e9a-8c3f-1a2b3c4d5e6f'
const MEETING_2 = '9d41b7a2-6c0e-4f58-b1d3-7e2f9a8c5b04'
const UNKNOWN_MEETING = 'c0ffee00-1d2e-4a3b-9c4d-5e6f7a8b9c0d'

const fact: TemporalFact = {
  fact_id: 2, object_id: 'launch', label: 'Launch project', attribute: 'budget', value: 100,
  evidence: [{ quote: 'We agreed on a budget of 100.', speaker: 'Maya', meeting: MEETING_1, audio_start: 65 }],
  valid_from: '2026-11-01', n_changes: 2,
}
const historicalFact: TemporalHistoryFact = {
  fact_id: 1, object_id: 'launch', label: 'Launch project', attribute: 'budget', value: 80,
  evidence: fact.evidence, claim_from: '2026-10-01', claim_to: '2026-11-01',
  decided_at: '2026-10-02T10:00:00Z', retracted: false, corrects: null,
}
const base: TemporalOverview = {
  registry: { objects: [{ object_id: 'launch', label: 'Launch project', kind: 'project', attributes: [{ name: 'budget', type: 'number' }] }] },
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

// Expected labels are built with Intl directly, so these tests hold in any locale and time zone.
const day = { day: 'numeric', month: 'short', year: 'numeric' } as const
const calendar = (iso: string) => new Intl.DateTimeFormat(undefined, { ...day, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
const instant = (iso: string, time = false) => new Intl.DateTimeFormat(undefined, time ? { ...day, hour: '2-digit', minute: '2-digit' } : day).format(new Date(iso))

type Request = { vaultPath: string; method: string; params: Record<string, unknown> }
type MeetingRequest = { vaultPath: string; operation: string }
const meetingRecord = (id: string, title: string) => ({ id, title, status: 'needs-review', pagePath: `meetings/meeting-${id}.md` })
let overview: TemporalOverview
let requests: Request[]
let meetingRequests: MeetingRequest[]
let respond: (request: Request) => unknown
let respondMeetings: (request: MeetingRequest) => unknown
let calls: string[]

beforeEach(() => {
  overview = structuredClone(base)
  requests = []
  meetingRequests = []
  calls = []
  respondMeetings = () => [meetingRecord(MEETING_1, 'Pilot review'), meetingRecord(MEETING_2, 'Budget workshop')]
  respond = request => request.method === 'overview' ? structuredClone(overview)
    : request.method === 'facts.history' ? [structuredClone(historicalFact)]
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
afterEach(cleanup)

async function load(meetingId?: string) {
  const view = render(<TemporalMemoryPanel vaultPath="/vault" meetingId={meetingId} />)
  await screen.findByRole('heading', { name: 'Current facts' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
  return view
}

function input(name: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
}

/** The paragraph that starts with the given words; its text spans the date elements inside it. */
function line(scope: HTMLElement, start: RegExp) {
  return within(scope).getByText(start)
}

async function lookUp(type: string, { item = 'launch', attribute = 'budget', at = '' } = {}) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Query item' }), { target: { value: item } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Query attribute' }), { target: { value: attribute } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Time perspective' }), { target: { value: type } })
  if (at) input('As of (ISO date or timestamp)', at)
  fireEvent.click(screen.getByRole('button', { name: 'Look up value' }))
  return within(screen.getByRole('region', { name: 'Query tracked facts' })).findByRole('status')
}

it('loads facts with evidence and ledger check problems without performing writes', async () => {
  overview.check = { ok: false, problems: ['Overlapping valid intervals'] }
  await load()
  const current = screen.getByRole('article', { name: 'Fact: Launch project — budget' })
  expect(within(current).getByText('We agreed on a budget of 100.')).toBeInTheDocument()
  expect(await within(current).findByText('Pilot review')).toBeInTheDocument()
  expect(current.querySelector('figcaption')).toHaveTextContent('Maya · Pilot review · Audio 1:05')
  expect(current).not.toHaveTextContent(MEETING_1)
  expect(line(current, /^Valid from/)).toHaveTextContent(`Valid from ${calendar('2026-11-01')} · 2 changes`)
  expect(screen.getByRole('alert')).toHaveTextContent('Overlapping valid intervals')
  expect(requests).toEqual([{ vaultPath: '/vault', method: 'overview', params: {} }])
  expect(meetingRequests).toEqual([{ vaultPath: '/vault', operation: 'list' }])
  // The ledger is requested first; the titles only label its citations.
  expect(calls).toEqual(['temporal_api', 'meetings_api'])
})

it('saves a new enum attribute while preserving other tracked objects and attributes', async () => {
  const other = { object_id: 'team', label: 'Design team', kind: 'team', attributes: [{ name: 'owner', type: 'text' as const }] }
  overview.registry.objects.push(other)
  await load()
  input('Item label', 'Contradictory label')
  input('Item kind', 'Contradictory kind')
  input('Object ID', 'launch')
  expect(screen.getByRole('textbox', { name: 'Item label' })).toBeDisabled()
  expect(screen.getByRole('textbox', { name: 'Item label' })).toHaveValue('Launch project')
  expect(screen.getByRole('textbox', { name: 'Item kind' })).toBeDisabled()
  expect(screen.getByRole('textbox', { name: 'Item kind' })).toHaveValue('project')
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

it('requires nonempty allowed values before saving an enum definition', async () => {
  await load()
  fireEvent.click(screen.getByRole('button', { name: 'Edit budget (number)' }))
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
    { ...base.registry.objects[0], attributes: [{ name: 'budget', type: 'enum', values: ['planned', 'active'] }] },
  ] })
})

it.each([
  ['Accept suggestion', 'proposals.accept', 'Suggestion accepted.'],
  ['Reject suggestion', 'proposals.reject', 'Suggestion rejected.'],
])('explicitly performs %s and refreshes the proposal list', async (button, method, message) => {
  await load()
  const original = respond
  respond = request => {
    if (request.method === method) { overview.proposals = []; return { ok: true } }
    return original(request)
  }
  fireEvent.click(screen.getByRole('button', { name: button }))
  await screen.findByText(message)
  await waitFor(() => expect(screen.queryByRole('button', { name: button })).not.toBeInTheDocument())
  expect(requests.find(request => request.method === method)).toEqual({ vaultPath: '/vault', method, params: { proposal_id: 1 } })
})

it('guards duplicate actions and disables other actions while a write is pending', async () => {
  await load()
  let finish!: (result: unknown) => void
  const original = respond
  respond = request => request.method === 'proposals.accept' ? new Promise(resolve => { finish = resolve }) : original(request)
  const accept = screen.getByRole('button', { name: 'Accept suggestion' })
  fireEvent.click(accept)
  fireEvent.click(accept)
  expect(screen.getByRole('button', { name: 'Reject suggestion' })).toBeDisabled()
  expect(screen.getByText('Accepting suggestion…')).toBeInTheDocument()
  expect(requests.filter(request => request.method === 'proposals.accept')).toHaveLength(1)
  await act(async () => finish({ ok: true }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
})

it('shows history and requires a reason before sending a typed numeric correction', async () => {
  await load()
  fireEvent.click(screen.getByRole('button', { name: 'History' }))
  const history = await screen.findByRole('region', { name: 'Fact history' })
  expect(within(history).getByText('80')).toBeInTheDocument()
  expect(line(history, /^Valid from/)).toHaveTextContent(`Valid from ${calendar('2026-10-01')} until ${calendar('2026-11-01')}`)
  expect(line(history, /^Decided/)).toHaveTextContent(`Decided ${instant('2026-10-02T10:00:00Z', true)}`)
  expect(history).not.toHaveTextContent(/undefined changes|date not recorded|NaN|2026-1\d-\d\d/)
  expect(requests.find(request => request.method === 'facts.history')?.params).toEqual({ object_id: 'launch', attribute: 'budget' })
  fireEvent.click(within(history).getByRole('button', { name: 'Correct' }))
  const save = screen.getByRole('button', { name: 'Save correction' })
  input('Corrected value', '95')
  expect(save).toBeDisabled()
  input('Reason (required)', '  Corrected transcript figure  ')
  fireEvent.click(save)
  await screen.findByText('Correction saved.')
  expect(requests.find(request => request.method === 'facts.correct')?.params).toEqual({ fact_id: 1, value: 95, reason: 'Corrected transcript figure' })
})

it('rejects invalid numeric corrections locally and retains the reason for retry', async () => {
  await load()
  fireEvent.click(screen.getByRole('button', { name: 'Correct' }))
  input('Corrected value', 'not a number')
  input('Reason (required)', 'Transcript correction')
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a finite number')
  expect(requests.some(request => request.method === 'facts.correct')).toBe(false)
  expect(screen.getByRole('textbox', { name: 'Reason (required)' })).toHaveValue('Transcript correction')
})

it('renders correction provenance in current facts and vendor history, disabling retracted mutations', async () => {
  const correction = { reviewer: 'Maya', reason: 'Reviewed transcript correction', replaced_fact_id: 1 }
  overview.facts[0] = { ...fact, correction, corrects: 1, retracted: true }
  const original = respond
  respond = request => request.method === 'facts.history' ? [
    { ...historicalFact, retracted: true },
    { ...historicalFact, fact_id: 2, value: 100, claim_from: '2026-11-01', claim_to: null,
      decided_at: '2026-11-02T10:00:00Z', corrects: 1, correction,
      tx_from: '2026-11-02T10:01:00Z', tx_to: '2026-11-03T10:00:00Z' },
  ] : original(request)
  await load()
  const current = screen.getByRole('article', { name: 'Fact: Launch project — budget' })
  expect(within(current).getByText('Correction by Maya: Reviewed transcript correction')).toBeInTheDocument()
  expect(within(current).getByText('Corrects fact #1')).toBeInTheDocument()
  expect(within(current).getByRole('button', { name: 'Correct' })).toBeDisabled()
  expect(within(current).getByRole('button', { name: 'Retract' })).toBeDisabled()
  fireEvent.click(within(current).getByRole('button', { name: 'History' }))
  const history = await screen.findByRole('region', { name: 'Fact history' })
  const rows = within(history).getAllByRole('article')
  expect(within(rows[0]).getByText('Retracted')).toBeInTheDocument()
  expect(within(rows[0]).getByRole('button', { name: 'Correct' })).toBeDisabled()
  expect(within(rows[0]).getByRole('button', { name: 'Retract' })).toBeDisabled()
  fireEvent.click(within(rows[0]).getByRole('button', { name: 'Correct' }))
  fireEvent.click(within(rows[0]).getByRole('button', { name: 'Retract' }))
  expect(screen.queryByRole('region', { name: 'Correct fact' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Retract fact' })).not.toBeInTheDocument()
  expect(line(rows[1], /^Valid from/)).toHaveTextContent(`Valid from ${calendar('2026-11-01')}`)
  expect(line(rows[1], /^Decided/)).toHaveTextContent(`Decided ${instant('2026-11-02T10:00:00Z', true)}`)
  expect(line(rows[1], /^Recorded/)).toHaveTextContent(`Recorded ${instant('2026-11-02T10:01:00Z', true)} until ${instant('2026-11-03T10:00:00Z', true)}`)
  expect(within(rows[1]).getByText('Corrects fact #1')).toBeInTheDocument()
  expect(within(rows[1]).getByText('Correction by Maya: Reviewed transcript correction')).toBeInTheDocument()
  expect(requests.some(request => ['facts.correct', 'facts.retract'].includes(request.method))).toBe(false)
})

it.each([
  ['date', '2026-02-30', 'Enter a valid date'],
  ['enum', 'unknown', 'Choose one of: planned, active'],
])('validates %s corrections against the tracked definition', async (type, value, error) => {
  overview.registry.objects[0].attributes = [{ name: 'budget', type: type as 'date' | 'enum', ...(type === 'enum' ? { values: ['planned', 'active'] } : {}) }]
  await load()
  fireEvent.click(screen.getByRole('button', { name: 'Correct' }))
  input('Corrected value', value)
  input('Reason (required)', 'Fix incorrect value')
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(error)
  expect(requests.some(request => request.method === 'facts.correct')).toBe(false)
})

it('requires a nonblank retraction reason and allows cancellation without a write', async () => {
  await load()
  fireEvent.click(screen.getByRole('button', { name: 'Retract' }))
  input('Reason (required)', '   ')
  expect(screen.getByRole('button', { name: 'Confirm retraction' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(requests.some(request => request.method === 'facts.retract')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Retract' }))
  input('Reason (required)', 'Unsupported by the reviewed recording')
  fireEvent.click(screen.getByRole('button', { name: 'Confirm retraction' }))
  await screen.findByText('Fact retracted.')
  expect(requests.find(request => request.method === 'facts.retract')?.params).toEqual({ fact_id: 2, reason: 'Unsupported by the reviewed recording' })
})

it.each([
  ['current', {}, '', 'Current', '100', ['We agreed on a budget of 100.'], ['Maya · Pilot review · Audio 1:05']],
  ['as_of_valid', { valid_at: '2026-10-15' }, '2026-10-15', `Valid at ${calendar('2026-10-15')}`, '80', ['Let us start with 80.'], ['Sam · Budget workshop · Audio 0:12']],
  ['as_of_tx', { tx_at: '2026-10-15' }, '2026-10-15', `Value valid now, as known on ${calendar('2026-10-15')}`, '80', ['Let us start with 80.'], ['Sam · Budget workshop · Audio 0:12']],
  ['n_changes', {}, '', 'Number of changes', 'Changed once', ['Let us start with 80.', 'We agreed on a budget of 100.'], ['Sam · Budget workshop · Audio 0:12', 'Maya · Pilot review · Audio 1:05']],
])('queries %s only after explicit submission and shows a readable answer', async (type, time, at, heading, answer, quotes, captions) => {
  await load()
  fireEvent.change(screen.getByRole('combobox', { name: 'Query item' }), { target: { value: 'launch' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Query attribute' }), { target: { value: 'budget' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Time perspective' }), { target: { value: type } })
  if (type.startsWith('as_of')) {
    expect(screen.getByRole('button', { name: 'Look up value' })).toBeDisabled()
    input('As of (ISO date or timestamp)', at)
  }
  expect(requests.some(request => request.method === 'query')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Look up value' }))
  const result = await within(screen.getByRole('region', { name: 'Query tracked facts' })).findByRole('status')
  expect(within(result).getByRole('heading')).toHaveTextContent(`launch — budget · ${heading}`)
  if (at) expect(within(result).getByRole('heading').querySelector('time')).toHaveAttribute('datetime', at)
  expect(result.querySelector('.temporal-value')?.textContent).toBe(answer)
  for (const quote of quotes) expect(within(result).getAllByText(quote)).toHaveLength(1)
  await waitFor(() => expect(Array.from(result.querySelectorAll('figcaption'), caption => caption.textContent)).toEqual(captions))
  // Readable, not the ledger's raw answer: no JSON, no extraction internals, no meeting ids.
  expect(result.querySelector('pre')).toBeNull()
  expect(result).not.toHaveTextContent(/"answer"|[{}[\]]|char_start|confidence|extractor|history|[0-9a-f]{8}-[0-9a-f]{4}/)
  expect(requests.find(request => request.method === 'query')?.params).toEqual({ type, object_id: 'launch', attribute: 'budget', ...time })
})

it('shows when a looked-up value was decided, in the viewer’s own time', async () => {
  await load()
  const result = await lookUp('current')
  expect(line(result, /^Decided/)).toHaveTextContent(`Decided ${instant('2026-11-01T10:00:12Z', true)}`)
  expect(line(result, /^Decided/).querySelector('time')).toHaveAttribute('datetime', '2026-11-01T10:00:12Z')
})

it.each([[0, 'No changes recorded'], [1, 'Changed once'], [2, 'Changed twice'], [3, 'Changed 3 times']])('answers a lookup of %i changes with a sentence', async (count, sentence) => {
  const original = respond
  respond = request => request.method === 'query' ? { type: 'n_changes', answer: count, evidence: [], history: [] } : original(request)
  await load()
  const result = await lookUp('n_changes')
  expect(result.querySelector('.temporal-value')?.textContent).toBe(sentence)
  expect(result.querySelector('figure')).toBeNull()
})

it('says so when the ledger held no value for the lookup', async () => {
  const original = respond
  respond = request => request.method === 'query' ? { type: 'as_of_valid', answer: null, evidence: [] } : original(request)
  await load()
  const result = await lookUp('as_of_valid', { at: '2026-01-01' })
  expect(result.querySelector('.temporal-value')?.textContent).toBe('No value recorded')
  expect(result.querySelector('figure')).toBeNull()
  expect(result.querySelector('pre')).toBeNull()
})

it('writes a typed lookup timestamp as a readable date and time while keeping its exact value', async () => {
  await load()
  const heading = within(await lookUp('as_of_valid', { at: '2026-10-15T10:00:00Z' })).getByRole('heading')
  expect(heading).toHaveTextContent(`launch — budget · Valid at ${instant('2026-10-15T10:00:00Z', true)}`)
  expect(heading.querySelector('time')).toHaveAttribute('datetime', '2026-10-15T10:00:00Z')
})

it('shows a lookup date it cannot read as typed, without a time element', async () => {
  await load()
  const heading = within(await lookUp('as_of_valid', { at: 'last autumn' })).getByRole('heading')
  expect(heading).toHaveTextContent('launch — budget · Valid at last autumn')
  expect(heading.querySelector('time')).toBeNull()
})

it('keeps an unfamiliar result shape inspectable instead of crashing', async () => {
  const original = respond
  respond = request => request.method === 'query' ? { surprise: ['a', 1], nested: { ok: true } } : original(request)
  await load()
  const result = await lookUp('current')
  expect(result.querySelector('pre')).toHaveTextContent('"surprise"')
  expect(result.querySelector('pre')).toHaveTextContent('"nested"')
  expect(result.querySelector('figure')).toBeNull()
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

it.each([
  [0, 'no changes'], [1, '1 change'], [2, '2 changes'], [11, '11 changes'],
])('writes a fact with %i changes as "%s"', async (count, text) => {
  overview.facts[0] = { ...fact, n_changes: count }
  await load()
  const card = screen.getByRole('article', { name: 'Fact: Launch project — budget' })
  expect(line(card, /^Valid from/)).toHaveTextContent(`Valid from ${calendar('2026-11-01')} · ${text}`)
  expect(card).not.toHaveTextContent(/\b1 changes|\b0 changes/)
})

it('shows dates as readable text and keeps the exact value in a time element', async () => {
  overview.facts[0] = { ...fact, valid_from: '2026-10-10', valid_to: '2026-10-20T10:00:12Z', decided_at: '2026-10-20T10:00:12Z' } as TemporalFact
  await load()
  const card = screen.getByRole('article', { name: 'Fact: Launch project — budget' })
  const [from, until, decided] = Array.from(card.querySelectorAll('time'))
  expect(from).toHaveAttribute('datetime', '2026-10-10')
  expect(from).toHaveTextContent(calendar('2026-10-10'))
  expect(until).toHaveAttribute('datetime', '2026-10-20T10:00:12Z')
  expect(until).toHaveTextContent(instant('2026-10-20T10:00:12Z'))
  expect(decided).toHaveAttribute('datetime', '2026-10-20T10:00:12Z')
  expect(decided).toHaveTextContent(instant('2026-10-20T10:00:12Z', true))
  expect(line(card, /^Valid from/)).toHaveTextContent(`Valid from ${calendar('2026-10-10')} until ${instant('2026-10-20T10:00:12Z')} · 2 changes`)
  expect(card).not.toHaveTextContent(/2026-10-\d\d|T10:00:12Z/)
})

it.each(['Pacific/Pago_Pago', 'America/Los_Angeles'])('keeps date-only values on their own day for a viewer in %s', async zone => {
  const original = process.env.TZ
  process.env.TZ = zone
  try {
    expect(new Date(2026, 9, 10).getTimezoneOffset()).toBeGreaterThan(0)
    overview.registry.objects[0].attributes = [{ name: 'go_live', type: 'date' }]
    overview.facts[0] = { ...fact, attribute: 'go_live', value: '2026-12-01', valid_from: '2026-10-10', valid_to: '2026-10-20' }
    await load()
    const card = screen.getByRole('article', { name: 'Fact: Launch project — go_live' })
    expect(Array.from(card.querySelectorAll('time'), item => item.textContent)).toEqual([calendar('2026-12-01'), calendar('2026-10-10'), calendar('2026-10-20')])
    const heading = within(await lookUp('as_of_valid', { attribute: 'go_live', at: '2026-10-15' })).getByRole('heading')
    expect(heading.querySelector('time')).toHaveTextContent(calendar('2026-10-15'))
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
})

it('shows a date it cannot read as recorded, and a missing one as not recorded', async () => {
  overview.facts[0] = { ...fact, valid_from: 'sometime in autumn', valid_to: '2026-02-30' }
  overview.facts.push({ ...fact, fact_id: 3, attribute: 'owner', value: 'Maya', valid_from: null, n_changes: 0 })
  overview.registry.objects[0].attributes.push({ name: 'owner', type: 'text' })
  await load()
  const budget = screen.getByRole('article', { name: 'Fact: Launch project — budget' })
  expect(line(budget, /^Valid from/)).toHaveTextContent('Valid from sometime in autumn until 2026-02-30 · 2 changes')
  expect(budget.querySelector('time')).toBeNull()
  expect(line(screen.getByRole('article', { name: 'Fact: Launch project — owner' }), /^Valid from/)).toHaveTextContent('Valid from date not recorded · no changes')
})

it('shows date attributes as readable dates everywhere a value appears, and edits them as typed', async () => {
  overview.registry.objects[0].attributes = [{ name: 'go_live', type: 'date' }]
  overview.facts[0] = { ...fact, attribute: 'go_live', value: '2026-12-01' }
  overview.proposals[0] = { ...base.proposals[0], attribute: 'go_live', current_value: '2026-12-01', value: '2026-12-15' }
  const original = respond
  respond = request => request.method === 'query' ? { type: 'current', answer: '2026-12-15', evidence: [] } : original(request)
  await load()
  const card = screen.getByRole('article', { name: 'Fact: Launch project — go_live' })
  expect(card.querySelector('.temporal-value time')).toHaveAttribute('datetime', '2026-12-01')
  expect(card.querySelector('.temporal-value')?.textContent).toBe(calendar('2026-12-01'))
  const proposal = screen.getByRole('article', { name: 'Proposal: Launch project — go_live' })
  expect(Array.from(proposal.querySelectorAll('dd'), item => item.textContent)).toEqual([calendar('2026-12-01'), calendar('2026-12-15')])
  expect(proposal.querySelectorAll('dd time')).toHaveLength(2)

  const result = await lookUp('current', { attribute: 'go_live' })
  expect(result.querySelector('.temporal-value')?.textContent).toBe(calendar('2026-12-15'))
  expect(result.querySelector('.temporal-value time')).toHaveAttribute('datetime', '2026-12-15')

  fireEvent.click(within(card).getByRole('button', { name: 'Correct' }))
  const form = screen.getByRole('region', { name: 'Correct fact' })
  expect(form).toHaveTextContent(`Recorded value: ${calendar('2026-12-01')}.`)
  // Editing stays in the format the ledger validates.
  expect(screen.getByRole('textbox', { name: 'Corrected value' })).toHaveValue('2026-12-01')
})

it('shows a date-looking value of a text attribute exactly as recorded', async () => {
  overview.facts[0] = { ...fact, attribute: 'budget', value: '2026-12-01' }
  overview.registry.objects[0].attributes = [{ name: 'budget', type: 'text' }]
  await load()
  const card = screen.getByRole('article', { name: 'Fact: Launch project — budget' })
  expect(card.querySelector('.temporal-value')?.textContent).toBe('2026-12-01')
  expect(card.querySelector('.temporal-value time')).toBeNull()
})

it('shows meeting titles instead of ids in proposals and falls back to a short labelled id for an unknown meeting', async () => {
  overview.proposals.push({ ...base.proposals[0], proposal_id: 2, meeting: UNKNOWN_MEETING, quote: 'Maybe 150.' })
  overview.proposals.push({ ...base.proposals[0], proposal_id: 3, meeting: null, quote: 'Source not linked.' })
  await load()
  const [known, unknown, unlinked] = screen.getAllByRole('article', { name: 'Proposal: Launch project — budget' })
  await waitFor(() => expect(known.querySelector('figcaption')).toHaveTextContent('Maya · Pilot review'))
  expect(unknown.querySelector('figcaption')).toHaveTextContent('Maya · Meeting c0ff…')
  expect(unlinked.querySelector('figcaption')).toHaveTextContent('Maya · Meeting not recorded')
  // The exact id stays inspectable.
  expect(within(unknown).getByTitle(`Meeting ID: ${UNKNOWN_MEETING}`)).toHaveTextContent('Meeting c0ff…')
  expect(within(known).getByTitle(`Meeting ID: ${MEETING_1}`)).toHaveTextContent('Pilot review')
  for (const proposal of [known, unknown, unlinked]) expect(proposal).not.toHaveTextContent(/[0-9a-f]{8}-[0-9a-f]{4}/)
})

it('shows meeting titles in the history of a fact', async () => {
  await load()
  fireEvent.click(screen.getByRole('button', { name: 'History' }))
  const history = await screen.findByRole('region', { name: 'Fact history' })
  expect(await within(history).findByText('Pilot review')).toBeInTheDocument()
  expect(history).not.toHaveTextContent(MEETING_1)
})

it.each([
  ['the service reports an error', () => { throw { code: 'RUNTIME_UNAVAILABLE', message: 'The meeting runtime is unavailable.' } }],
  ['the list is malformed', () => ({ meetings: [] })],
  ['the list holds an invalid record', () => [{ id: MEETING_1 }]],
])('keeps working with short labelled ids when %s', async (_name, answer) => {
  respondMeetings = answer
  await load()
  const card = screen.getByRole('article', { name: 'Fact: Launch project — budget' })
  await waitFor(() => expect(meetingRequests).toHaveLength(1))
  await act(async () => { await Promise.resolve() })
  expect(card.querySelector('figcaption')).toHaveTextContent('Maya · Meeting 3f2a… · Audio 1:05')
  expect(within(card).getByTitle(`Meeting ID: ${MEETING_1}`)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(within(card).getByRole('button', { name: 'History' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeEnabled()
})

it('does not wait for meeting titles before showing the ledger', async () => {
  respondMeetings = () => new Promise(() => undefined)
  await load()
  expect(screen.getByRole('article', { name: 'Fact: Launch project — budget' }).querySelector('figcaption')).toHaveTextContent('Maya · Meeting 3f2a… · Audio 1:05')
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
})

it('looks meeting titles up again when the ledger is refreshed', async () => {
  await load()
  const card = screen.getByRole('article', { name: 'Fact: Launch project — budget' })
  expect(await within(card).findByText('Pilot review')).toBeInTheDocument()
  respondMeetings = () => [meetingRecord(MEETING_1, 'Pilot review, renamed')]
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(await within(card).findByText('Pilot review, renamed')).toBeInTheDocument()
  expect(meetingRequests).toEqual([{ vaultPath: '/vault', operation: 'list' }, { vaultPath: '/vault', operation: 'list' }])
})

it('ingests a reviewed meeting only on request and never auto-approves suggestions', async () => {
  overview.proposals.push({ ...base.proposals[0], proposal_id: 2, meeting: MEETING_2, quote: 'Unrelated meeting evidence' })
  await load(MEETING_1)
  expect(screen.queryByText('Unrelated meeting evidence')).not.toBeInTheDocument()
  const proposal = screen.getByRole('article', { name: 'Proposal: Launch project — budget' })
  expect(await within(proposal).findByText('Pilot review')).toBeInTheDocument()
  expect(proposal).not.toHaveTextContent(MEETING_1)
  expect(screen.queryByRole('region', { name: 'Tracked items setup' })).not.toBeInTheDocument()
  expect(requests.every(request => request.method === 'overview')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Find tracked fact suggestions' }))
  await screen.findByText('Meeting reviewed. proposed: 1')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeEnabled())
  expect(requests.find(request => request.method === 'ingest_reviewed_meeting')?.params).toEqual({ meetingId: MEETING_1 })
  expect(requests.some(request => request.method === 'proposals.accept')).toBe(false)
})

it('reports load and write failures and permits an explicit retry', async () => {
  const original = respond
  respond = () => { throw { message: 'Ledger unavailable' } }
  render(<TemporalMemoryPanel vaultPath="/vault" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Ledger unavailable')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
  respond = original
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByRole('button', { name: 'Accept suggestion' })
  respond = request => { if (request.method === 'proposals.accept') throw new Error('Proposal changed; reload before accepting.'); return original(request) }
  fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Proposal changed')
  expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeEnabled()
})

it('does not offer duplicate approval if the write succeeds but refreshing fails', async () => {
  await load()
  respond = request => { if (request.method === 'overview') throw new Error('Read failed'); return { ok: true } }
  fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Suggestion accepted. The updated ledger could not be loaded')
  expect(screen.queryByRole('button', { name: 'Accept suggestion' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
})

it('discards late responses when switching vaults', async () => {
  let finish!: (result: unknown) => void
  respond = request => request.vaultPath === '/old' ? new Promise(resolve => { finish = resolve }) : { ...base, facts: [], proposals: [] }
  const view = render(<TemporalMemoryPanel vaultPath="/old" />)
  view.rerender(<TemporalMemoryPanel vaultPath="/new" />)
  await screen.findByText('No approved tracked facts yet.')
  await act(async () => finish(base))
  expect(screen.queryByText('We agreed on a budget of 100.')).not.toBeInTheDocument()
  expect(requests.map(request => request.vaultPath)).toEqual(['/old', '/new'])
})
