import type { FactCorrection, HistoryEntry } from './ledgerApi'

export interface Correction {
  reviewer: string
  reason: string
  replacedFactId: number | null
}

interface Correctable {
  correction?: FactCorrection | null
  corrects?: number | null
}

const CORRECTED_PREFIX = /^corrected:\s*/i

/** True when this entry was set aside because a person corrected it (older engines record this as a retraction). */
export function wasCorrectedAway(entry: Pick<HistoryEntry, 'retracted'>): boolean {
  return CORRECTED_PREFIX.test(entry.retracted?.reason ?? '')
}

/** True when the entry points at the value it corrected, so its reviewer and reason need the history to be read. */
export function needsHistoryForCorrection(entry: Correctable): boolean {
  return !entry.correction && entry.corrects != null
}

/**
 * Who corrected a value and why. Newer engines put `correction` on the corrected value; older ones only link it
 * to the replaced fact (`corrects`), and the replaced fact carries the reviewer and reason in its retraction.
 */
export function correctionOf(entry: Correctable, history: HistoryEntry[] | null): Correction | null {
  if (entry.correction) return { reviewer: entry.correction.reviewer, reason: entry.correction.reason, replacedFactId: entry.correction.replaced_fact_id }
  if (entry.corrects == null) return null
  const replaced = history?.find((h) => h.fact_id === entry.corrects)
  return {
    reviewer: replaced?.retracted?.by ?? 'someone',
    reason: (replaced?.retracted?.reason ?? '').replace(CORRECTED_PREFIX, '').trim(),
    replacedFactId: entry.corrects,
  }
}

export function correctionSummary(correction: Correction): string {
  const reason = correction.reason.trim()
  return reason ? `Corrected by ${correction.reviewer}: ${reason}` : `Corrected by ${correction.reviewer}`
}

export function correctionBanner(correction: Correction): string {
  return `${correctionSummary(correction).replace(/[.\s]+$/, '')}. The quote below is the original one and supports the earlier value.`
}
