import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { clockToSeconds, parseNoteDate, parseTranscriptNote } from './transcriptNote'

// Same shape as LiveTranscribePanel.buildMarkdown
const LIVE_NOTE = [
  '# Budget check', '',
  '> 13/10/2026, 22:41:00  ·  12:05  ·  Aisha, Wei Ling', '',
  '## Summary', '', '_Add a summary…_', '',
  '## Action items', '', '- [ ] ', '',
  '## Transcript', '',
  '**Aisha** · 0:00', 'Welcome everyone.', 'Let us start with the budget.', '',
  '**Wei Ling** · 1:23', 'The budget is 250,000 ringgit.', '',
  '**Aisha** · 61:05', 'Agreed.', '',
].join('\n')

const DEMO_DIR = '/Users/sayyid/Desktop/FYP/engine/data/demo'

describe('parseTranscriptNote', () => {
  it('reads title, speakers, clocks and merges continuation lines (live-recording shape)', () => {
    const parsed = parseTranscriptNote(LIVE_NOTE, { dayFirst: true })
    expect(parsed.title).toBe('Budget check')
    expect(parsed.occurredAt).toBe('2026-10-13T22:41:00Z')
    expect(parsed.turns).toEqual([
      { speaker: 'Aisha', text: 'Welcome everyone. Let us start with the budget.', start: 0 },
      { speaker: 'Wei Ling', text: 'The budget is 250,000 ringgit.', start: 83 },
      { speaker: 'Aisha', text: 'Agreed.', start: 3665 },
    ])
  })

  it('skips frontmatter and prefers the date line (with time) over a same-day frontmatter date', () => {
    const note = ['---', 'type: Transcript', 'date: 2026-11-02', '---', '# Progress', '', '> 02 Nov 2026, 09:30  ·  2:25  ·  Aisha', '', '## Transcript', '', '**Aisha** · 0:07', 'Hello.'].join('\n')
    const parsed = parseTranscriptNote(note)
    expect(parsed.title).toBe('Progress')
    expect(parsed.occurredAt).toBe('2026-11-02T09:30:00Z')
    expect(parsed.turns).toEqual([{ speaker: 'Aisha', text: 'Hello.', start: 7 }])
  })

  it('uses the frontmatter date when there is no date line', () => {
    const note = '---\ndate: 2026-03-02\n---\n# T\n\n## Transcript\n\n**Ali** · 0:01\nHi'
    expect(parseTranscriptNote(note).occurredAt).toBe('2026-03-02T00:00:00Z')
  })

  it('returns no date when the note has none', () => {
    expect(parseTranscriptNote('# T\n\n## Transcript\n\n**Ali** · 0:01\nHi').occurredAt).toBeUndefined()
  })

  it('returns no turns for an empty transcript or the no-speech placeholder', () => {
    expect(parseTranscriptNote('# T\n\n## Transcript\n').turns).toEqual([])
    expect(parseTranscriptNote('# T\n\n## Transcript\n\n_(no speech detected)_\n').turns).toEqual([])
    expect(parseTranscriptNote('').turns).toEqual([])
  })

  it('keeps speaker names exactly, including accents, apostrophes and symbols', () => {
    const note = '# T\n\n## Transcript\n\n**Nur Aisyah binti Ahmad** · 0:05\nSaya setuju.\n\n**O\'Brien & Sons (IT)** · 0:09\nOK — “fine”.\n\n**José** · 0:12\n日本語 テスト'
    expect(parseTranscriptNote(note).turns.map((t) => t.speaker)).toEqual(['Nur Aisyah binti Ahmad', "O'Brien & Sons (IT)", 'José'])
    expect(parseTranscriptNote(note).turns[1].text).toBe('OK — “fine”.')
    expect(parseTranscriptNote(note).turns[2].text).toBe('日本語 テスト')
  })

  it('handles turns without a clock, a trailing colon in the name and text on the speaker line', () => {
    const note = '# T\n\n## Transcript\n\n**Raj**\nNo clock here.\n\n**Aisha:** inline text\n'
    expect(parseTranscriptNote(note).turns).toEqual([
      { speaker: 'Raj', text: 'No clock here.' },
      { speaker: 'Aisha', text: 'inline text' },
    ])
  })

  it('stops at the next section and ignores summary text and bold words before the transcript', () => {
    const note = '# T\n\n**Important** summary words\n\n## Transcript\n\n**Raj** · 0:01\nOne.\n\n## Notes\n\n**Aisha** · 0:02\nNot part of it.\n'
    expect(parseTranscriptNote(note).turns).toEqual([{ speaker: 'Raj', text: 'One.', start: 1 }])
  })

  it('works without a Transcript heading by starting at the first speaker line', () => {
    const note = '# Standup\n\nSome intro text.\n\n**Raj** · 0:01\nOne.\n\n**Aisha** · 0:05\nTwo.'
    const parsed = parseTranscriptNote(note)
    expect(parsed.turns.map((t) => t.speaker)).toEqual(['Raj', 'Aisha'])
  })

  it('tolerates Windows line endings and attributes orphan text under the heading to Unknown', () => {
    const note = '# T\r\n\r\n## Transcript\r\n\r\nstray words\r\n\r\n**Raj** · 0:01\r\nHi\r\n'
    expect(parseTranscriptNote(note).turns).toEqual([
      { speaker: 'Unknown', text: 'stray words' },
      { speaker: 'Raj', text: 'Hi', start: 1 },
    ])
  })

  it.skipIf(!existsSync(`${DEMO_DIR}/meeting_3.md`))('parses all three demo meetings', () => {
    const parsed = [1, 2, 3].map((i) => parseTranscriptNote(readFileSync(`${DEMO_DIR}/meeting_${i}.md`, 'utf8')))
    for (const meeting of parsed) {
      expect(meeting.turns.length).toBeGreaterThan(10)
      expect(meeting.turns[0].speaker).toBe('Aisha')
      expect(meeting.turns[0].start).toBeTypeOf('number')
      expect(new Set(meeting.turns.map((t) => t.speaker))).toEqual(new Set(['Aisha', 'Raj', 'Wei Ling']))
      expect(meeting.turns.every((t) => t.text.length > 0 && !t.text.includes('**'))).toBe(true)
      expect(meeting.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T09:30:00Z$/)
    }
    expect(parsed.map((m) => m.title)).toEqual([
      'Procurement pilot kick-off', 'Procurement pilot progress check', 'Procurement pilot pre-launch review',
    ])
    const frontmatterDate = (i: number) => /^date: (\S+)/m.exec(readFileSync(`${DEMO_DIR}/meeting_${i}.md`, 'utf8'))?.[1]
    expect(parsed.map((m) => m.occurredAt?.slice(0, 10))).toEqual([1, 2, 3].map(frontmatterDate))
    expect(parsed.some((m) => m.turns.some((t) => t.text.includes('We go with Alpha Systems for the pilot')))).toBe(true)
  })
})

describe('clockToSeconds', () => {
  it.each([['0:00', 0], ['1:23', 83], ['12:05', 725], ['1:02:03', 3723], ['61:05', 3665], ['0:5', undefined], ['abc', undefined]])('%s -> %s', (input, expected) => {
    expect(clockToSeconds(input as string)).toBe(expected)
  })
})

describe('parseNoteDate', () => {
  it.each([
    ['2026-03-02', '2026-03-02T00:00:00Z'],
    ['2026-03-02T09:15:30Z', '2026-03-02T09:15:30Z'],
    ['2026-03-02 09:15', '2026-03-02T09:15:00Z'],
    ['02 Nov 2026, 09:30', '2026-11-02T09:30:00Z'],
    ['October 13, 2026 at 10:41 PM', '2026-10-13T22:41:00Z'],
    ['13/10/2026, 22:41:00', '2026-10-13T22:41:00Z'],
    ['10/13/2026, 10:41:00 PM', '2026-10-13T22:41:00Z'],
    ['13.10.2026 08:05', '2026-10-13T08:05:00Z'],
  ])('%s', (input, expected) => {
    expect(parseNoteDate(input)).toBe(expected)
  })

  it('uses the preferred order only for ambiguous dates', () => {
    expect(parseNoteDate('03/04/2026, 9:00:00 AM', { dayFirst: true })).toBe('2026-04-03T09:00:00Z')
    expect(parseNoteDate('03/04/2026, 9:00:00 AM', { dayFirst: false })).toBe('2026-03-04T09:00:00Z')
  })

  it('rejects impossible or unreadable dates', () => {
    expect(parseNoteDate('2026-02-31')).toBeUndefined()
    expect(parseNoteDate('yesterday')).toBeUndefined()
    expect(parseNoteDate('31 Foo 2026')).toBeUndefined()
  })

  it('treats 12 AM as midnight and 12 PM as noon', () => {
    expect(parseNoteDate('01/02/2026, 12:10:00 AM', { dayFirst: true })).toBe('2026-02-01T00:10:00Z')
    expect(parseNoteDate('01/02/2026, 12:10:00 PM', { dayFirst: true })).toBe('2026-02-01T12:10:00Z')
  })
})
