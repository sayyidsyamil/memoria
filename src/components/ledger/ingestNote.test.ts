import { describe, expect, it, vi } from 'vitest'
import type { IngestResult } from '../../lib/ledgerApi'
import type { VaultEntry } from '../../types'
import { ingestNote, isNote, isTranscriptCandidate, meetingIdForNote, NoTranscriptError, summariseIngest } from './ingestNote'

const entry = (over: Partial<VaultEntry>): VaultEntry => ({ path: '/v/a.md', title: 'A', isA: null, archived: false, ...over }) as VaultEntry

const result = (counts: IngestResult['counts'], stored_only = false): IngestResult => ({ meeting_id: 'x', stored_only, turns: 4, counts, items: [], seconds: 1 })

describe('meetingIdForNote', () => {
  it('uses the path relative to the vault, tolerating a trailing slash', () => {
    expect(meetingIdForNote('/v/transcripts/a.md', '/v')).toBe('transcripts/a.md')
    expect(meetingIdForNote('/v/transcripts/a.md', '/v/')).toBe('transcripts/a.md')
  })

  it('keeps the full path for notes outside the vault', () => {
    expect(meetingIdForNote('/other/a.md', '/v')).toBe('/other/a.md')
    expect(meetingIdForNote('/vault2/a.md', '/v')).toBe('/vault2/a.md')
  })
})

describe('transcript candidates', () => {
  it('accepts Transcript and Meeting types or a transcripts folder', () => {
    expect(isTranscriptCandidate(entry({ isA: 'Transcript' }))).toBe(true)
    expect(isTranscriptCandidate(entry({ isA: ' meeting minutes ' }))).toBe(true)
    expect(isTranscriptCandidate(entry({ path: '/v/transcripts/x.md' }))).toBe(true)
    expect(isTranscriptCandidate(entry({ isA: 'Project' }))).toBe(false)
  })

  it('ignores archived notes and non-markdown files', () => {
    expect(isTranscriptCandidate(entry({ isA: 'Transcript', archived: true }))).toBe(false)
    expect(isNote(entry({ path: '/v/photo.png' }))).toBe(false)
    expect(isNote(entry({}))).toBe(true)
  })
})

describe('ingestNote', () => {
  const api = () => ({ ingestMeeting: vi.fn().mockResolvedValue(result({ applied: 1 })) })

  it('parses the note and sends turns, a stable id and the note date', async () => {
    const fake = api()
    const md = '---\ntype: Transcript\ndate: 2026-11-02\n---\n\n# T\n\n## Transcript\n\n**Aisha** · 0:05\nHello\n\n**Raj** · 1:00\nBudget is 250000.\n'
    await ingestNote({ api: fake as never, entry: entry({ path: '/v/t/a.md' }), vaultPath: '/v', readNote: async () => md })
    expect(fake.ingestMeeting).toHaveBeenCalledWith({
      meetingId: 't/a.md',
      turns: [{ speaker: 'Aisha', text: 'Hello', start: 5 }, { speaker: 'Raj', text: 'Budget is 250000.', start: 60 }],
      occurredAt: expect.stringMatching(/^2026-11-02/),
    })
  })

  it('falls back to today when the note has no date', async () => {
    const fake = api()
    await ingestNote({ api: fake as never, entry: entry({}), vaultPath: '/v', readNote: async () => '# T\n\n**Aisha** · 0:05\nHi\n', today: new Date('2026-12-01T08:30:00Z') })
    expect(fake.ingestMeeting.mock.calls[0][0].occurredAt).toBe('2026-12-01T08:30:00')
  })

  it('refuses a note without spoken lines, without calling the engine', async () => {
    const fake = api()
    await expect(ingestNote({ api: fake as never, entry: entry({ title: 'Plan' }), vaultPath: '/v', readNote: async () => '# Plan\n\nJust prose.' })).rejects.toBeInstanceOf(NoTranscriptError)
    expect(fake.ingestMeeting).not.toHaveBeenCalled()
  })
})

describe('summariseIngest', () => {
  it('says how many were recorded and how many wait for review', () => {
    expect(summariseIngest(result({ applied: 3, proposed: 1 }))).toBe('3 decisions and promises recorded, 1 waiting for your review.')
    expect(summariseIngest(result({ applied: 1, proposed: 0 }))).toBe('1 decision or promise recorded, 0 waiting for your review.')
  })

  it('mentions ignored suggestions that had no matching quote', () => {
    expect(summariseIngest(result({ applied: 0, proposed: 0, ungrounded: 2, invalid: 1 }))).toContain('3 suggestions ignored')
  })

  it('explains that nothing was read when the reader is off', () => {
    expect(summariseIngest(result({}, true))).toMatch(/switched off/)
  })
})
