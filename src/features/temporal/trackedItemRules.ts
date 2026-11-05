import type { TemporalAttribute, TemporalFact, TemporalProposal, TemporalValue } from './temporalService'

/*
 * What the setup form may offer. The preserved ledger engine is the authority and re-checks every request; these rules only
 * keep the form from offering an edit it is known to refuse. They come from `memoria_engine` (read only):
 * - `Ledger._op_create_object` (ledger.py): a new item's kind must be `issue`, `decision` or `commitment`, and an item that
 *   already exists keeps the exact label and kind it was created with. `Registry.install` (pipeline.py) runs it for every item.
 * - `Registry.normalise` (pipeline.py): how a value of each attribute type is written, which decides whether a recorded value
 *   still fits a changed type. The ledger itself accepts a changed type or allowed-value list without looking at recorded values.
 */

/** Kinds the ledger accepts for a new item. */
export const ITEM_KINDS = ['decision', 'commitment', 'issue'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

export const DEFAULT_ITEM_KIND: ItemKind = 'decision'

const KIND_LABELS: Record<ItemKind, string> = { decision: 'Decision', commitment: 'Commitment', issue: 'Issue' }

export function isItemKind(kind: string): kind is ItemKind {
  return (ITEM_KINDS as readonly string[]).includes(kind)
}

/** A kind as the form words it; a kind the ledger no longer lists is shown as stored. */
export function kindLabel(kind: string): string {
  return isItemKind(kind) ? KIND_LABELS[kind] : kind
}

/** An attribute type as the form words it: an `enum` is a list of allowed values. */
export function typeLabel(type: string): string {
  return type === 'enum' ? 'list' : type
}

/** A real calendar day written YYYY-MM-DD, the only form in which the ledger writes a date value. */
export function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const time = Date.parse(text)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text
}

/** A value the ledger holds, or has been offered, for one attribute. A suggestion has not been approved yet. */
export interface RecordedValue {
  value: TemporalValue
  pending: boolean
}

/**
 * The values the overview shows for an attribute: its current fact and any suggestions waiting for approval.
 * Past values live in the fact history, which the overview does not carry, so the ledger remains the final check.
 */
export function recordedValues(overview: { facts: readonly TemporalFact[]; proposals: readonly TemporalProposal[] }, objectId: string, attribute: string): RecordedValue[] {
  return [
    ...overview.facts.filter(fact => fact.object_id === objectId && fact.attribute === attribute && !fact.retracted).map(fact => ({ value: fact.value, pending: false })),
    ...overview.proposals.filter(proposal => proposal.object_id === objectId && proposal.attribute === attribute).map(proposal => ({ value: proposal.value, pending: true })),
  ].filter(item => item.value != null)
}

/** Whether a stored value is already in the form `Registry.normalise` would write for the attribute, so that nothing reads as a change. */
function fits(value: TemporalValue, { type, values = [] }: Pick<TemporalAttribute, 'type' | 'values'>): boolean {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'date') return typeof value === 'string' && isCalendarDate(value)
  if (type === 'enum') return typeof value === 'string' && values.includes(value)
  return typeof value === 'string'
}

function sameValues(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every(value => second.includes(value))
}

const MOST_SHOWN = 3
const LONGEST_VALUE = 40

function valueText(value: TemporalValue): string {
  if (typeof value !== 'string') return JSON.stringify(value)
  return `"${value.length > LONGEST_VALUE ? `${value.slice(0, LONGEST_VALUE)}…` : value}"`
}

/**
 * Why an edit to an existing attribute would leave recorded values that no longer fit, or null when it is safe to offer.
 * The ledger would accept such an edit and leave the old values as they were, so this guards the data rather than mirroring a refusal.
 */
export function attributeEditProblem(current: TemporalAttribute | undefined, next: TemporalAttribute, recorded: readonly RecordedValue[]): string | null {
  if (!current) return null
  const retyped = current.type !== next.type
  const rewordedList = next.type === 'enum' && !retyped && !sameValues(current.values ?? [], next.values ?? [])
  // Nothing to check until the allowed values are typed; the form already requires them.
  if ((!retyped && !rewordedList) || (next.type === 'enum' && !next.values?.length)) return null
  const misfits = recorded.filter(item => !fits(item.value, next))
  if (!misfits.length) return null
  const shown = misfits.slice(0, MOST_SHOWN).map(item => `${valueText(item.value)} (${item.pending ? 'suggestion' : 'recorded'})`).join(', ')
  const list = misfits.length > MOST_SHOWN ? `${shown} and ${misfits.length - MOST_SHOWN} more` : shown
  const remedy = misfits.every(item => item.pending) ? 'reject the suggestions' : misfits.some(item => item.pending) ? 'retract the recorded values and reject the suggestions' : 'retract the recorded values'
  return retyped
    ? `"${next.name}" has values that would not fit the type "${typeLabel(next.type)}": ${list}. First ${remedy}, or keep the type "${typeLabel(current.type)}".`
    : `"${next.name}" still has values outside the allowed list: ${list}. Keep them in the list, or first ${remedy}.`
}
