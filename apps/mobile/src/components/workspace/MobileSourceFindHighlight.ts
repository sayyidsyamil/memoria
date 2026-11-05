import { markdownSyntaxTokens } from './MobileMarkdownSourceSyntax'

type SyntaxToken = ReturnType<typeof markdownSyntaxTokens>[number]
export type SourceFindRange = { from: number; to: number }
type HighlightedToken = SyntaxToken & { highlighted: boolean }

export function sourceFindSyntaxTokens(content: string, match?: SourceFindRange | null): HighlightedToken[] {
  let position = 0
  return markdownSyntaxTokens(content).flatMap((token) => {
    const start = position
    position += token.text.length
    if (!match || match.to <= start || match.from >= position) return [{ ...token, highlighted: false }]
    const from = Math.max(0, match.from - start)
    const to = Math.min(token.text.length, match.to - start)
    return [
      { ...token, text: token.text.slice(0, from), highlighted: false },
      { ...token, text: token.text.slice(from, to), highlighted: true },
      { ...token, text: token.text.slice(to), highlighted: false },
    ].filter((part) => part.text.length > 0)
  })
}
