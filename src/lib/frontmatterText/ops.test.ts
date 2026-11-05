import { describe, expect, it } from 'vitest'
import golden from '../../../tests/fixtures/frontmatter-ops/cases.json'
import { MalformedFrontmatterError, updateFrontmatterContent } from './ops'
import { UnsafeFrontmatterEditError } from './safety'
import type { FrontmatterTextValue } from './yaml'

interface GoldenCase {
  name: string
  content: string
  key: string
  op: string
  value?: FrontmatterTextValue
  expected?: string
  error?: string
  /** `refused`: the web refuses an edit whose desktop bytes do not read back as written. */
  web?: string
}

const cases = golden.cases as GoldenCase[]

function run({ content, key, op, value }: GoldenCase): string {
  return updateFrontmatterContent(content, key, op === 'delete' ? undefined : value)
}

describe('updateFrontmatterContent matches the desktop writer byte for byte', () => {
  it('reads the shared golden cases', () => {
    expect(cases.length).toBeGreaterThan(50)
  })

  it.each(cases.filter(golden => golden.expected !== undefined && golden.web === undefined))('$name', golden => {
    expect(run(golden)).toBe(golden.expected)
  })

  it.each(cases.filter(golden => golden.web === 'refused'))('refuses on the web: $name', golden => {
    expect(() => run(golden)).toThrow(UnsafeFrontmatterEditError)
  })

  it.each(cases.filter(golden => golden.error !== undefined))('$name', golden => {
    expect(() => run(golden)).toThrow(MalformedFrontmatterError)
    expect(() => run(golden)).toThrow(golden.error)
  })
})

describe('updateFrontmatterContent beyond the golden cases', () => {
  it('writes non-finite numbers the way Rust prints them', () => {
    expect(updateFrontmatterContent('', 'n', Number.NaN)).toBe('---\nn: NaN\n---\n')
    expect(updateFrontmatterContent('', 'n', Number.POSITIVE_INFINITY)).toBe('---\nn: inf\n---\n')
    expect(updateFrontmatterContent('', 'n', Number.NEGATIVE_INFINITY)).toBe('---\nn: -inf\n---\n')
  })
})

describe('updateFrontmatterContent with input the desktop would write unsafely', () => {
  it.each([
    ['a lone CR that would start a key', 'Status', 'Done\rinjected: true'],
    ['a backslash in a quoted value', 'Link', 'see: C:\\notes'],
    ['a newline in a list item', 'tags', ['a\nb: c']],
    ['a newline in a key', 'a\nb', 'x'],
  ] as const)('refuses %s', (_name, key, value) => {
    const content = '---\r---\r'
    expect(() => updateFrontmatterContent(content, key, value as unknown as FrontmatterTextValue))
      .toThrow(UnsafeFrontmatterEditError)
  })
})

describe('updateFrontmatterContent with an empty key', () => {
  it('refuses it instead of writing a null key', () => {
    expect(() => updateFrontmatterContent('---\ntitle: T\n---\n', '', 'x')).toThrow(UnsafeFrontmatterEditError)
  })
})
