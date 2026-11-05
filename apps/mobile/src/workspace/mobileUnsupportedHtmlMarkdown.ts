type HtmlSnippet = string
type MarkdownLine = string
type MarkdownLines = MarkdownLine[]
type ReadUnsupportedHtmlBlock = { lines: MarkdownLines; nextIndex: number }

export function readUnsupportedHtmlBlock(
  lines: MarkdownLines,
  startIndex: number,
): ReadUnsupportedHtmlBlock | null {
  if (isHtmlCommentOpenLine(lines[startIndex] ?? '')) {
    return readUntilCloseLine(lines, startIndex, isHtmlCommentCloseLine)
  }

  if (!isDetailsOpenLine(lines[startIndex] ?? '')) return null

  return readUntilCloseLine(lines, startIndex, isDetailsCloseLine)
}

function readUntilCloseLine(
  lines: MarkdownLines,
  startIndex: number,
  isCloseLine: (line: MarkdownLine) => boolean,
): ReadUnsupportedHtmlBlock {
  const blockLines: MarkdownLines = []
  let index = startIndex
  while (index < lines.length) {
    const line = lines[index] ?? ''
    blockLines.push(line)
    index += 1
    if (isCloseLine(line)) break
  }

  return { lines: blockLines, nextIndex: index }
}

export function unsupportedHtmlBlockToParagraphHtml(
  lines: MarkdownLines,
  escapeHtml: (value: string) => string,
): HtmlSnippet {
  return `<p>${lines.map(escapeHtml).join('<br>')}</p>`
}

export function normalizeUnsupportedHtmlBlockMarkdown(markdown: string): string {
  const lines = markdown.split('\n').map(stripHardBreakMarker)
  return isUnsupportedHtmlSourceParagraph(lines) ? lines.join('\n') : markdown
}

function isUnsupportedHtmlSourceParagraph(lines: MarkdownLines): boolean {
  return isUnsupportedDetailsParagraph(lines) || isUnsupportedCommentParagraph(lines)
}

function isUnsupportedCommentParagraph(lines: MarkdownLines): boolean {
  return htmlCommentSourceChecks(lines).every(Boolean)
}

function htmlCommentSourceChecks(lines: MarkdownLines): boolean[] {
  return [
    lines.length > 0,
    isHtmlCommentOpenLine(firstMarkdownLine(lines)),
    isHtmlCommentCloseLine(lastMarkdownLine(lines)),
  ]
}

function isUnsupportedDetailsParagraph(lines: MarkdownLines): boolean {
  return lines.length >= 2
    && isDetailsOpenLine(firstMarkdownLine(lines))
    && isDetailsCloseLine(lastMarkdownLine(lines))
}

function firstMarkdownLine(lines: MarkdownLines): MarkdownLine {
  return lines[0] || ''
}

function lastMarkdownLine(lines: MarkdownLines): MarkdownLine {
  if (lines.length === 0) return ''

  return lines[lines.length - 1] || ''
}

function isHtmlCommentOpenLine(line: MarkdownLine): boolean {
  return line.trimStart().startsWith('<!--')
}

function isHtmlCommentCloseLine(line: MarkdownLine): boolean {
  return line.includes('-->')
}

function isDetailsOpenLine(line: MarkdownLine): boolean {
  return /^<details(?:\s|>)/u.test(line.trim())
}

function isDetailsCloseLine(line: MarkdownLine): boolean {
  return line.trim() === '</details>'
}

function stripHardBreakMarker(line: MarkdownLine): MarkdownLine {
  return line.endsWith('  ') ? line.slice(0, -2) : line
}
