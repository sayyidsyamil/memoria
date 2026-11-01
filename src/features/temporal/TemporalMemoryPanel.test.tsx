import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { TemporalMemoryPanel } from './TemporalMemoryPanel'
import type { TemporalFact, TemporalHistoryFact, TemporalOverview } from './temporalService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const fact: TemporalFact = {
  fact_id: 2, object_id: 'launch', label: 'Launch project', attribute: 'budget', value: 100,
  evidence: [{ quote: 'We agreed on a budget of 100.', speaker: 'Maya', meeting: 'meeting-1', audio_start: 65 }],
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
  proposals: [{ proposal_id: 1, label: 'Launch project', attribute: 'budget', value: 120, current_value: 100,
    quote: 'The budget should now be 120.', speaker: 'Maya', meeting: 'meeting-1' }],
  check: { ok: true, problems: [] },
}

type Request = { vaultPath: string; method: string; params: Record<string, unknown> }
let overview: TemporalOverview
let requests: Request[]
let respond: (request: Request) => unknown

beforeEach(() => {
  overview = structuredClone(base)
  requests = []
  respond = request => request.method === 'overview' ? structuredClone(overview)
    : request.method === 'facts.history' ? [structuredClone(historicalFact)]
      : request.method === 'query' ? { answer: 80, evidence: fact.evidence }
        : request.method === 'ingest_reviewed_meeting' ? { items: overview.proposals, counts: { proposed: 1 } } : { ok: true }
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    expect(command).toBe('temporal_api')
    const request = (args as { request: Request }).request
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

it('loads facts with evidence and ledger check problems without performing writes', async () => {
  overview.check = { ok: false, problems: ['Overlapping valid intervals'] }
  await load()
  const current = screen.getByRole('article', { name: 'Fact: Launch project — budget' })
  expect(within(current).getByText('We agreed on a budget of 100.')).toBeInTheDocument()
  expect(within(current).getByText(/Maya · meeting-1 · Audio 1:05/)).toBeInTheDocument()
  expect(within(current).getByText(/Valid from 2026-11-01 · 2 changes/)).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Overlapping valid intervals')
  expect(requests).toEqual([{ vaultPath: '/vault', method: 'overview', params: {} }])
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
  expect(within(history).getByText('Valid from 2026-10-01 until 2026-11-01')).toBeInTheDocument()
  expect(within(history).getByText('Decided 2026-10-02T10:00:00Z')).toBeInTheDocument()
  expect(within(history).queryByText(/undefined changes|date not recorded/)).not.toBeInTheDocument()
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
  expect(within(rows[1]).getByText('Valid from 2026-11-01')).toBeInTheDocument()
  expect(within(rows[1]).getByText('Decided 2026-11-02T10:00:00Z')).toBeInTheDocument()
  expect(within(rows[1]).getByText('Recorded 2026-11-02T10:01:00Z until 2026-11-03T10:00:00Z')).toBeInTheDocument()
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
  ['current', {}], ['as_of_valid', { valid_at: '2026-10-15' }],
  ['as_of_tx', { tx_at: '2026-10-15' }], ['n_changes', {}],
])('queries %s only after explicit submission', async (type, time) => {
  await load()
  fireEvent.change(screen.getByRole('combobox', { name: 'Query item' }), { target: { value: 'launch' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Query attribute' }), { target: { value: 'budget' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Time perspective' }), { target: { value: type } })
  if (type.startsWith('as_of')) {
    expect(screen.getByRole('button', { name: 'Look up value' })).toBeDisabled()
    input('As of (ISO date or timestamp)', '2026-10-15')
  }
  expect(requests.some(request => request.method === 'query')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Look up value' }))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Query tracked facts' })).toHaveTextContent('"answer": 80'))
  if (type === 'as_of_tx') expect(screen.getByRole('heading', { name: 'launch — budget · Value valid now, as known on 2026-10-15' })).toBeInTheDocument()
  expect(requests.find(request => request.method === 'query')?.params).toEqual({ type, object_id: 'launch', attribute: 'budget', ...time })
})

it('ingests a reviewed meeting only on request and never auto-approves suggestions', async () => {
  overview.proposals.push({ ...base.proposals[0], proposal_id: 2, meeting: 'meeting-2', quote: 'Unrelated meeting evidence' })
  await load('meeting-1')
  expect(screen.queryByText('Unrelated meeting evidence')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Tracked items setup' })).not.toBeInTheDocument()
  expect(requests.every(request => request.method === 'overview')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Find tracked fact suggestions' }))
  await screen.findByText('Meeting reviewed. proposed: 1')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeEnabled())
  expect(requests.find(request => request.method === 'ingest_reviewed_meeting')?.params).toEqual({ meetingId: 'meeting-1' })
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
