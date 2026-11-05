import { describe, expect, it } from 'vitest'
import { preProcessWikilinks } from './wikilinks'

describe('wikilink code integrity', () => {
  it('preserves inline code while processing real wikilinks', () => {
    const result = preProcessWikilinks('`loadData([["y"]])` and `[[x]]` and [[Real]].')
    expect(result).toBe('`loadData([["y"]])` and `[[x]]` and ‹WIKILINK:Real›.')
  })

  it('preserves code spans with embedded backticks and fenced code', () => {
    const source = '`` `[[literal]]` ``\n\n~~~js\n[[code]]\n~~~\n[[Real]]'
    expect(preProcessWikilinks(source)).toBe(source.replace('[[Real]]', '‹WIKILINK:Real›'))
  })
})
