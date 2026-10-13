import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskResult, Brief, HistoryEntry, LedgerFact, MeetingSummary, Proposal } from '../lib/ledgerApi'
import snapshot from './mock-ledger-demo-snapshot.json'

type Call = (args: { method: string; params?: Record<string, unknown> }) => unknown

async function load(mode: string) {
  localStorage.setItem('memoria:mock-ledger', mode)
  vi.resetModules()
  const { mockLedgerHandlers } = await import('./mock-ledger')
  const run = mockLedgerHandlers.ledger_call as Call
  return <T,>(method: string, params?: Record<string, unknown>) => run({ method, params }) as T
}

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('mock ledger "demo" dataset (real service output of the fictional series)', () => {
  it('serves the review inbox as it was before review, or an empty one when reviewed', async () => {
    const call = await load('demo')
    expect(call<Proposal[]>('proposals.list').map((p) => p.proposal_id)).toEqual([1, 2, 3, 4, 5])
    const reviewed = await load('demo-reviewed')
    expect(reviewed<Proposal[]>('proposals.list')).toEqual([])
  })

  it('serves the same current facts as the real service', async () => {
    const call = await load('demo-reviewed')
    const facts = call<LedgerFact[]>('facts.current')
    const pick = (f: LedgerFact) => ({ id: f.fact_id, slot: `${f.object_id}.${f.attribute}`, value: f.value, n: f.n_changes, from: f.valid_from, quote: f.evidence[0]?.quote })
    const expected = snapshot.facts.map((f) => ({ id: f.fact_id, slot: `${f.object_id}.${f.attribute}`, value: f.value, n: f.n_changes, from: f.valid_from, quote: f.evidence[0]?.quote }))
    const order = (a: { id: number }, b: { id: number }) => a.id - b.id
    expect(facts.map(pick).sort(order)).toEqual(expected.sort(order))
  })

  it('computes the same brief as the real service', async () => {
    const call = await load('demo-reviewed')
    const brief = call<Brief>('brief')
    const key = (c: { object_id: string }) => c.object_id
    expect([...brief.open_commitments].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      [...snapshot.brief.open_commitments].sort((a, b) => key(a).localeCompare(key(b))))
    expect(brief.recent_changes).toEqual(snapshot.brief.recent_changes)
  })

  it('names meetings by their notes, with the dates of the demo notes', async () => {
    const call = await load('demo')
    const meetings = call<MeetingSummary[]>('meetings.list')
    expect(meetings.map((m) => m.meeting_id.split('/').pop())).toEqual([
      'Procurement pilot kick-off.md', 'Procurement pilot progress check.md', 'Procurement pilot pre-launch review.md'])
    expect(meetings.map((m) => m.occurred_at.slice(0, 10))).toEqual(['2026-09-14', '2026-09-28', '2026-10-12'])
    expect(JSON.stringify(call('facts.current'))).not.toMatch(/"meeting":"m\d"|Steering/)
  })

  it('answers the three example questions from the facts and history', async () => {
    const call = await load('demo-reviewed')
    const current = call<AskResult>('ask', { question: 'What is the current go-live date?' })
    expect(current).toMatchObject({ ok: true, answer: '2026-11-09' })
    const asOf = call<AskResult>('ask', { question: 'What was the pilot budget on 20 September?' })
    expect(asOf).toMatchObject({ ok: true, answer: 250000 })
    const changes = call<AskResult>('ask', { question: 'How many times did the go-live date change?' })
    expect(changes).toMatchObject({ ok: true, answer: 1 })
  })

  it('records a correction of the training owner and keeps the original quote', async () => {
    const call = await load('demo-reviewed')
    const before = call<LedgerFact[]>('facts.current').find((f) => f.object_id === 'training' && f.attribute === 'owner')
    expect(before?.value).toBe('aisha')
    call('facts.correct', { fact_id: before?.fact_id, value: 'raj', reason: 'Raj took over the training' })
    const after = call<LedgerFact[]>('facts.current').find((f) => f.object_id === 'training' && f.attribute === 'owner')
    expect(after).toMatchObject({ value: 'raj', corrects: before?.fact_id, correction: { reviewer: 'you', reason: 'Raj took over the training', replaced_fact_id: before?.fact_id } })
    const history = call<HistoryEntry[]>('facts.history', { object_id: 'training', attribute: 'owner' })
    expect(history.find((h) => h.fact_id === before?.fact_id)?.retracted?.reason).toBe('corrected: Raj took over the training')
    expect(history.filter((h) => h.value === 'aisha').every((h) => h.retracted)).toBe(true)
  })
})
