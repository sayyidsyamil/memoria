type MarkdownLine = string
type MarkdownLines = MarkdownLine[]

export type MobileDisplayMathBlock = {
  lines: MarkdownLines
  nextIndex: number
}

export function readMobileDisplayMathBlock(
  lines: MarkdownLines,
  startIndex: number,
): MobileDisplayMathBlock | null {
  const line = lines[startIndex]
  if (!line) return null

  const trimmed = line.trim()
  if (isSingleLineMobileDisplayMath(trimmed)) {
    return { lines: [trimmed], nextIndex: startIndex + 1 }
  }
  if (trimmed !== '$$') return null

  const mathLines = ['$$']
  let index = startIndex + 1
  while (index < lines.length) {
    const current = lines[index] ?? ''
    if (current.trim() === '$$') {
      mathLines.push('$$')
      return { lines: mathLines, nextIndex: index + 1 }
    }
    mathLines.push(current)
    index += 1
  }

  return null
}

export function isMobileDisplayMathStart(line: MarkdownLine): boolean {
  const trimmed = line.trim()
  return trimmed === '$$' || isSingleLineMobileDisplayMath(trimmed)
}

export function mobileDisplayMathLatex(lines: MarkdownLines): string | null {
  const firstLine = lines[0]?.trim() ?? ''
  const singleLine = firstLine.match(/^\$\$(.+)\$\$$/)
  if (lines.length === 1 && singleLine) return singleLine[1]
  if (firstLine !== '$$' || lines.at(-1)?.trim() !== '$$') return null

  return lines.slice(1, -1).join('\n').trimEnd()
}

export function normalizeMobileDisplayMathMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  if (!hasMobileDisplayMathFence(lines)) return markdown

  return lines.map(stripMarkdownHardBreakMarker).join('\n')
}

function hasMobileDisplayMathFence(lines: MarkdownLines): boolean {
  const firstLine = lines[0]?.trim() ?? ''
  if (lines.length === 1) return isSingleLineMobileDisplayMath(firstLine)

  const lastLine = lines[lines.length - 1]?.trim()
  return firstLine === '$$' && lastLine === '$$'
}

function stripMarkdownHardBreakMarker(line: MarkdownLine): MarkdownLine {
  return line.endsWith('  ') ? line.slice(0, -2) : line
}

function isSingleLineMobileDisplayMath(line: MarkdownLine): boolean {
  return /^\$\$(.+)\$\$$/.test(line)
}
