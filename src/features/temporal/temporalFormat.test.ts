import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { changeCount, changeSummary, describeQueryResult, meetingLabel, readableDate } from './temporalFormat'

describe('readableDate', () => {
  it('writes dates the way the locale does and keeps the exact value for the time element', () => {
    expect(readableDate('2026-10-10', { locale: 'en-GB' })).toEqual({ label: '10 Oct 2026', dateTime: '2026-10-10' })
    expect(readableDate('2026-10-10', { locale: 'en-US' })?.label).toBe('Oct 10, 2026')
    expect(readableDate('2026-10-10', { locale: 'de-DE' })?.label).toMatch(/^10\. Okt\.? 2026$/)
    expect(readableDate('2026-10-10T10:05:00Z', { locale: 'en-GB', timeZone: 'UTC' })).toEqual({ label: '10 Oct 2026', dateTime: '2026-10-10T10:05:00Z' })
  })

  it('adds the time of day only when asked and only to timestamps', () => {
    expect(readableDate('2026-10-10T15:05:00Z', { locale: 'en-GB', timeZone: 'UTC', time: true })?.label).toBe('10 Oct 2026, 15:05')
    expect(readableDate('2026-10-10T15:05:00Z', { locale: 'en-US', timeZone: 'UTC', time: true })?.label).toBe('Oct 10, 2026, 03:05 PM')
    expect(readableDate('2026-10-10', { locale: 'en-GB', time: true })?.label).toBe('10 Oct 2026')
  })

  it('shows an instant in the requested zone, so the day can differ from its UTC date', () => {
    expect(readableDate('2026-10-10T23:30:00Z', { locale: 'en-GB', timeZone: 'UTC' })?.label).toBe('10 Oct 2026')
    expect(readableDate('2026-10-10T23:30:00Z', { locale: 'en-GB', timeZone: 'Asia/Kuala_Lumpur' })?.label).toBe('11 Oct 2026')
    expect(readableDate('2026-10-10T23:30:00Z', { locale: 'en-GB', timeZone: 'Pacific/Pago_Pago', time: true })?.label).toBe('10 Oct 2026, 12:30')
  })

  it.each([
    ['2026-10-10T10:00:00+08:00'], ['2026-10-10T10:00:00+0800'], ['2026-10-10T10:00:00+08'], ['2026-10-10 10:00:00+08:00'],
    ['2026-10-10T10:00:00.123456+08:00'], ['2026-10-10t10:00+08:00'],
  ])('understands the zone designators and separators of %s', value => {
    expect(readableDate(value, { locale: 'en-GB', timeZone: 'UTC', time: true })).toEqual({ label: '10 Oct 2026, 02:00', dateTime: value })
  })

  it('accepts real calendar days only, including leap days', () => {
    expect(readableDate('2028-02-29', { locale: 'en-GB' })?.label).toBe('29 Feb 2028')
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
    expect(readableDate(' 2026-10-10 ', { locale: 'en-GB' })).toEqual({ label: '10 Oct 2026', dateTime: '2026-10-10' })
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
        expect(readableDate(value, { locale: 'en-GB' })?.label).toBe(label)
      }
    })

    it("shows an instant on the day it falls in the viewer's zone", () => {
      expect(readableDate('2026-10-10T23:30:00Z', { locale: 'en-GB', time: true })?.label).toBe(instant)
    })

    it('reads a timestamp without a zone as local time', () => {
      expect(readableDate('2026-10-10T10:00:00', { locale: 'en-GB', time: true })?.label).toBe('10 Oct 2026, 10:00')
    })
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
