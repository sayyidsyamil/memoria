import { describe, expect, it } from 'vitest'
import { ChangeSet } from '@codemirror/state'
import { applyRawMarkdownChanges } from './rawMarkdownSource'

describe('raw Markdown transactions', () => {
  it('preserves mixed source line endings across multiple edits in a transaction', () => {
    const source = 'AB\r\nCD\nEF\r'
    const normalized = 'AB\nCD\nEF\n'
    const changes = ChangeSet.of([{ from: 1, to: 2, insert: 'Z' }, { from: 7, insert: '!' }], normalized.length)
    expect(applyRawMarkdownChanges(source, changes)).toBe('AZ\r\nCD\nE!F\r')
  })

  it('inserts new lines using the source line-ending convention', () => {
    expect(applyRawMarkdownChanges('AB\r\n', ChangeSet.of({ from: 1, insert: '\n' }, 3))).toBe('A\r\nB\r\n')
  })

  it('replaces the whole source without orphaned carriage returns', () => {
    expect(applyRawMarkdownChanges('AB\r\nCD', ChangeSet.of({ from: 0, to: 5, insert: 'X' }, 5))).toBe('X')
  })

  it('keeps LF and no-final-newline source exact', () => {
    expect(applyRawMarkdownChanges('&lt;term&gt;\n`[[x]]`', ChangeSet.of({ from: 0, insert: 'X' }, 19)))
      .toBe('X&lt;term&gt;\n`[[x]]`')
  })
})
