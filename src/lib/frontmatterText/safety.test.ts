import { describe, expect, it } from 'vitest'
import golden from '../../../tests/fixtures/frontmatter-ops/cases.json'
import { assertSafeFrontmatterEdit, UnsafeFrontmatterEditError } from './safety'
import type { FrontmatterTextValue } from './yaml'

interface GoldenCase {
  key: string
  op: string
  value?: FrontmatterTextValue
  web?: string
}

describe('assertSafeFrontmatterEdit', () => {
  it('accepts every edit of the shared golden cases the web does not refuse', () => {
    for (const { key, op, value } of (golden.cases as GoldenCase[]).filter(golden => golden.web === undefined)) {
      expect(() => assertSafeFrontmatterEdit(key, op === 'delete' ? undefined : value)).not.toThrow()
    }
  })

  it.each([
    ['tab in a plain value', 'Status', 'a\tb'],
    ['backslash in a plain value', 'Path', 'C\\notes'],
    ['CRLF lines in a block scalar', 'template', 'one\r\ntwo\r\n'],
    ['deleting a key', 'Status', undefined],
    ['numbers, booleans and null', 'Count', 3],
    ['a quoted key without backslashes', 'Due "soon"', 'x'],
  ] as const)('accepts %s', (_name, key, value) => {
    expect(() => assertSafeFrontmatterEdit(key, value as FrontmatterTextValue | undefined)).not.toThrow()
  })

  it.each([
    ['a lone CR in a value', 'Status', 'Done\rinjected: true'],
    ['a NUL in a value', 'Status', 'a\u0000b'],
    ['DEL in a value', 'Status', 'a\u007fb'],
    ['a line separator in a value', 'Status', 'a\u2028b'],
    ['a backslash in a quoted value', 'Link', 'see: C:\\notes'],
    ['a backslash in a list item', 'tags', ['a\\b']],
    ['a newline in a list item', 'tags', ['a\nb: c']],
    ['a lone CR inside a block scalar line', 'template', 'one\rtwo: x\nthree'],
    ['a block scalar whose first line is indented', 'template', '  indented\nnext'],
    ['a newline in a key', 'a\nb', 'x'],
    ['a backslash in a quoted key', 'a\\b c', 'x'],
    ['a CR in a plain key', 'ab\r', 'x'],
    ['an empty key', '', 'x'],
    ['a key that would start a new mapping line', 'a: b\nc', 'x'],
  ] as const)('refuses %s', (_name, key, value) => {
    expect(() => assertSafeFrontmatterEdit(key, value as unknown as FrontmatterTextValue))
      .toThrow(UnsafeFrontmatterEditError)
  })
})
