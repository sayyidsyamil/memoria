/**
 * Line-based longest-common-subsequence matching and three-way merge. Used twice: to write a
 * live document back over the bytes of its source file, and to reconcile a document with a
 * version of the file that arrived from git.
 */

export type Lines = readonly string[]

/** `[indexInA, indexInB]` of two equal lines, ascending in both. */
export type LineMatch = readonly [number, number]

export type MergeChunk =
  /** Neither side changed the base, or both changed it to the same lines. */
  | { kind: 'stable'; lines: Lines }
  /** Only `a` changed these lines. */
  | { kind: 'a'; lines: Lines }
  /** Only `b` changed these lines. */
  | { kind: 'b'; lines: Lines }
  /** Both sides changed the same lines differently. */
  | { kind: 'conflict'; base: Lines; a: Lines; b: Lines }

interface Window {
  a: Lines
  b: Lines
  /** Lines both sides share at the start and at the end, outside the window. */
  prefix: number
  suffix: number
}

/** Above this many cells the middle of two texts is treated as replaced, not compared. */
const MAX_TABLE_CELLS = 16_000_000

function commonPrefix(a: Lines, b: Lines): number {
  const limit = Math.min(a.length, b.length)
  let length = 0
  while (length < limit && a[length] === b[length]) length++
  return length
}

function commonSuffix(a: Lines, b: Lines, prefix: number): number {
  const limit = Math.min(a.length, b.length) - prefix
  let length = 0
  while (length < limit && a[a.length - 1 - length] === b[b.length - 1 - length]) length++
  return length
}

function trimmed(a: Lines, b: Lines): Window {
  const prefix = commonPrefix(a, b)
  const suffix = commonSuffix(a, b, prefix)
  return { a: a.slice(prefix, a.length - suffix), b: b.slice(prefix, b.length - suffix), prefix, suffix }
}

/**
 * Blank lines are everywhere, so matching one says little about where a text changed. A
 * line with content counts for more, which keeps a paragraph matched to itself instead of
 * to whatever lets one more blank line pair up.
 */
const BLANK_LINE_WEIGHT = 1
const CONTENT_LINE_WEIGHT = 8

function weight(line: string): number {
  return line.trim() === '' ? BLANK_LINE_WEIGHT : CONTENT_LINE_WEIGHT
}

/** Weights of the heaviest common subsequence of every pair of suffixes, row by row. */
function suffixTable(a: Lines, b: Lines): Uint32Array {
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const cell = i * width + j
      const skip = Math.max(table[cell + width], table[cell + 1])
      table[cell] = a[i] === b[j] ? Math.max(skip, table[cell + width + 1] + weight(a[i])) : skip
    }
  }
  return table
}

function tableMatches({ a, b, prefix }: Window): LineMatch[] {
  if (a.length * b.length > MAX_TABLE_CELLS) return []
  const width = b.length + 1
  const table = suffixTable(a, b)
  const matches: LineMatch[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const cell = i * width + j
    if (a[i] === b[j] && table[cell] === table[cell + width + 1] + weight(a[i])) matches.push([prefix + i++, prefix + j++])
    else if (table[cell + width] >= table[cell + 1]) i++
    else j++
  }
  return matches
}

/** The lines two texts have in common, in order: a heaviest common subsequence. */
export function matchLines(a: Lines, b: Lines): LineMatch[] {
  const window = trimmed(a, b)
  const matches: LineMatch[] = []
  for (let index = 0; index < window.prefix; index++) matches.push([index, index])
  matches.push(...tableMatches(window))
  for (let offset = window.suffix; offset > 0; offset--) matches.push([a.length - offset, b.length - offset])
  return matches
}

function sameLines(a: Lines, b: Lines): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index])
}

/** For every base line, the index of its match in the other text, or -1. */
function matchIndex(base: Lines, other: Lines): Int32Array {
  const index = new Int32Array(base.length).fill(-1)
  for (const [inBase, inOther] of matchLines(base, other)) index[inBase] = inOther
  return index
}

function classify(base: Lines, a: Lines, b: Lines): MergeChunk {
  if (sameLines(a, b)) return { kind: 'stable', lines: a }
  if (sameLines(a, base)) return { kind: 'b', lines: b }
  if (sameLines(b, base)) return { kind: 'a', lines: a }
  return { kind: 'conflict', base, a, b }
}

interface Cursor {
  base: number
  a: number
  b: number
}

interface Sides {
  base: Lines
  a: Lines
  b: Lines
  inA: Int32Array
  inB: Int32Array
}

/** How many base lines from the cursor on are unchanged, in place, on both sides. */
function stableRun({ base, inA, inB }: Sides, at: Cursor): number {
  let run = 0
  while (at.base + run < base.length && inA[at.base + run] === at.a + run && inB[at.base + run] === at.b + run) run++
  return run
}

/** The next base line both sides still have: where the texts are in step again. */
function nextAnchor({ base, a, b, inA, inB }: Sides, from: number): Cursor {
  for (let index = from; index < base.length; index++) {
    if (inA[index] >= 0 && inB[index] >= 0) return { base: index, a: inA[index], b: inB[index] }
  }
  return { base: base.length, a: a.length, b: b.length }
}

function advance(at: Cursor, by: number): Cursor {
  return { base: at.base + by, a: at.a + by, b: at.b + by }
}

function finished({ base, a, b }: Sides, at: Cursor): boolean {
  return at.base >= base.length && at.a >= a.length && at.b >= b.length
}

/** Three-way merge of `a` and `b`, which both derive from `base` (diff3). */
export function merge3(base: Lines, a: Lines, b: Lines): MergeChunk[] {
  const sides: Sides = { base, a, b, inA: matchIndex(base, a), inB: matchIndex(base, b) }
  const chunks: MergeChunk[] = []
  let at: Cursor = { base: 0, a: 0, b: 0 }
  while (!finished(sides, at)) {
    const run = stableRun(sides, at)
    if (run > 0) {
      chunks.push({ kind: 'stable', lines: base.slice(at.base, at.base + run) })
      at = advance(at, run)
      continue
    }
    const next = nextAnchor(sides, at.base)
    chunks.push(classify(base.slice(at.base, next.base), a.slice(at.a, next.a), b.slice(at.b, next.b)))
    at = next
  }
  return chunks
}

export function hasConflict(chunks: readonly MergeChunk[]): boolean {
  return chunks.some((chunk) => chunk.kind === 'conflict')
}
