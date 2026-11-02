import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  attributeLabel, changeCount, changeSummary, changedTimes, describeQueryResult, formatAmount, formatValue, ingestSummary, isCalendarDay,
  itemLabel, labelUnit, localDay, meetingLabel, plainLedgerError, readableDate,
} from './temporalFormat'

describe('readableDate', () => {
  it('writes every date in the one Memoria style and keeps the exact value for the time element', () => {
    expect(readableDate('2026-10-10')).toEqual({ label: '10 Oct 2026', dateTime: '2026-10-10' })
    expect(readableDate('2026-11-09')?.label).toBe('9 Nov 2026')
    // Some engines write September as "Sept"; Memoria never does.
    expect(readableDate('2026-09-28')?.label).toBe('28 Sep 2026')
    expect(readableDate('2026-10-10T10:05:00Z', { timeZone: 'UTC' })).toEqual({ label: '10 Oct 2026', dateTime: '2026-10-10T10:05:00Z' })
  })

  it('adds the time of day only when asked and only to timestamps, on a 24-hour clock', () => {
    expect(readableDate('2026-10-10T15:05:00Z', { timeZone: 'UTC', time: true })?.label).toBe('10 Oct 2026, 15:05')
    expect(readableDate('2026-10-12T01:30:45Z', { timeZone: 'Asia/Kuala_Lumpur', time: true })?.label).toBe('12 Oct 2026, 09:30')
    expect(readableDate('2026-10-10T00:05:00Z', { timeZone: 'UTC', time: true })?.label).toBe('10 Oct 2026, 00:05')
    expect(readableDate('2026-10-10', { time: true })?.label).toBe('10 Oct 2026')
  })

  it('shows an instant in the requested zone, so the day can differ from its UTC date', () => {
    expect(readableDate('2026-10-10T23:30:00Z', { timeZone: 'UTC' })?.label).toBe('10 Oct 2026')
    expect(readableDate('2026-10-10T23:30:00Z', { timeZone: 'Asia/Kuala_Lumpur' })?.label).toBe('11 Oct 2026')
    expect(readableDate('2026-10-10T23:30:00Z', { timeZone: 'Pacific/Pago_Pago', time: true })?.label).toBe('10 Oct 2026, 12:30')
  })

  it.each([
    ['2026-10-10T10:00:00+08:00'], ['2026-10-10T10:00:00+0800'], ['2026-10-10T10:00:00+08'], ['2026-10-10 10:00:00+08:00'],
    ['2026-10-10T10:00:00.123456+08:00'], ['2026-10-10t10:00+08:00'],
  ])('understands the zone designators and separators of %s', value => {
    expect(readableDate(value, { timeZone: 'UTC', time: true })).toEqual({ label: '10 Oct 2026, 02:00', dateTime: value })
  })

  it('accepts real calendar days only, including leap days', () => {
    expect(readableDate('2028-02-29')?.label).toBe('29 Feb 2028')
    for (const value of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-02-30T10:00:00Z']) {
      expect(readableDate(value)).toBeNull()
    }
  })

  it.each([
    [''], ['  '], ['yesterday'], ['2026'], ['2026-10'], ['10/10/2026'], ['Oct 10, 2026'], ['2026-10-10T25:00:00Z'],
    ['2026-10-10T10:61:00Z'], ['2026-10-10T10:00:60Z'], ['2026-10-10T10:00:00Z extra'], ['20261010'],
  ])('leaves %j for the caller to show as written', value => {
    expect(readableDate(value)).toBeNull()
  })

  it('ignores surrounding whitespace and values that are not text', () => {
    expect(readableDate(' 2026-10-10 ')).toEqual({ label: '10 Oct 2026', dateTime: '2026-10-10' })
    expect(readableDate(20261010 as unknown as string)).toBeNull()
    expect(readableDate(null as unknown as string)).toBeNull()
  })

  // Calendar dates are days, not instants. Reading '2026-10-10' as UTC midnight and formatting it in the viewer's zone
  // moves it to the 9th west of Greenwich; the offsets below prove that each zone switch really took effect.
  describe.each([
    ['Pacific/Pago_Pago', 660, '10 Oct 2026, 12:30'],
    ['America/Los_Angeles', 420, '10 Oct 2026, 16:30'],
    ['UTC', 0, '10 Oct 2026, 23:30'],
    ['Asia/Kuala_Lumpur', -480, '11 Oct 2026, 07:30'],
    ['Pacific/Kiritimati', -840, '11 Oct 2026, 13:30'],
  ])('in %s', (zone, offset, instant) => {
    const original = process.env.TZ
    beforeAll(() => { process.env.TZ = zone })
    afterAll(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original })

    it('keeps a calendar date on its own day', () => {
      expect(new Date(2026, 9, 10).getTimezoneOffset()).toBe(offset)
      if (offset > 0) expect(new Date('2026-10-10').getDate()).toBe(9)
      for (const [value, label] of [['2026-10-10', '10 Oct 2026'], ['2026-01-01', '1 Jan 2026'], ['2026-12-31', '31 Dec 2026'], ['2026-03-01', '1 Mar 2026']]) {
        expect(readableDate(value)?.label).toBe(label)
      }
    })

    it("shows an instant on the day it falls in the viewer's zone", () => {
      expect(readableDate('2026-10-10T23:30:00Z', { time: true })?.label).toBe(instant)
    })

    it('reads a timestamp without a zone as local time', () => {
      expect(readableDate('2026-10-10T10:00:00', { time: true })?.label).toBe('10 Oct 2026, 10:00')
    })
  })
})

describe('localDay and isCalendarDay', () => {
  it("names today's calendar day in the viewer's zone", () => {
    expect(localDay(new Date(2026, 10, 2, 23, 59))).toBe('2026-11-02')
    expect(localDay(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
  })

  it('recognises real calendar days only', () => {
    expect(isCalendarDay('2026-11-03')).toBe(true)
    expect(isCalendarDay(' 2026-11-03 ')).toBe(true)
    for (const value of ['2026-02-30', '3 Nov 2026', '2026-11-03T10:00:00Z', 20261103, null, undefined]) expect(isCalendarDay(value as string)).toBe(false)
  })
})

describe('values', () => {
  it('takes a unit in brackets off the label of an item that holds a number', () => {
    expect(labelUnit('Pilot budget (RM)', true)).toEqual({ title: 'Pilot budget', unit: 'RM' })
    expect(labelUnit('Headcount (people)', true)).toEqual({ title: 'Headcount', unit: 'people' })
    expect(labelUnit('Vendor (final)', false)).toEqual({ title: 'Vendor (final)', unit: null })
    expect(labelUnit('Phase (2)', true)).toEqual({ title: 'Phase (2)', unit: null })
    expect(labelUnit('  Go-live date ', true)).toEqual({ title: 'Go-live date', unit: null })
  })

  it.each([
    [280000, 'RM', 'RM 280,000'], [2500, '$', '$2,500'], [1250000, 'USD', 'USD 1,250,000'], [12, 'days', '12 days'],
    [40, '%', '40%'], [1234.5, null, '1,234.5'], [280000, null, '280,000'],
  ] as const)('writes %s with the unit %s as %s', (value, unit, text) => {
    expect(formatAmount(value, unit)).toBe(text)
  })

  it('writes each kind of value as people read it', () => {
    expect(formatValue(280000, 'number', 'RM')).toBe('RM 280,000')
    expect(formatValue(280000, undefined)).toBe('280,000')
    expect(formatValue(100, 'text')).toBe('100')
    expect(formatValue('2026-11-09', 'date')).toBe('9 Nov 2026')
    expect(formatValue('next spring', 'date')).toBe('next spring')
    expect(formatValue('2026-11-09', 'text')).toBe('2026-11-09')
    expect(formatValue('done', 'enum')).toBe('Done')
    expect(formatValue('Beta Cloud', 'enum')).toBe('Beta Cloud')
    expect(formatValue('raj', 'text')).toBe('raj')
    expect(formatValue(null, 'text')).toBe('Not recorded')
    expect(formatValue({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('names attributes in plain words', () => {
    expect(attributeLabel('deadline')).toBe('Due')
    expect(attributeLabel('due_date')).toBe('Due')
    expect(attributeLabel('owner')).toBe('Owner')
    expect(attributeLabel('go_live')).toBe('Go live')
    expect(attributeLabel('outcome')).toBe('Outcome')
  })

  it.each([[0, ''], [1, 'changed 1×'], [3, 'changed 3×'], [Number.NaN, ''], [-1, ''], [1.5, '']])('writes %s changes as %j', (count, text) => {
    expect(changedTimes(count)).toBe(text)
  })
})

describe('ledger messages', () => {
  it('says what reading a meeting found, in words', () => {
    expect(ingestSummary({ proposed: 7 })).toBe('7 suggestions to review.')
    expect(ingestSummary({ proposed: 1 })).toBe('1 suggestion to review.')
    expect(ingestSummary({ proposed: 4, invalid: 1 })).toBe('4 suggestions to review · 1 skipped: not a value the item allows.')
    expect(ingestSummary({ ungrounded: 2, proposed: 0 })).toBe('2 skipped: quote not found in the transcript.')
    expect(ingestSummary({ some_status: 1 })).toBe('1 skipped: some status.')
    expect(ingestSummary({})).toBe('No suggestions found in this meeting.')
    expect(ingestSummary(undefined)).toBe('No suggestions found in this meeting.')
  })

  it('puts refusals in plain words, without the ledger’s ids', () => {
    expect(plainLedgerError('proposal 8 was made against a belief that has since changed')).toMatch(/^This suggestion is out of date/)
    expect(plainLedgerError('proposal 8 was made against a belief that has since changed')).not.toMatch(/\d/)
    expect(plainLedgerError('proposal 3 has already been reviewed')).toBe('This suggestion was already reviewed. Refresh to see the board as it is.')
    expect(plainLedgerError('Ledger unavailable')).toBe('Ledger unavailable')
  })
})

describe('change counts', () => {
  it.each([[0, 'no changes'], [1, '1 change'], [2, '2 changes'], [12, '12 changes']])('writes %i as "%s"', (count, text) => {
    expect(changeCount(count)).toBe(text)
  })

  it.each([[Number.NaN], [-1], [1.5], [Number.POSITIVE_INFINITY], [undefined as unknown as number]])('writes nothing for the unusable count %s', count => {
    expect(changeCount(count)).toBe('')
  })

  it.each([[0, 'No changes recorded'], [1, 'Changed once'], [2, 'Changed twice'], [3, 'Changed 3 times'], [12, 'Changed 12 times']])('answers %i with "%s"', (count, text) => {
    expect(changeSummary(count)).toBe(text)
  })
})

describe('itemLabel', () => {
  const objects = [{ object_id: 'pilot', label: 'Pilot' }, { object_id: 'padded', label: '  Launch project  ' }, { object_id: 'blank', label: '   ' }]

  it('names a tracked item by its label rather than its id', () => {
    expect(itemLabel('pilot', objects)).toBe('Pilot')
    expect(itemLabel('padded', objects)).toBe('Launch project')
  })

  it('falls back to the id when the registry is unknown, lacks the item or holds no usable label', () => {
    expect(itemLabel('pilot', undefined)).toBe('pilot')
    expect(itemLabel('pilot', [])).toBe('pilot')
    expect(itemLabel('missing', objects)).toBe('missing')
    expect(itemLabel('blank', objects)).toBe('blank')
    expect(itemLabel('pilot', [{ object_id: 'pilot', label: undefined as unknown as string }])).toBe('pilot')
  })

  it('matches ids exactly, as the ledger does', () => {
    const programme = [{ object_id: 'pilot', label: 'The pilot programme' }]
    expect(itemLabel('pilot', programme)).toBe('The pilot programme')
    expect(itemLabel('Pilot', programme)).toBe('Pilot')
    expect(itemLabel(' pilot', programme)).toBe(' pilot')
  })
})

describe('meetingLabel', () => {
  const titles = new Map([['3f2a8c1e-5b7d-4e9a-8c3f-1a2b3c4d5e6f', 'Pilot review'], ['blank', '   ']])

  it('prefers the meeting title', () => {
    expect(meetingLabel('3f2a8c1e-5b7d-4e9a-8c3f-1a2b3c4d5e6f', titles)).toBe('Pilot review')
  })

  it('falls back to a short labelled id when the title is unknown or blank', () => {
    expect(meetingLabel('9d41b7a2-6c0e-4f58-b1d3-7e2f9a8c5b04', titles)).toBe('Meeting 9d41…')
    expect(meetingLabel('9d41b7a2-6c0e-4f58-b1d3-7e2f9a8c5b04', new Map())).toBe('Meeting 9d41…')
    expect(meetingLabel('blank', titles)).toBe('Meeting blan…')
    expect(meetingLabel('a1b2', titles)).toBe('Meeting a1b2')
  })

  it('says so when no meeting was recorded', () => {
    expect(meetingLabel(null, titles)).toBe('Meeting not recorded')
    expect(meetingLabel(undefined, titles)).toBe('Meeting not recorded')
    expect(meetingLabel('', titles)).toBe('Meeting not recorded')
    expect(meetingLabel('   ', titles)).toBe('Meeting not recorded')
    expect(meetingLabel(7 as unknown as string, titles)).toBe('Meeting not recorded')
  })
})

describe('describeQueryResult', () => {
  const quote = { quote: 'We agreed on a budget of 100.', speaker: 'Maya', meeting: 'm1', audio_start: 65 }

  it('reduces a value answer to the value, when it was decided and its citations', () => {
    expect(describeQueryResult({
      type: 'current', answer: 100, decided_at: '2026-11-01T10:00:12Z',
      evidence: [{ ...quote, char_start: 0, char_end: 29, confidence: 0.9, extractor: 'workspace-qwen' }],
    }, 'current')).toEqual({ kind: 'value', value: 100, decidedAt: '2026-11-01T10:00:12Z', evidence: [quote] })
  })

  it('keeps an empty answer so the panel can say that nothing was recorded', () => {
    expect(describeQueryResult({ type: 'as_of_valid', answer: null, evidence: [] }, 'as_of_valid')).toEqual({ kind: 'value', value: null, decidedAt: null, evidence: [] })
  })

  it('turns a count into a number and drops the repeated citations of every version', () => {
    const view = describeQueryResult({
      type: 'n_changes', answer: 1,
      evidence: [quote, { ...quote, quote: 'Now 120.', audio_start: 12.5 }, { ...quote, extra: true }],
      history: [{ fact_id: 1 }, { fact_id: 2 }],
    }, 'n_changes')
    expect(view).toEqual({ kind: 'changes', count: 1, evidence: [quote, { ...quote, quote: 'Now 120.', audio_start: 12.5 }] })
  })

  it.each([[null], ['3'], [-1], [1.5]])('treats the count %j as an ordinary value', answer => {
    expect(describeQueryResult({ type: 'n_changes', answer, evidence: [] }, 'n_changes')).toMatchObject({ kind: 'value', value: answer })
  })

  it('only treats the answer as a count for a count query', () => {
    expect(describeQueryResult({ type: 'current', answer: 3, evidence: [] }, 'current')).toMatchObject({ kind: 'value', value: 3 })
  })

  it('copes with incomplete evidence', () => {
    const view = describeQueryResult({ answer: 'x', evidence: [{ quote: null, meeting: 7 }, 'oops', null, [], { speaker: 'Maya' }] }, 'current')
    expect(view).toEqual({ kind: 'value', value: 'x', decidedAt: null, evidence: [
      { quote: '', speaker: null, meeting: null, audio_start: null },
      { quote: '', speaker: 'Maya', meeting: null, audio_start: null },
    ] })
    expect(describeQueryResult({ answer: 'x', evidence: 'none' }, 'current')).toMatchObject({ evidence: [] })
    expect(describeQueryResult({ answer: 'x' }, 'current')).toMatchObject({ evidence: [] })
  })

  it.each([[80], ['text'], [null], [true], [['a']], [{ surprise: 1 }], [{ evidence: [] }]])('keeps the unfamiliar result %j for inspection', raw => {
    expect(describeQueryResult(raw, 'current')).toEqual({ kind: 'unknown', raw })
  })
})
