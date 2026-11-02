import { isCalendarDay, labelUnit } from './temporalFormat'
import type { TemporalAttribute, TemporalFact, TemporalHistoryFact, TemporalObject, TemporalRetraction } from './temporalService'

/*
 * The decision board: what is decided now and who owes what, read from the ledger's current facts. One item per tracked
 * object, its attributes as rows. Closed statuses and due-date names follow the brief in ask_facts.py (read only).
 */

export type CommitmentTone = 'overdue' | 'due-today' | 'due-soon' | 'open' | 'done' | 'cancelled'
export type SectionKind = 'decision' | 'commitment' | 'issue' | 'other'

export interface BoardRow {
  attribute: TemporalAttribute
  fact: TemporalFact
}

export interface BoardItem {
  objectId: string
  /** The label without a unit in brackets: "Pilot budget (RM)" is "Pilot budget". */
  title: string
  /** Written with the item's amounts: "RM 280,000". */
  unit: string | null
  kind: string
  rows: BoardRow[]
  /** Commitments only: whether it is done, overdue or still open. */
  state?: { tone: CommitmentTone; label: string | null; due: string | null }
}

export interface BoardSection {
  kind: SectionKind
  title: string
  items: BoardItem[]
}

const SECTION_TITLES: Record<SectionKind, string> = { decision: 'Decisions', commitment: 'Commitments', issue: 'Issues', other: 'Other tracked items' }
const DONE = new Map([['done', 'Done'], ['complete', 'Done'], ['completed', 'Done'], ['closed', 'Closed']])
const CANCELLED = new Set(['cancelled', 'canceled'])
const DUE_NAMES = ['deadline', 'due', 'due_date', 'duedate', 'date']
const RANK: Record<CommitmentTone, number> = { overdue: 0, 'due-today': 1, 'due-soon': 2, open: 3, done: 4, cancelled: 4 }
const SOON_DAYS = 7

/** Whole days from one calendar day (YYYY-MM-DD) to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function inferredAttribute(fact: TemporalFact): TemporalAttribute {
  return { name: fact.attribute, type: typeof fact.value === 'number' ? 'number' : 'text' }
}

function sectionKind(kind: string): SectionKind {
  return kind === 'decision' || kind === 'commitment' || kind === 'issue' ? kind : 'other'
}

/** Done, cancelled, overdue or open, judged against today (YYYY-MM-DD in the viewer's zone). */
export function commitmentState(rows: readonly BoardRow[], today: string): NonNullable<BoardItem['state']> {
  const status = rows.find(row => row.attribute.name.toLowerCase() === 'status')?.fact.value
  const dueRow = rows.find(row => DUE_NAMES.includes(row.attribute.name.toLowerCase()) && isCalendarDay(row.fact.value))
    ?? rows.find(row => row.attribute.type === 'date' && isCalendarDay(row.fact.value))
  const due = dueRow ? String(dueRow.fact.value).trim() : null
  const closed = typeof status === 'string' ? status.trim().toLowerCase() : ''
  if (DONE.has(closed)) return { tone: 'done', label: DONE.get(closed) ?? 'Done', due }
  if (CANCELLED.has(closed)) return { tone: 'cancelled', label: 'Cancelled', due }
  if (due && due < today) return { tone: 'overdue', label: 'Overdue', due }
  if (due && due === today) return { tone: 'due-today', label: 'Due today', due }
  const days = due ? daysBetween(today, due) : Number.NaN
  if (days > 0 && days <= SOON_DAYS) return { tone: 'due-soon', label: days === 1 ? 'Due tomorrow' : `Due in ${days} days`, due }
  return { tone: 'open', label: null, due }
}

/**
 * The board's sections in reading order: decisions, commitments (overdue first, then by due date, done last), issues, and
 * any kind the ledger no longer lists. Items with no current value are left out; empty sections are dropped.
 */
export function buildBoard(objects: readonly TemporalObject[], facts: readonly TemporalFact[], today: string): BoardSection[] {
  const byObject = new Map<string, TemporalFact[]>()
  for (const fact of facts) {
    if (fact.retracted) continue
    byObject.set(fact.object_id, [...(byObject.get(fact.object_id) ?? []), fact])
  }
  const known = new Map(objects.map(object => [object.object_id, object]))
  const order = [...objects.map(object => object.object_id).filter(id => byObject.has(id)), ...[...byObject.keys()].filter(id => !known.has(id))]
  const items = order.map((objectId): BoardItem => {
    const object = known.get(objectId)
    const current = byObject.get(objectId) ?? []
    const defined = object?.attributes ?? []
    const rows = [
      ...defined.flatMap(attribute => current.filter(fact => fact.attribute === attribute.name).slice(0, 1).map(fact => ({ attribute, fact }))),
      ...current.filter(fact => !defined.some(attribute => attribute.name === fact.attribute)).map(fact => ({ attribute: inferredAttribute(fact), fact })),
    ]
    const kind = object?.kind ?? current[0]?.kind ?? 'other'
    const { title, unit } = labelUnit(object?.label ?? current[0]?.label ?? objectId, rows.some(row => row.attribute.type === 'number'))
    return { objectId, title: title || objectId, unit, kind, rows, ...(kind === 'commitment' ? { state: commitmentState(rows, today) } : {}) }
  })
  const byUrgency = (a: { item: BoardItem; index: number }, b: { item: BoardItem; index: number }) =>
    RANK[a.item.state!.tone] - RANK[b.item.state!.tone] || (a.item.state!.due ?? '\uffff').localeCompare(b.item.state!.due ?? '\uffff') || a.index - b.index
  return (['decision', 'commitment', 'issue', 'other'] as const).map(kind => {
    const members = items.filter(item => sectionKind(item.kind) === kind)
    return { kind, title: SECTION_TITLES[kind], items: kind !== 'commitment' ? members
      : members.map((item, index) => ({ item, index })).sort(byUrgency).map(({ item }) => item) }
  }).filter(section => section.items.length)
}

/** Whether a value was set by a person's correction rather than by what was said in a meeting. */
export function isCorrection(fact: Pick<TemporalFact, 'corrects' | 'change_type' | 'correction'>): boolean {
  return fact.corrects != null || fact.change_type === 'CORRECT' || !!fact.correction
}

/** Why a fact was withdrawn: by a correction (its reason) or a retraction. Null while the fact stands. */
export function retractionOf(fact: Pick<TemporalHistoryFact, 'retracted'>): { corrected: boolean; reason: string | null } | null {
  const retracted = fact.retracted
  if (!retracted) return null
  const reason = typeof retracted === 'object' && typeof (retracted as TemporalRetraction).reason === 'string' ? (retracted as TemporalRetraction).reason!.trim() : ''
  const corrected = /^corrected:\s*/i.test(reason)
  return { corrected, reason: reason.replace(/^corrected:\s*/i, '') || null }
}

/** "you" for the person using the app (the ledger records them as "user"), otherwise the reviewer's name. */
export function reviewerName(reviewer: string | null | undefined): string {
  const name = typeof reviewer === 'string' ? reviewer.trim() : ''
  return !name || name.toLowerCase() === 'user' ? 'you' : name
}
