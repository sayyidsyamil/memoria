import type { LedgerValue, RegistryAttribute } from '../../lib/ledgerApi'

/** The engine stores corrections as typed; send numbers as numbers and dates as ISO dates. */
export function parseEditedValue(spec: RegistryAttribute | undefined, raw: string): { value: LedgerValue } | { error: string } {
  const text = raw.trim()
  if (!text) return { error: 'Enter a value.' }
  if (spec?.type === 'number') {
    const n = Number(text.replace(/,/g, ''))
    return Number.isFinite(n) ? { value: n } : { error: 'Enter a number, for example 250000.' }
  }
  if (spec?.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: 'Pick a date.' }
  return { value: text }
}

export function toInputText(value: LedgerValue): string {
  return value === null || value === undefined ? '' : String(value)
}
