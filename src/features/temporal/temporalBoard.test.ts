import { describe, expect, it } from 'vitest'
import { buildBoard, buildHistory, commitmentState, isCorrection, retractionOf, reviewerName, type BoardRow } from './temporalBoard'
import type { TemporalFact, TemporalHistoryFact, TemporalObject } from './temporalService'

const TODAY = '2026-11-02'
const objects: TemporalObject[] = [
  { object_id: 'vendor', label: 'Vendor', kind: 'decision', attributes: [{ name: 'outcome', type: 'enum', values: ['Alpha', 'Beta'] }] },
  { object_id: 'budget', label: 'Pilot budget (RM)', kind: 'decision', attributes: [{ name: 'amount', type: 'number' }] },
  { object_id: 'training', label: 'Staff training', kind: 'commitment', attributes: [
    { name: 'owner', type: 'text' }, { name: 'deadline', type: 'date' }, { name: 'status', type: 'enum', values: ['done', 'cancelled'] }] },
  { object_id: 'migration', label: 'Data migration', kind: 'commitment', attributes: [{ name: 'owner', type: 'text' }, { name: 'deadline', type: 'date' }] },
  { object_id: 'security', label: 'Security review', kind: 'commitment', attributes: [{ name: 'owner', type: 'text' }, { name: 'status', type: 'enum', values: ['done', 'cancelled'] }] },
  { object_id: 'risk', label: 'Supplier risk', kind: 'issue', attributes: [{ name: 'status', type: 'text' }] },
  { object_id: 'empty', label: 'Nothing recorded', kind: 'decision', attributes: [{ name: 'outcome', type: 'text' }] },
]
let id = 0
const fact = (object_id: string, attribute: string, value: TemporalFact['value'], extra: Partial<TemporalFact> = {}): TemporalFact => ({
  fact_id: ++id, object_id, attribute, value, label: object_id, evidence: [], valid_from: '2026-10-01', n_changes: 0, ...extra,
})
const row = (name: string, type: 'text' | 'date' | 'enum', value: TemporalFact['value']): BoardRow => ({ attribute: { name, type }, fact: fact('x', name, value) })

describe('buildBoard', () => {
  const facts = [
    fact('security', 'owner', 'Wei Ling'), fact('security', 'status', 'done'),
    fact('training', 'deadline', '2026-11-03'), fact('training', 'owner', 'Raj'),
    fact('budget', 'amount', 280000), fact('vendor', 'outcome', 'Beta'),
    fact('migration', 'owner', 'Wei Ling'), fact('migration', 'deadline', '2026-10-23'),
    fact('risk', 'status', 'open'), fact('gone', 'note', 12, { label: 'Removed item', kind: 'mystery' }),
  ]

  it('reads decisions, then commitments by urgency, then issues and anything else, leaving out items with no value', () => {
    const board = buildBoard(objects, facts, TODAY)
    expect(board.map(section => [section.title, section.items.map(item => item.title)])).toEqual([
      ['Decisions', ['Vendor', 'Pilot budget']],
      ['Commitments', ['Data migration', 'Staff training', 'Security review']],
      ['Issues', ['Supplier risk']],
      ['Other tracked items', ['Removed item']],
    ])
  })

  it('keeps one item per tracked object with its attributes in their defined order, and the unit from its label', () => {
    const board = buildBoard(objects, facts, TODAY)
    const training = board[1].items.find(item => item.objectId === 'training')!
    expect(training.rows.map(item => [item.attribute.name, item.fact.value])).toEqual([['owner', 'Raj'], ['deadline', '2026-11-03']])
    expect(board[0].items[1]).toMatchObject({ title: 'Pilot budget', unit: 'RM' })
    expect(board[3].items[0].rows[0].attribute).toEqual({ name: 'note', type: 'number' })
  })

  it('marks overdue, due soon and done commitments against today', () => {
    const states = Object.fromEntries(buildBoard(objects, facts, TODAY)[1].items.map(item => [item.title, item.state]))
    expect(states['Data migration']).toEqual({ tone: 'overdue', label: 'Overdue', due: '2026-10-23' })
    expect(states['Staff training']).toEqual({ tone: 'due-soon', label: 'Due tomorrow', due: '2026-11-03' })
    expect(states['Security review']).toEqual({ tone: 'done', label: 'Done', due: null })
  })

  it('leaves out withdrawn facts and drops empty sections', () => {
    expect(buildBoard(objects, [fact('vendor', 'outcome', 'Beta', { retracted: true })], TODAY)).toEqual([])
    expect(buildBoard(objects, [], TODAY)).toEqual([])
  })
})

describe('commitmentState', () => {
  it.each([
    [[row('deadline', 'date', '2026-11-01')], { tone: 'overdue', label: 'Overdue' }],
    [[row('deadline', 'date', '2026-11-02')], { tone: 'due-today', label: 'Due today' }],
    [[row('deadline', 'date', '2026-11-03')], { tone: 'due-soon', label: 'Due tomorrow' }],
    [[row('deadline', 'date', '2026-11-09')], { tone: 'due-soon', label: 'Due in 7 days' }],
    [[row('deadline', 'date', '2026-11-10')], { tone: 'open', label: null }],
    [[row('owner', 'text', 'Raj')], { tone: 'open', label: null }],
    [[row('deadline', 'date', '2026-10-01'), row('status', 'enum', 'done')], { tone: 'done', label: 'Done' }],
    [[row('deadline', 'date', '2026-10-01'), row('status', 'enum', 'Completed')], { tone: 'done', label: 'Done' }],
    [[row('status', 'enum', 'closed')], { tone: 'done', label: 'Closed' }],
    [[row('deadline', 'date', '2026-10-01'), row('status', 'enum', 'cancelled')], { tone: 'cancelled', label: 'Cancelled' }],
    [[row('status', 'enum', 'in progress'), row('deadline', 'date', '2026-10-01')], { tone: 'overdue', label: 'Overdue' }],
    [[row('handover', 'date', '2026-10-30')], { tone: 'overdue', label: 'Overdue' }],
    [[row('deadline', 'date', 'end of the month')], { tone: 'open', label: null }],
  ] as const)('reads %j as %j', (rows, expected) => {
    expect(commitmentState(rows as unknown as BoardRow[], TODAY)).toMatchObject(expected)
  })
})

describe('value history', () => {
  const first: TemporalHistoryFact = {
    fact_id: 1, object_id: 'vendor', label: 'Vendor', attribute: 'outcome', value: 'Alpha',
    claim_from: '2026-11-01T10:00:00Z', claim_to: null, decided_at: '2026-11-01T10:00:00Z',
    evidence: [{ quote: 'We choose Alpha.', speaker: 'Maya', meeting: 'one', audio_start: 0 }],
    corrects: null, retracted: null, change_type: 'INITIAL',
  }

  it('keeps every within-meeting change and reconfirmation, and pairs values only through replacement links', () => {
    const second = { ...first, fact_id: 2, value: 'Beta', supersedes: 1, decided_at: '2026-11-01T10:00:10Z', change_type: 'REVISE' }
    const confirmation = { ...second, fact_id: 3, supersedes: null, confirms: 2, decided_at: '2026-11-01T10:00:15Z', change_type: 'CONFIRM' }
    const current = { ...second, fact_id: 4, value: 'Gamma', supersedes: 2, decided_at: '2026-11-01T10:00:20Z' }
    const facts = [first, second, confirmation, current]
    expect(buildHistory(facts, 4).map(entry => [entry.fact.fact_id, entry.current, entry.reconfirmed, entry.replaced?.fact_id])).toEqual([
      [4, true, false, 2], [3, false, true, undefined], [2, false, false, 1], [1, false, false, undefined],
    ])
    expect(facts.map(fact => fact.fact_id)).toEqual([1, 2, 3, 4])
  })

  it('keeps the service order for tied decision times and puts corrections beside the original, preserving its evidence', () => {
    const withdrawn = { ...first, retracted: { by: 'Maya', reason: 'corrected: Misheard supplier' } }
    const corrected = { ...first, fact_id: 2, value: 'Beta', corrects: 1, confirms: 1, change_type: 'CORRECT',
      correction: { reviewer: 'Maya', reason: 'Misheard supplier', replaced_fact_id: 1 } }
    const result = buildHistory([withdrawn, corrected], 2)
    expect(result.map(entry => entry.fact.fact_id)).toEqual([2, 1])
    expect(result[0]).toMatchObject({ current: true, reconfirmed: false, replaced: withdrawn })
    expect(result[1].fact.evidence).toEqual(first.evidence)
    expect(buildHistory([withdrawn], 1)[0].current).toBe(false)
  })

  it.each([undefined, 99, 2, 3])('does not invent a previous value for a missing or invalid replacement link (%s)', supersedes => {
    const current = { ...first, fact_id: 2, value: 'Beta', supersedes, evidence: [{ quote: 'We change from Alpha to Beta.', speaker: 'Maya', meeting: 'one' }] }
    const unrelated = { ...first, fact_id: 3, object_id: 'another-vendor' }
    expect(buildHistory([first, current, unrelated], 2).find(entry => entry.current)?.replaced).toBeNull()
  })
})

describe('corrections and retractions', () => {
  it('tells a corrected value from one that was said', () => {
    expect(isCorrection({ corrects: 16 })).toBe(true)
    expect(isCorrection({ change_type: 'CORRECT' })).toBe(true)
    expect(isCorrection({ correction: { reviewer: 'user', reason: 'x', replaced_fact_id: 1 } })).toBe(true)
    expect(isCorrection({ corrects: null, change_type: 'INITIAL' })).toBe(false)
  })

  it('reads why a fact was withdrawn, as the ledger records it', () => {
    expect(retractionOf({ retracted: null })).toBeNull()
    expect(retractionOf({ retracted: false })).toBeNull()
    expect(retractionOf({ retracted: true })).toEqual({ corrected: false, reason: null })
    expect(retractionOf({ retracted: { tx: 1, by: 'user', reason: 'corrected: The chair said Raj will do it.' } }))
      .toEqual({ corrected: true, reason: 'The chair said Raj will do it.' })
    expect(retractionOf({ retracted: { by: 'user', reason: 'Never agreed' } })).toEqual({ corrected: false, reason: 'Never agreed' })
  })

  it('calls the person using the app "you"', () => {
    expect(reviewerName('user')).toBe('you')
    expect(reviewerName(null)).toBe('you')
    expect(reviewerName('  ')).toBe('you')
    expect(reviewerName('Maya')).toBe('Maya')
  })
})
