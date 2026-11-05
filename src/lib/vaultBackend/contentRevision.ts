import type { VaultRevision } from './types'

// Client-side revision for stores that keep no version of their own (local
// disk, mock data): a fast non-cryptographic content hash (cyrb53). It only has
// to tell "same bytes" from "different bytes" for the compare-then-write check;
// the remote backend returns server-issued revisions instead. `crypto.subtle`
// is avoided on purpose: it is unavailable on plain-http device-test origins.

const REVISION_PREFIX = 'h1-'
const SEED_HIGH = 0xdeadbeef
const SEED_LOW = 0x41c6ce57

function mix(value: number, other: number): number {
  const mixed = Math.imul(value ^ (value >>> 16), 2246822507)
  return mixed ^ Math.imul(other ^ (other >>> 13), 3266489909)
}

export function contentRevision(content: string): VaultRevision {
  let high = SEED_HIGH
  let low = SEED_LOW
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index)
    high = Math.imul(high ^ code, 2654435761)
    low = Math.imul(low ^ code, 1597334677)
  }
  const finalHigh = mix(high, low) >>> 0
  const finalLow = mix(low, high) >>> 0
  return `${REVISION_PREFIX}${finalLow.toString(16).padStart(8, '0')}${finalHigh.toString(16).padStart(8, '0')}`
}
