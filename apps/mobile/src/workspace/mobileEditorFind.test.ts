import { describe, expect, it } from 'vitest'
import {
  applyMobileEditorFindChanges,
  mobileEditorFindSnapshot,
  nextMobileEditorFindIndex,
  replaceAllMobileEditorFindMatches,
  replaceCurrentMobileEditorFindMatch,
} from './mobileEditorFind'

const defaultOptions = { caseSensitive: false, regex: false }

describe('mobile editor find', () => {
  it('uses desktop case-insensitive matching by default', () => {
    expect(mobileEditorFindSnapshot('Alpha beta alpha', 'ALPHA', defaultOptions, 0)).toMatchObject({
      activeIndex: 0,
      hasMatches: true,
      matchCount: 2,
    })
  })

  it('wraps next and previous navigation indexes', () => {
    expect(nextMobileEditorFindIndex(0, 2, -1)).toBe(1)
    expect(nextMobileEditorFindIndex(1, 2, 1)).toBe(0)
    expect(nextMobileEditorFindIndex(0, 0, 1)).toBe(0)
  })

  it('replaces only the active match', () => {
    expect(replaceCurrentMobileEditorFindMatch({
      activeIndex: 1,
      content: 'Alpha beta alpha',
      options: defaultOptions,
      query: 'alpha',
      replacement: 'gamma',
    })).toBe('Alpha beta gamma')
  })

  it('applies regex capture replacements with desktop semantics', () => {
    expect(replaceCurrentMobileEditorFindMatch({
      activeIndex: 0,
      content: 'Release v2026-05-02',
      options: { caseSensitive: false, regex: true },
      query: 'v(\\d{4})-(\\d{2})-(\\d{2})',
      replacement: '$1/$2/$3',
    })).toBe('Release 2026/05/02')
  })

  it('replaces all matches without shifting later ranges', () => {
    expect(replaceAllMobileEditorFindMatches({
      content: 'one two one two',
      options: defaultOptions,
      query: 'one',
      replacement: 'three',
    })).toBe('three two three two')
  })

  it('leaves content unchanged when the query has no valid matches', () => {
    expect(replaceAllMobileEditorFindMatches({
      content: 'Body',
      options: defaultOptions,
      query: 'missing',
      replacement: 'next',
    })).toBeNull()
    expect(replaceCurrentMobileEditorFindMatch({
      activeIndex: 0,
      content: 'Body',
      options: { caseSensitive: false, regex: true },
      query: '[',
      replacement: 'next',
    })).toBeNull()
  })

  it('applies explicit changes from the end of the document', () => {
    expect(applyMobileEditorFindChanges('abc abc', [
      { from: 0, insert: 'x', to: 3 },
      { from: 4, insert: 'yz', to: 7 },
    ])).toBe('x yz')
  })
})
