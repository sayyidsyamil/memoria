import { describe, expect, it } from 'vitest'
import { markdownSyntaxTokens } from './MobileMarkdownSourceSyntax'

describe('source syntax roles', () => {
  it('preserves the exact document while exposing theme-independent token kinds', () => {
    const content = '---\ntype: essay\n---\n# Heading\nText **bold** and *italic* with `code` and [[Link]].\n'
    const tokens = markdownSyntaxTokens(content)
    expect(tokens.map((token) => token.text).join('')).toBe(content)
    expect(tokens).toContainEqual({ kind: 'syntaxHeading', text: 'Heading' })
    expect(tokens).toContainEqual({ kind: 'syntaxPropertyKey', text: 'type' })
    expect(tokens).toContainEqual({ kind: 'syntaxStrong', text: '**bold**' })
    expect(tokens).toContainEqual({ kind: 'syntaxEmphasis', text: '*italic*' })
    expect(tokens).toContainEqual({ kind: 'syntaxInlineCode', text: '`code`' })
    expect(tokens).toContainEqual({ kind: 'syntaxWikilink', text: '[[Link]]' })
  })

  it('preserves blank lines and accepts an empty note', () => {
    expect(markdownSyntaxTokens('')).toEqual([])
    expect(markdownSyntaxTokens('\n\n').map((token) => token.text).join('')).toBe('\n\n')
  })
})
