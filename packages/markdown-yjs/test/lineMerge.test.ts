import { describe, expect, it } from 'vitest'
import { hasConflict, matchLines, merge3 } from '../src/lineMerge.ts'
import { reconcile } from '../src/reconcile.ts'
import { preserveSource } from '../src/sourcePreserve.ts'

const BASE = ['# Title', '', 'one', '', 'two', '', 'three']

function text(lines: string[]): string {
  return lines.join('\n')
}

describe('matchLines', () => {
  it.each([
    ['identical texts', ['a', 'b'], ['a', 'b'], [[0, 0], [1, 1]]],
    ['an insertion', ['a', 'c'], ['a', 'b', 'c'], [[0, 0], [1, 2]]],
    ['a deletion', ['a', 'b', 'c'], ['a', 'c'], [[0, 0], [2, 1]]],
    ['nothing in common', ['a'], ['b'], []],
    ['an empty side', [], ['a'], []],
  ])('pairs the common lines of %s', (_name, a, b, expected) => {
    expect(matchLines(a, b)).toEqual(expected)
  })

  it('matches a paragraph to itself rather than pairing up one more blank line', () => {
    const matches = matchLines(['x', '', 'last', ''], ['x', '', 'added', '', 'last'])

    expect(matches).toContainEqual([2, 4])
  })

  it('treats the middle of two very large texts as replaced', () => {
    const a = Array.from({ length: 4100 }, (_, index) => `a${index}`)
    const b = Array.from({ length: 4100 }, (_, index) => `b${index}`)

    expect(matchLines(['same', ...a, 'end'], ['same', ...b, 'end'])).toEqual([[0, 0], [4101, 4101]])
  })
})

describe('merge3', () => {
  it('keeps changes each side made in a different place', () => {
    const a = BASE.with(2, 'ONE')
    const b = BASE.with(6, 'THREE')

    const merged = merge3(BASE, a, b)

    expect(merged.flatMap((chunk) => (chunk.kind === 'conflict' ? [] : chunk.lines))).toEqual(BASE.with(2, 'ONE').with(6, 'THREE'))
    expect(hasConflict(merged)).toBe(false)
  })

  it('reports lines both sides changed differently as a conflict', () => {
    const merged = merge3(BASE, BASE.with(4, 'TWO-a'), BASE.with(4, 'TWO-b'))

    expect(merged).toContainEqual({ kind: 'conflict', base: ['two'], a: ['TWO-a'], b: ['TWO-b'] })
  })

  it('accepts the same change made on both sides', () => {
    const changed = BASE.with(4, 'TWO')

    expect(hasConflict(merge3(BASE, changed, changed))).toBe(false)
  })

  it('merges an insertion on one side with a deletion on the other', () => {
    const merged = merge3(BASE, [...BASE, '', 'four'], BASE.slice(2))

    expect(merged.flatMap((chunk) => (chunk.kind === 'conflict' ? ['!'] : chunk.lines))).toEqual([...BASE.slice(2), '', 'four'])
  })
})

describe('reconcile', () => {
  const base = text(BASE)

  it.each([
    ['unchanged when the document already matches the file', text(BASE.with(2, 'x')), text(BASE.with(2, 'x')), { kind: 'unchanged' }],
    ['adopt when the document has no edits', base, text(BASE.with(2, 'x')), { kind: 'adopt', markdown: text(BASE.with(2, 'x')) }],
    ['merged when only the document changed', text(BASE.with(2, 'x')), base, { kind: 'merged', markdown: text(BASE.with(2, 'x')) }],
    [
      'merged when both changed different lines',
      text(BASE.with(2, 'x')),
      text(BASE.with(6, 'y')),
      { kind: 'merged', markdown: text(BASE.with(2, 'x').with(6, 'y')) },
    ],
    ['conflict when both changed the same line', text(BASE.with(2, 'x')), text(BASE.with(2, 'y')), { kind: 'conflict' }],
  ])('is %s', (_name, live, incoming, expected) => {
    expect(reconcile({ base, live, incoming })).toEqual(expected)
  })
})

describe('preserveSource', () => {
  const source = '---\ntype: Note\n---\n\n# Title\n\nimage ![a](a.png)\n\nlast\n'
  const canonicalSource = '---\ntype: Note\n---\n# Title\n\nimage ![a](./a.png)\n\nlast'

  it('returns the source untouched when nothing was edited', () => {
    expect(preserveSource({ source, canonicalSource, canonical: canonicalSource })).toBe(source)
  })

  it('carries an edit over and leaves the formatting of other lines alone', () => {
    const canonical = canonicalSource.replace('last', 'last words')

    expect(preserveSource({ source, canonicalSource, canonical })).toBe(source.replace('last', 'last words'))
  })

  it('keeps a blank line the source has next to an edited line', () => {
    const canonical = canonicalSource.replace('# Title', '# New title')

    expect(preserveSource({ source, canonicalSource, canonical })).toBe(source.replace('# Title', '# New title'))
  })

  it('writes an edited line in the serializer form when the source formats it differently', () => {
    const canonical = canonicalSource.replace('image ![a](./a.png)', 'picture ![a](./a.png)')

    expect(preserveSource({ source, canonicalSource, canonical })).toBe(source.replace('image ![a](a.png)', 'picture ![a](./a.png)'))
  })
})

describe('preserveSource around the body', () => {
  const source = '---\ntype: Note\n---\n\n# Title\n\nlast\n\n'
  const canonicalSource = '---\ntype: Note\n---\n# Title\n\nlast\n'

  it.each([
    ['a paragraph added at the end', (text: string) => text.replace('last\n', 'last\n\nadded\n')],
    ['a paragraph added at the top', (text: string) => text.replace('# Title', 'added\n\n# Title')],
    ['the last line edited', (text: string) => text.replace('last', 'last words')],
    ['a property added', (text: string) => text.replace('type: Note\n', 'type: Note\nstatus: Open\n')],
  ])('keeps the blank line after the frontmatter and the trailing blank line for %s', (_name, edit) => {
    expect(preserveSource({ source, canonicalSource, canonical: edit(canonicalSource) })).toBe(edit(source))
  })

  it.each([
    ['no frontmatter', '# Title\n\nlast\n', '# Title\n\nlast\n'],
    ['no trailing newline', '# Title\n\nlast', '# Title\n\nlast\n'],
    ['blank lines before the body and no frontmatter', '\n\n# Title\n\nlast', '# Title\n\nlast\n'],
  ])('adds no bytes to a note with %s', (_name, noteSource, noteCanonical) => {
    const edit = (text: string) => text.replace('last', 'last\n\nadded')

    expect(preserveSource({ source: noteSource, canonicalSource: noteCanonical, canonical: edit(noteCanonical) })).toBe(edit(noteSource))
  })

  it('writes the serializer form of a body that was emptied', () => {
    const canonical = '---\ntype: Note\n---\n'

    expect(preserveSource({ source, canonicalSource, canonical })).toBe(canonical)
  })
})
