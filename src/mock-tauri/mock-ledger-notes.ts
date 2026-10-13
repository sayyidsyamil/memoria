import type { VaultEntry } from '../types'
import { DEMO_DATES, DEMO_NOTE_TEXT, DEMO_ROOT, DEMO_TITLES, demoMode } from './mock-ledger-demo'

const demo = demoMode() !== null
const ROOT = DEMO_ROOT
const NAMES = demo ? DEMO_TITLES : ['Steering 1 - Kick-off', 'Steering 2 - Vendor and budget', 'Steering 3 - Timeline', 'Steering 4 - Go-live check']
const DATES = demo ? DEMO_DATES : ['2026-09-14', '2026-09-28', '2026-10-12', '2026-10-12']

const LINES = [
  ['**Aisha** · 0:05', 'Welcome everyone. Let us start with the vendor and the go-live date.', '**Raj** · 0:40', 'Finance can commit the pilot budget once we agree on a vendor.'],
  ['**Aisha** · 0:05', 'After the demos, the decision is Beta Cloud.', '**Wei Ling** · 1:12', 'We need one more week, so go-live moves to the eighth of December.'],
  ['**Raj** · 0:30', 'After negotiation we settled the budget.', '**Wei Ling** · 2:30', 'Let us set go-live for the fifteenth of December.'],
  ['**Aisha** · 0:10', 'Quick check on the open promises before go-live.', '**Raj** · 0:50', 'Training is on track.'],
]

function content(index: number): string {
  if (demo) return DEMO_NOTE_TEXT[index]
  const body = LINES[index].reduce<string[]>((all, line, i) => (i % 2 === 0 ? [...all, `${line}\n${LINES[index][i + 1]}\n`] : all), [])
  return `---\ntype: Transcript\ndate: ${DATES[index]}T09:30:00\n---\n\n# ${NAMES[index]}\n\n> ${DATES[index]} · 3:00 · Aisha, Raj, Wei Ling\n\n## Transcript\n\n${body.join('\n')}`
}

export const MOCK_TRANSCRIPT_CONTENT: Record<string, string> = Object.fromEntries(NAMES.map((name, i) => [`${ROOT}/${name}.md`, content(i)]))

export const MOCK_TRANSCRIPT_ENTRIES: VaultEntry[] = NAMES.map((name, i) => ({
  path: `${ROOT}/${name}.md`, filename: `${name}.md`, title: name, isA: 'Transcript', aliases: [], belongsTo: [], relatedTo: [], status: null,
  archived: false, modifiedAt: Date.parse(DATES[i]) / 1000, createdAt: Date.parse(DATES[i]) / 1000, fileSize: 800,
  snippet: 'Welcome everyone. Let us start with the vendor and the go-live date.', wordCount: 120, relationships: {}, icon: null, color: null, order: null,
  sidebarLabel: null, template: null, sort: null, view: null, visible: null, outgoingLinks: [], properties: {},
  organized: false, favorite: false, favoriteIndex: null, listPropertiesDisplay: [], hasH1: true,
}))
