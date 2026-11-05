import type { VaultEntry } from '../types'
import { MOCK_NOW as now } from './mockNow'

// --- Bulk entry generator for large vault testing ---

const BULK_TYPES = ['Note', 'Project', 'Experiment', 'Responsibility', 'Procedure', 'Person', 'Event', 'Essay', 'Topic']
const BULK_ADJECTIVES = ['Quick', 'Advanced', 'Daily', 'Weekly', 'Annual', 'Draft', 'Final', 'Revised', 'Archived', 'New']
const BULK_NOUNS = ['Meeting', 'Strategy', 'Review', 'Plan', 'Analysis', 'Summary', 'Report', 'Guide', 'Checklist', 'Template', 'Framework', 'Workflow', 'Retrospective', 'Brainstorm', 'Proposal']
const BULK_SNIPPETS = [
  'Key findings from the latest analysis session.',
  'Notes on process improvements and next steps.',
  'Summary of decisions made during the review.',
  'Action items and follow-ups from discussion.',
  'Draft outline for upcoming deliverable.',
  'Reference material for the ongoing initiative.',
  'Tracking progress on quarterly objectives.',
  'Comparison of different approaches considered.',
]

export function generateBulkEntries(count: number): VaultEntry[] {
  const entries: VaultEntry[] = []
  for (let i = 0; i < count; i++) {
    const type = BULK_TYPES[i % BULK_TYPES.length]
    const adj = BULK_ADJECTIVES[i % BULK_ADJECTIVES.length]
    const noun = BULK_NOUNS[i % BULK_NOUNS.length]
    const title = `${adj} ${noun} ${i + 1}`
    const slug = title.toLowerCase().replace(/\s+/g, '-')
    entries.push({
      path: `/Users/luca/Laputa/${slug}.md`,
      filename: `${slug}.md`,
      title,
      isA: type,
      aliases: [],
      belongsTo: [],
      relatedTo: [],
      status: i % 4 === 0 ? 'Active' : i % 4 === 1 ? 'Paused' : i % 4 === 2 ? 'Done' : null,
      archived: false,
      modifiedAt: now - i * 600,
      createdAt: now - 86400 * 90 - i * 3600,
      fileSize: 500 + (i % 2000),
      snippet: BULK_SNIPPETS[i % BULK_SNIPPETS.length],
      wordCount: 50 + (i % 200),
      relationships: {},
      icon: null,
      color: null,
      order: null,
      outgoingLinks: Array.from({ length: i % 8 }, (_j, j) => `link-target-${(i + j) % 50}`),
      sidebarLabel: null,
      template: null, sort: null, view: null, visible: null,
      properties: {},
      organized: false, favorite: false, favoriteIndex: null, listPropertiesDisplay: [], hasH1: false,
    })
  }
  return entries
}
