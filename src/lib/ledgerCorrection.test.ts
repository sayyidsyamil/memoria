import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from './ledgerApi'
import { correctionBanner, correctionOf, correctionSummary, needsHistoryForCorrection, wasCorrectedAway } from './ledgerCorrection'

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  fact_id: 1, object_id: 'golive', attribute: 'date', label: 'Go-live date', value: '2026-12-01', claim_from: null, claim_to: null, decided_at: null,
  change_type: 'INITIAL', supersedes: null, confirms: null, corrects: null, retracted: null, evidence: [], ...over,
})

const OLD = entry({ fact_id: 3, retracted: { tx: 9, by: 'Aisha', reason: 'corrected: The year was wrong' } })

describe('correctionOf', () => {
  it('reads the new shape straight from the value', () => {
    const fact = entry({ fact_id: 4, correction: { reviewer: 'Raj', reason: 'Misheard', replaced_fact_id: 3 } })
    expect(correctionOf(fact, null)).toEqual({ reviewer: 'Raj', reason: 'Misheard', replacedFactId: 3 })
    expect(needsHistoryForCorrection(fact)).toBe(false)
  })

  it('reads the old shape from the replaced fact\'s retraction', () => {
    const fact = entry({ fact_id: 4, corrects: 3 })
    expect(needsHistoryForCorrection(fact)).toBe(true)
    expect(correctionOf(fact, [OLD, fact])).toEqual({ reviewer: 'Aisha', reason: 'The year was wrong', replacedFactId: 3 })
  })

  it('still says it was corrected when the replaced fact cannot be found', () => {
    expect(correctionOf(entry({ corrects: 3 }), [])).toEqual({ reviewer: 'someone', reason: '', replacedFactId: 3 })
  })

  it('returns nothing for a value nobody corrected', () => {
    expect(correctionOf(entry({}), [OLD])).toBeNull()
    expect(needsHistoryForCorrection(entry({}))).toBe(false)
  })

  it('prefers the new shape when both are present', () => {
    const fact = entry({ fact_id: 4, corrects: 3, correction: { reviewer: 'Raj', reason: 'New', replaced_fact_id: 3 } })
    expect(correctionOf(fact, [OLD, fact])?.reviewer).toBe('Raj')
  })
})

describe('correction wording', () => {
  it('builds the banner and the timeline step', () => {
    const c = { reviewer: 'Aisha', reason: 'The year was wrong', replacedFactId: 3 }
    expect(correctionSummary(c)).toBe('Corrected by Aisha: The year was wrong')
    expect(correctionBanner(c)).toBe('Corrected by Aisha: The year was wrong. The quote below is the original one and supports the earlier value.')
  })

  it('does not double the full stop or print an empty reason', () => {
    expect(correctionBanner({ reviewer: 'Aisha', reason: 'Wrong year.', replacedFactId: 3 })).toMatch(/^Corrected by Aisha: Wrong year\. The quote/)
    expect(correctionBanner({ reviewer: 'Aisha', reason: '', replacedFactId: 3 })).toMatch(/^Corrected by Aisha\. The quote/)
  })

  it('recognises a value that was set aside by a correction', () => {
    expect(wasCorrectedAway(OLD)).toBe(true)
    expect(wasCorrectedAway(entry({ retracted: { tx: 1, by: 'Aisha', reason: 'Not agreed' } }))).toBe(false)
    expect(wasCorrectedAway(entry({}))).toBe(false)
  })
})
