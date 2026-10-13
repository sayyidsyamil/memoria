import type { LedgerValue } from './ledgerApi'

/** The reason the engine gives when a suggested number is not written in its own quote. */
export const NUMBER_NOT_IN_QUOTE = 'the number is not in the quote'

const NUMBER = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|m|bn|million|thousand|billion)?(?!\w)/gi
const MAGNITUDE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, billion: 1e9 }
const BIG_NUMBER = 1000

/** Every number written with digits in the text, with and without its magnitude word. Mirrors `numbers_in` in the engine. */
export function numbersIn(text: string): number[] {
  const found: number[] = []
  for (const [, whole, fraction, word] of text.matchAll(NUMBER)) {
    const base = Number(whole.replace(/,/g, '') + (fraction ? `.${fraction}` : ''))
    found.push(base)
    if (word) found.push(base * MAGNITUDE[word.toLowerCase()])
  }
  return found
}

/** The number to offer as a correction: the only number of 1,000 or more written in the quote, if there is exactly one. */
export function onlyBigNumberIn(text: string): number | null {
  const big = [...new Set(numbersIn(text).filter((n) => n >= BIG_NUMBER))]
  return big.length === 1 ? big[0] : null
}

export function isMisreadNumber(reason: string | null | undefined): boolean {
  return reason === NUMBER_NOT_IN_QUOTE
}

/** What "Edit then accept" starts with: the quote's own number for a misread suggestion, otherwise the suggested value. */
export function initialEditText(value: LedgerValue, reason: string | null | undefined, quote: string | null): string {
  if (isMisreadNumber(reason) && quote) {
    const fromQuote = onlyBigNumberIn(quote)
    if (fromQuote !== null) return String(fromQuote)
  }
  return value === null || value === undefined ? '' : String(value)
}
