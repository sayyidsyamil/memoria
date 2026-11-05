import * as Y from 'yjs'

/**
 * Rewrites a block in place when the new version has the same shape: the same nodes with the
 * same attributes, only the text inside them changed. The block keeps its Yjs items, so a
 * cursor in it stays put and what someone types into it concurrently is kept (TOL-236); a
 * replaced block would take both with it.
 */

type Attributes = Record<string, unknown>

interface Run {
  insert: string
  attributes: Attributes
}

/** One character (code point, so surrogate pairs stay whole) and the formatting it carries. */
interface Unit {
  char: string
  format: string
  attributes: Attributes
}

/** A block's id belongs to the live document: the new version's fresh id is not a change. */
function elementAttributes(element: Y.XmlElement): string {
  return formatKey(element.getAttributes() as Attributes, 'id')
}

function formatKey(attributes: Attributes, ignored?: string): string {
  const entries = Object.entries(attributes).filter(([key]) => key !== ignored)
  return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)))
}

function runs(text: Y.XmlText): Run[] | null {
  const delta = text.toDelta() as { insert: unknown; attributes?: Attributes }[]
  if (!delta.every((op) => typeof op.insert === 'string')) return null
  return delta.map((op) => ({ insert: op.insert as string, attributes: op.attributes ?? {} }))
}

function units(text: Y.XmlText): Unit[] {
  return (runs(text) ?? []).flatMap(({ insert, attributes }) => {
    const format = formatKey(attributes)
    return Array.from(insert, (char) => ({ char, format, attributes }))
  })
}

function sameUnit(a: Unit | undefined, b: Unit | undefined): boolean {
  return a !== undefined && b !== undefined && a.char === b.char && a.format === b.format
}

function sameElement(live: Y.XmlElement, next: Y.XmlElement): boolean {
  if (live.nodeName !== next.nodeName || live.length !== next.length) return false
  if (elementAttributes(live) !== elementAttributes(next)) return false
  return live.toArray().every((child, index) => sameShape(child, next.get(index)))
}

/** True when `next` differs from `live` only in the text of its text nodes. */
export function sameShape(live: unknown, next: unknown): boolean {
  if (live instanceof Y.XmlText && next instanceof Y.XmlText) return runs(live) !== null && runs(next) !== null
  if (live instanceof Y.XmlElement && next instanceof Y.XmlElement) return sameElement(live, next)
  return false
}

function codeUnits(slice: readonly Unit[]): number {
  return slice.reduce((length, unit) => length + unit.char.length, 0)
}

/** The units of `slice` grouped into runs of one formatting each. */
function insertions(slice: readonly Unit[]): Run[] {
  const grouped: Run[] = []
  let format: string | null = null
  for (const unit of slice) {
    const last = grouped.at(-1)
    if (last && unit.format === format) last.insert += unit.char
    else grouped.push({ insert: unit.char, attributes: unit.attributes })
    format = unit.format
  }
  return grouped
}

/** Changes the text to read as `next`, formatting included: what is shared at both ends stays. */
function patchFormattedText(text: Y.XmlText, next: Y.XmlText): void {
  const current = units(text)
  const wanted = units(next)
  let start = 0
  while (sameUnit(current[start], wanted[start])) start++
  let end = 0
  const limit = Math.min(current.length, wanted.length) - start
  while (end < limit && sameUnit(current.at(-1 - end), wanted.at(-1 - end))) end++
  let at = codeUnits(current.slice(0, start))
  text.delete(at, codeUnits(current.slice(start, current.length - end)))
  for (const { insert, attributes } of insertions(wanted.slice(start, wanted.length - end))) {
    text.insert(at, insert, { ...attributes })
    at += insert.length
  }
}

/** Makes `live` read as `next`. Both must have the same shape (`sameShape`). */
export function patchInPlace(live: Y.XmlElement | Y.XmlText, next: Y.XmlElement | Y.XmlText): void {
  if (live instanceof Y.XmlText) {
    patchFormattedText(live, next as Y.XmlText)
    return
  }
  const children = (next as Y.XmlElement).toArray() as (Y.XmlElement | Y.XmlText)[]
  for (const [index, child] of live.toArray().entries()) patchInPlace(child as Y.XmlElement | Y.XmlText, children[index])
}
