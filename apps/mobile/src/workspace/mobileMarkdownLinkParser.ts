type MarkdownLine = string
type PlainText = string
type UrlText = string
type LinkLabel = string

export function nextMarkdownLink(
  markdown: MarkdownLine,
  startIndex: number,
): { end: number; href: UrlText; label: LinkLabel; start: number } | null {
  let searchIndex = startIndex

  while (searchIndex < markdown.length) {
    const labelStart = markdown.indexOf('[', searchIndex)
    if (labelStart === -1) return null
    const label = readMarkdownLinkLabel(markdown, labelStart)
    if (!label) return null
    const destinationStart = label.end + 2
    if (markdown[label.end + 1] !== '(') {
      searchIndex = label.end + 1
      continue
    }

    const destination = readMarkdownLinkDestination(markdown, destinationStart)
    if (destination) {
      return {
        end: destination.end + 1,
        href: destination.href,
        label: label.value,
        start: labelStart,
      }
    }
    searchIndex = destinationStart
  }

  return null
}

function readMarkdownLinkLabel(
  markdown: MarkdownLine,
  startIndex: number,
): { end: number; value: LinkLabel } | null {
  let bracketDepth = 0
  let index = startIndex + 1

  while (index < markdown.length) {
    const char = markdown[index] ?? ''
    if (isClosingMarkdownLinkLabel(char, bracketDepth)) {
      return { end: index, value: markdown.slice(startIndex + 1, index) }
    }
    bracketDepth = nextMarkdownLinkLabelDepth(bracketDepth, char)
    index += 1
  }

  return null
}

function isClosingMarkdownLinkLabel(char: PlainText, bracketDepth: number): boolean {
  return char === ']' && bracketDepth === 0
}

function nextMarkdownLinkLabelDepth(bracketDepth: number, char: PlainText): number {
  if (char === '[') return bracketDepth + 1
  if (char === ']') return Math.max(0, bracketDepth - 1)
  return bracketDepth
}

function readMarkdownLinkDestination(
  markdown: MarkdownLine,
  startIndex: number,
): { end: number; href: UrlText } | null {
  return markdown.startsWith('&lt;', startIndex)
    ? readAngledMarkdownLinkDestination(markdown, startIndex)
    : readBareMarkdownLinkDestination(markdown, startIndex)
}

function readAngledMarkdownLinkDestination(
  markdown: MarkdownLine,
  startIndex: number,
): { end: number; href: UrlText } | null {
  const closeIndex = markdown.indexOf('&gt;', startIndex + 4)
  if (closeIndex === -1 || markdown[closeIndex + 4] !== ')') return null

  return {
    end: closeIndex + 4,
    href: markdown.slice(startIndex, closeIndex + 4),
  }
}

function readBareMarkdownLinkDestination(
  markdown: MarkdownLine,
  startIndex: number,
): { end: number; href: UrlText } | null {
  let depth = 0
  let index = startIndex

  while (index < markdown.length) {
    const char = markdown[index] ?? ''
    if (/\s/u.test(char)) return null
    if (char === '(') depth += 1
    if (char === ')') {
      if (depth === 0) break
      depth -= 1
    }
    index += 1
  }

  return completedMarkdownLinkDestination(markdown, startIndex, index)
}

function completedMarkdownLinkDestination(markdown: MarkdownLine, startIndex: number, index: number) {
  return index > startIndex && markdown[index] === ')'
    ? { end: index, href: markdown.slice(startIndex, index) }
    : null
}
