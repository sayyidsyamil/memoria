import { describe, expect, it } from 'vitest'
import { sourceFindSyntaxTokens } from './MobileSourceFindHighlight'

describe('source find highlights', () => {
  it('keeps source syntax and text intact while highlighting a match across tokens', () => {
    const content = '---\ntype: Essay\n---\n# A **bold** match'
    const from = content.indexOf('A **')
    const tokens = sourceFindSyntaxTokens(content, { from, to: content.length })
    expect(tokens.map((token) => token.text).join('')).toBe(content)
    expect(tokens.filter((token) => token.highlighted).map((token) => token.text).join('')).toBe('A **bold** match')
    expect(tokens.some((token) => token.kind === 'syntaxPropertyKey' && token.text === 'type')).toBe(true)
  })
  it('clears highlights without changing content', () => {
    expect(sourceFindSyntaxTokens('**note**').some((token) => token.highlighted)).toBe(false)
  })
})
