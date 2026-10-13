import { describe, expect, it } from 'vitest'
import type { Brief } from './ledgerApi'
import { briefTitle, briefToMarkdown, briefToNoteMarkdown } from './ledgerBrief'
import { SAMPLE_REGISTRY } from './ledgerSampleRegistry'

const TODAY = new Date('2026-11-20T10:00:00Z')

const BRIEF: Brief = {
  open_commitments: [
    { object_id: 'training', label: 'Staff training', status: 'open', owner: 'raj', deadline: '2026-11-30' },
    { object_id: 'migration', label: 'Data migration', status: 'open' },
  ],
  recent_changes: [
    { label: 'Pilot budget (RM)', attribute: 'amount', from: 300000, to: 280000, decided_at: '2026-11-16T09:40:00', quote: 'We settled at 280 thousand.' },
  ],
  decisions: [],
  waiting_for_review: 2,
  meetings: 3,
}

describe('briefing markdown', () => {
  it('titles the note with the date', () => {
    expect(briefTitle(TODAY)).toBe('Meeting brief - 2026-11-20')
  })

  it('lists owners by name, dates in words and flags missing owner or date', () => {
    const md = briefToMarkdown(BRIEF, SAMPLE_REGISTRY, TODAY)
    expect(md).toContain('- **Staff training**: Raj, due 30 Nov 2026')
    expect(md).toContain('- **Data migration**: nobody named yet, due no due date')
  })

  it('shows what changed with the old value, new value and the quote', () => {
    const md = briefToMarkdown(BRIEF, SAMPLE_REGISTRY, TODAY)
    expect(md).toContain('280,000')
    expect(md).toContain('300,000 -> 280,000 on 16 Nov 2026')
    expect(md).toContain('> "We settled at 280 thousand."')
    expect(md).toContain('2 suggested changes are still waiting for your review.')
  })

  it('uses plain empty-state sentences', () => {
    const md = briefToMarkdown({ ...BRIEF, open_commitments: [], recent_changes: [], waiting_for_review: 0 }, SAMPLE_REGISTRY, TODAY)
    expect(md).toContain('_No open commitments._')
    expect(md).toContain('_Nothing has changed yet._')
    expect(md).not.toContain('waiting for your review')
  })

  it('wraps the note in Brief frontmatter so it appears under Briefs', () => {
    expect(briefToNoteMarkdown('# Hi\n')).toBe('---\ntype: Brief\n---\n\n# Hi\n')
  })
})
