import { describe, expect, it } from 'vitest'
import type { IngestResult } from '../../lib/ledgerApi'
import { describeIngest, PARSE_WARNING, summariseIngest } from './ingestSummary'

const result = (counts: IngestResult['counts'], extra: Partial<IngestResult> = {}): IngestResult =>
  ({ meeting_id: 'x', stored_only: false, turns: 4, counts, items: [], seconds: 1, ...extra })

describe('describeIngest counts', () => {
  it('counts recorded, waiting for review and ignored separately', () => {
    expect(describeIngest(result({ applied: 3, proposed: 1, ungrounded: 2, invalid: 1, unresolved: 1 }))).toMatchObject({ recorded: 3, review: 1, ignored: 4, readCleanly: true })
  })

  it('treats a missing stats block as a clean read', () => {
    expect(describeIngest(result({ applied: 1 })).readCleanly).toBe(true)
    expect(describeIngest(result({ applied: 1 }, { stats: { parsed_cleanly: true } })).readCleanly).toBe(true)
  })

  it('counts any other status as ignored rather than losing it', () => {
    expect(describeIngest(result({ applied: 0, something_new: 2 })).ignored).toBe(2)
  })
})

describe('summariseIngest', () => {
  it('says how many were recorded, how many wait for review and how many were ignored', () => {
    expect(summariseIngest(result({ applied: 3, proposed: 1 }))).toBe('3 decisions and promises recorded, 1 waiting for your review, 0 ignored.')
    expect(summariseIngest(result({ applied: 1, proposed: 0 }))).toBe('1 decision or promise recorded, 0 waiting for your review, 0 ignored.')
  })

  it('gives each ignored status its own truthful reason', () => {
    const text = summariseIngest(result({ applied: 0, proposed: 0, ungrounded: 2, unresolved: 1, invalid: 3 }))
    expect(text).toContain('6 ignored.')
    expect(text).toContain('2 suggestions ignored because the quoted words were not found in the transcript')
    expect(text).toContain('1 suggestion ignored because it was not clear which tracked item it was about')
    expect(text).toContain('3 suggestions ignored because its value or date could not be understood')
  })

  it('does not blame a missing quote for invalid or unresolved suggestions', () => {
    const text = summariseIngest(result({ invalid: 1, unresolved: 1 }))
    expect(text).not.toContain('not found in the transcript')
  })

  it('warns, and does not sound successful, when the model answer could not be fully read', () => {
    const text = summariseIngest(result({ applied: 0, proposed: 0 }, { stats: { parsed_cleanly: false } }))
    expect(text.startsWith(PARSE_WARNING)).toBe(true)
    expect(PARSE_WARNING).toBe("The language model's answer could not be fully read for this meeting. Some decisions may be missing. You can add the meeting again later.")
    expect(text).toContain('Found so far: 0 decisions and promises recorded')
  })

  it('explains that nothing was read when the reader is off', () => {
    expect(summariseIngest(result({}, { stored_only: true }))).toMatch(/switched off/)
  })
})
