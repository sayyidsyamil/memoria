type MarkdownSyntaxKind = 'syntaxMeta' | 'syntaxPropertyKey' | 'syntaxHeading' | 'syntaxCodeFence' | 'syntaxQuote' | 'syntaxListMarker' | 'syntaxTable' | 'syntaxInlineCode' | 'syntaxWikilink' | 'syntaxAttachment' | 'syntaxStrong' | 'syntaxEmphasis'

type MarkdownSource = string
type MarkdownSourceLine = string
type MarkdownLexeme = string

type MarkdownSyntaxToken = {
  kind?: MarkdownSyntaxKind
  text: string
}

export function markdownSyntaxTokens(content: MarkdownSource): MarkdownSyntaxToken[] {
  if (!content) return []

  return content
    .split(/(\n)/u)
    .flatMap((part) => (part === '\n' ? [{ text: part }] : markdownSyntaxLineTokens(part)))
}

function markdownSyntaxLineTokens(line: MarkdownSourceLine): MarkdownSyntaxToken[] {
  if (/^\s*---\s*$/u.test(line)) return [{ kind: 'syntaxMeta', text: line }]

  const frontmatterMatch = /^([A-Za-z0-9_-]+)(:\s*)/u.exec(line)
  if (frontmatterMatch) {
    const key = frontmatterMatch[1] ?? ''
    const separator = frontmatterMatch[2] ?? ''
    return [
      { kind: 'syntaxPropertyKey', text: key },
      { kind: 'syntaxMeta', text: separator },
      ...markdownInlineSyntaxTokens(line.slice(key.length + separator.length)),
    ]
  }

  const headingMatch = /^(\s{0,3}#{1,6}\s+)(.*)$/u.exec(line)
  if (headingMatch) {
    return [
      { kind: 'syntaxMeta', text: headingMatch[1] ?? '' },
      { kind: 'syntaxHeading', text: headingMatch[2] ?? '' },
    ]
  }

  if (/^\s*```/u.test(line)) return [{ kind: 'syntaxCodeFence', text: line }]

  const blockquoteMatch = /^(\s*>+\s?)(.*)$/u.exec(line)
  if (blockquoteMatch) {
    return [
      { kind: 'syntaxMeta', text: blockquoteMatch[1] ?? '' },
      { kind: 'syntaxQuote', text: blockquoteMatch[2] ?? '' },
    ]
  }

  const listMatch = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/u.exec(line)
  if (listMatch) {
    return [
      { kind: 'syntaxListMarker', text: listMatch[1] ?? '' },
      ...markdownInlineSyntaxTokens(listMatch[2] ?? ''),
    ]
  }

  if (line.includes('|')) return markdownInlineSyntaxTokens(line, 'syntaxTable')

  return markdownInlineSyntaxTokens(line)
}

function markdownInlineSyntaxTokens(line: MarkdownSourceLine, baseKind?: MarkdownSyntaxKind): MarkdownSyntaxToken[] {
  const tokens: MarkdownSyntaxToken[] = []
  const syntaxPattern = /(`[^`]+`|\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/gu
  let cursor = 0

  for (const match of line.matchAll(syntaxPattern)) {
    const index = match.index ?? 0
    if (index > cursor) tokens.push({ kind: baseKind, text: line.slice(cursor, index) })
    tokens.push({ kind: markdownInlineTokenKind(match[0]), text: match[0] })
    cursor = index + match[0].length
  }

  if (cursor < line.length) tokens.push({ kind: baseKind, text: line.slice(cursor) })
  return tokens.length > 0 ? tokens : [{ kind: baseKind, text: line }]
}

function markdownInlineTokenKind(token: MarkdownLexeme): MarkdownSyntaxKind {
  if (token.startsWith('`')) return 'syntaxInlineCode'
  if (token.startsWith('[[')) return 'syntaxWikilink'
  if (token.startsWith('![')) return 'syntaxAttachment'
  if (token.startsWith('**')) return 'syntaxStrong'
  return 'syntaxEmphasis'
}
