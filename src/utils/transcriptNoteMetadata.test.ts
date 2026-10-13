import { describe, expect, it } from 'vitest'
import { parseTranscriptNote } from '../lib/transcriptNote'
import { localWallClock, withTranscriptNoteMetadata } from './transcriptNoteMetadata'

const NOW = new Date(2026, 10, 2, 9, 5, 7)

describe('withTranscriptNoteMetadata', () => {
  it('formats local wall-clock time without a timezone', () => {
    expect(localWallClock(NOW)).toBe('2026-11-02T09:05:07')
  })

  it('adds type and date frontmatter that the transcript parser reads back', () => {
    const note = withTranscriptNoteMetadata('# Kick-off\n\n## Transcript\n\n**Aisha** · 0:05\nWelcome.\n', NOW)
    expect(note.startsWith('---\ntype: Transcript\ndate: 2026-11-02T09:05:07\n---\n\n# Kick-off')).toBe(true)
    const parsed = parseTranscriptNote(note)
    expect(parsed.occurredAt?.startsWith('2026-11-02')).toBe(true)
    expect(parsed.turns).toEqual([{ speaker: 'Aisha', text: 'Welcome.', start: 5 }])
  })

  it('leaves notes that already have frontmatter untouched', () => {
    const existing = '---\ntype: Meeting\n---\n\n# Mine\n'
    expect(withTranscriptNoteMetadata(existing, NOW)).toBe(existing)
  })
})
