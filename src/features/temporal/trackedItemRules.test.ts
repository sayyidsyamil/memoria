import { expect, it } from 'vitest'
import type { TemporalAttribute, TemporalFact, TemporalProposal } from './temporalService'
import { DEFAULT_ITEM_KIND, ITEM_KINDS, attributeEditProblem, isCalendarDate, isItemKind, kindLabel, recordedValues, typeLabel, type RecordedValue } from './trackedItemRules'

const recorded = (...values: unknown[]): RecordedValue[] => values.map(value => ({ value: value as RecordedValue['value'], pending: false }))
const suggested = (...values: unknown[]): RecordedValue[] => values.map(value => ({ value: value as RecordedValue['value'], pending: true }))
const number: TemporalAttribute = { name: 'budget', type: 'number' }
const text: TemporalAttribute = { name: 'budget', type: 'text' }
const status = (...values: string[]): TemporalAttribute => ({ name: 'status', type: 'enum', values })

it('lists exactly the kinds the ledger accepts for a new item, and starts on one of them', () => {
  // memoria_engine/ledger.py, Ledger._op_create_object: kind must be 'issue', 'decision' or 'commitment'.
  expect([...ITEM_KINDS].sort()).toEqual(['commitment', 'decision', 'issue'])
  expect(isItemKind(DEFAULT_ITEM_KIND)).toBe(true)
  expect(['decision', 'commitment', 'issue'].every(isItemKind)).toBe(true)
  // Kinds are case sensitive in the ledger, and the form used to offer "object", which it refuses.
  expect(['object', 'project', 'Decision', ' decision', ''].some(isItemKind)).toBe(false)
  expect(kindLabel('commitment')).toBe('Commitment')
  expect(kindLabel('project')).toBe('project')
})

it('names a list of allowed values a list, and other types as they are', () => {
  expect(typeLabel('enum')).toBe('list')
  expect(['text', 'number', 'date'].map(typeLabel)).toEqual(['text', 'number', 'date'])
})

it.each([
  ['2026-12-01', true], ['2024-02-29', true], ['2026-02-30', false], ['2026-13-01', false],
  ['2026-1-1', false], ['2026-12-01T10:00:00Z', false], ['December 1', false], ['', false], ['2025-02-29', false],
])('reads %j as a calendar date: %s', (text, expected) => expect(isCalendarDate(text)).toBe(expected))

it('has nothing to say about an attribute that is new, unchanged or holds nothing', () => {
  expect(attributeEditProblem(undefined, { name: 'budget', type: 'date' }, recorded(100))).toBeNull()
  expect(attributeEditProblem(number, number, recorded('not a number'))).toBeNull()
  expect(attributeEditProblem(number, { name: 'budget', type: 'date' }, [])).toBeNull()
  expect(attributeEditProblem(status('a', 'b'), status('b', 'a'), recorded('c'))).toBeNull()
})

const ofType = (type: TemporalAttribute['type']): TemporalAttribute => ({ name: 'budget', type })

// Whether a stored value is already in the form `Registry.normalise` (memoria_engine/pipeline.py) writes for the new type.
it.each([
  ['number', 'text', 100, false], ['number', 'text', 'Maya', true], ['number', 'date', 100, false], ['number', 'enum-list', 100, false],
  ['text', 'number', 100, true], ['text', 'number', '100', false],
  ['text', 'date', '2026-12-01', true], ['text', 'date', 'next week', false], ['text', 'date', '2026-02-30', false], ['text', 'date', '2026-12-01T10:00:00Z', false],
  ['date', 'text', '2026-12-01', true], ['date', 'number', '2026-12-01', false], ['enum', 'text', 'active', true], ['enum', 'number', 'active', false],
] as const)('moving a %s attribute to %s with the recorded value %j fits: %s', (from, to, value, fits) => {
  const next: TemporalAttribute = to === 'enum-list' ? status('100') : ofType(to)
  expect(attributeEditProblem(ofType(from), next, recorded(value)) === null).toBe(fits)
})

it('requires an enum to keep every recorded value on its list, in the spelling the ledger writes', () => {
  expect(attributeEditProblem(text, status('Maya', 'Sam'), recorded('Maya'))).toBeNull()
  expect(attributeEditProblem(text, status('Sam'), recorded('Maya'))).toMatch(/not fit the type "list": "Maya" \(recorded\)/)
  // The ledger would write "Active" for a new "active", so a stored "active" no longer reads as the same value.
  expect(attributeEditProblem(status('active'), status('Active', 'planned'), recorded('active'))).toMatch(/outside the allowed list: "active"/)
  expect(attributeEditProblem(status('planned', 'active'), status('planned', 'active', 'done'), recorded('active'))).toBeNull()
  expect(attributeEditProblem(status('planned', 'active'), status('planned'), recorded('planned'))).toBeNull()
  expect(attributeEditProblem(status('planned', 'active'), status('planned'), recorded('active'))).toBe('"status" still has values outside the allowed list: "active" (recorded). Keep them in the list, or first retract the recorded values.')
})

it('waits for the allowed values before judging a change to an enum', () => {
  expect(attributeEditProblem(text, status(), recorded('Maya'))).toBeNull()
  expect(attributeEditProblem(text, { name: 'budget', type: 'enum' }, recorded('Maya'))).toBeNull()
})

it('says what to do about each kind of value in the way', () => {
  expect(attributeEditProblem(number, text, recorded(100))).toBe('"budget" has values that would not fit the type "text": 100 (recorded). First retract the recorded values, or keep the type "number".')
  expect(attributeEditProblem(number, text, suggested(120))).toBe('"budget" has values that would not fit the type "text": 120 (suggestion). First reject the suggestions, or keep the type "number".')
  expect(attributeEditProblem(number, text, [...recorded(100), ...suggested(120)])).toBe('"budget" has values that would not fit the type "text": 100 (recorded), 120 (suggestion). First retract the recorded values and reject the suggestions, or keep the type "number".')
})

it('shows a few values, shortens a long one and counts the rest', () => {
  const long = 'x'.repeat(60)
  expect(attributeEditProblem(text, { name: 'budget', type: 'number' }, recorded(long))).toBe(`"budget" has values that would not fit the type "number": "${'x'.repeat(40)}…" (recorded). First retract the recorded values, or keep the type "text".`)
  expect(attributeEditProblem(text, { name: 'budget', type: 'number' }, recorded('a', 'b', 'c', 'd', 'e'))).toContain('"a" (recorded), "b" (recorded), "c" (recorded) and 2 more.')
  expect(attributeEditProblem(number, text, recorded({ nested: 1 }))).toContain('{"nested":1} (recorded)')
})

it('collects the current fact and the waiting suggestions of one attribute, and nothing else', () => {
  const fact = (patch: Partial<TemporalFact>): TemporalFact => ({ fact_id: 1, object_id: 'launch', label: 'Launch', attribute: 'budget', value: 100, evidence: [], valid_from: null, n_changes: 0, ...patch })
  const proposal = (patch: Partial<TemporalProposal>): TemporalProposal => ({ proposal_id: 1, object_id: 'launch', label: 'Launch', attribute: 'budget', value: 120, current_value: 100, quote: '', speaker: null, meeting: null, ...patch })
  const overview = {
    facts: [fact({}), fact({ fact_id: 2, attribute: 'owner', value: 'Maya' }), fact({ fact_id: 3, object_id: 'team' }), fact({ fact_id: 4, retracted: true, value: 90 }), fact({ fact_id: 5, value: null })],
    proposals: [proposal({}), proposal({ proposal_id: 2, attribute: 'owner' }), proposal({ proposal_id: 3, object_id: undefined }), proposal({ proposal_id: 4, value: null })],
  }
  expect(recordedValues(overview, 'launch', 'budget')).toEqual([{ value: 100, pending: false }, { value: 120, pending: true }])
  expect(recordedValues(overview, 'launch', 'owner')).toEqual([{ value: 'Maya', pending: false }, { value: 120, pending: true }])
  expect(recordedValues(overview, 'launch', 'missing')).toEqual([])
})
