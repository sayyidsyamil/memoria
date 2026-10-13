import type { HistoryEntry, LedgerRegistry, MeetingSummary, Proposal } from '../lib/ledgerApi'
import kickoff from '../../src-tauri/resources/demo-vault/Procurement pilot kick-off.md?raw'
import progress from '../../src-tauri/resources/demo-vault/Procurement pilot progress check.md?raw'
import prelaunch from '../../src-tauri/resources/demo-vault/Procurement pilot pre-launch review.md?raw'
import snapshot from './mock-ledger-demo-snapshot.json'

// The real service output for the fictional procurement series (engine/results/demo/service_snapshot.json).
// localStorage['memoria:mock-ledger'] = 'demo' serves it with the review inbox as it was before anyone reviewed;
// 'demo-reviewed' serves the same facts with an empty inbox.
export const DEMO_ROOT = '/Users/luca/Laputa/transcripts'
export const DEMO_TITLES = ['Procurement pilot kick-off', 'Procurement pilot progress check', 'Procurement pilot pre-launch review']
export const DEMO_DATES = ['2026-09-14', '2026-09-28', '2026-10-12']
export const DEMO_NOTE_TEXT = [kickoff, progress, prelaunch]

export const demoMode = (): 'demo' | 'demo-reviewed' | null => {
  const value = typeof localStorage === 'undefined' ? null : localStorage.getItem('memoria:mock-ledger')
  return value === 'demo' || value === 'demo-reviewed' ? value : null
}

const notePath = (index: number) => `${DEMO_ROOT}/${DEMO_TITLES[index]}.md`

/** The engine names meetings m1, m2, m3; the app names them by note path. */
function withNotePaths<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (key, v) =>
    (key === 'meeting' || key === 'meeting_id') && typeof v === 'string' && /^m[1-3]$/.test(v) ? notePath(Number(v.slice(1)) - 1) : v) as T
}

export interface DemoSeed {
  registry: LedgerRegistry
  meetings: MeetingSummary[]
  proposals: Proposal[]
  history: Map<string, HistoryEntry[]>
}

export function demoSeed(): DemoSeed {
  const data = withNotePaths(snapshot) as unknown as {
    registry: LedgerRegistry
    meetings: MeetingSummary[]
    inbox: Proposal[]
    inbox_before_review: Proposal[]
    history: Record<string, HistoryEntry[]>
  }
  return {
    registry: data.registry,
    meetings: data.meetings,
    proposals: demoMode() === 'demo' ? data.inbox_before_review : data.inbox,
    history: new Map(Object.entries(data.history)),
  }
}
