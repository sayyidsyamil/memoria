import type { MobileMarkdownListItem } from './mobileMarkdownListHtml'
import type { MarkdownLine, MarkdownLines, PlainText, ListKind } from './mobileDocumentContent.types'

export function explicitMarkdownHardBreak(line: MarkdownLine): { break: boolean; text: MarkdownLine } {
  if (line.endsWith('\\')) return { break: true, text: line.slice(0, -1).trim() }
  if (/ {2,}$/u.test(line)) return { break: true, text: line.replace(/ {2,}$/u, '').trim() }
  return { break: false, text: line.trim() }
}

export function listLine(line: MarkdownLine): (MobileMarkdownListItem & { kind: ListKind }) | null {
  const task = line.match(/^(\s*)[-*+]\s+\[([ xX])\](?:\s+(.*))?$/u)
  if (task) {
    return {
      ...listItemText(task[3] ?? ''),
      checked: task[2].toLowerCase() === 'x',
      depth: listDepth(task[1]),
      kind: 'task',
    }
  }

  const bullet = line.match(/^(\s*)[-*+](?:\s+(.*))?$/u)
  if (bullet) return { ...listItemText(bullet[2] ?? ''), depth: listDepth(bullet[1]), kind: 'bullet' }

  const ordered = line.match(/^(\s*)(\d+)[.)](?:\s+(.*))?$/u)
  if (ordered) {
    return {
      ...listItemText(ordered[3] ?? ''),
      depth: listDepth(ordered[1]),
      kind: 'ordered',
      markerNumber: Number(ordered[2]),
    }
  }

  return null
}

export function listItemText(source: MarkdownLine): Pick<MobileMarkdownListItem, 'hardBreak' | 'text'> {
  const hardBreak = explicitMarkdownHardBreak(source)
  return { hardBreak: hardBreak.break, text: hardBreak.text }
}

export function isIndentedListSourceLine(line: MarkdownLine): boolean {
  return isCodeIndentedLine(line) && listLine(line) !== null
}

export function isOutdentedListSourceLine(line: MarkdownLine, baseIndent: number): boolean {
  return listLine(line) !== null && leadingWhitespaceLength(line) < baseIndent
}

export function isListContinuationSourceLine(line: MarkdownLine, baseIndent: number): boolean {
  return listLine(line) === null && leadingWhitespaceLength(line) > baseIndent && line.trim().length > 0
}

export function isListHardBreakSourceLine(line: MarkdownLine): boolean {
  const item = listLine(line)
  return Boolean(item && item.text.trim().length > 0 && explicitMarkdownHardBreak(line).break)
}

export function isBackslashListHardBreakSourceLine(line: MarkdownLine): boolean {
  const item = listLine(line)
  return Boolean(item && item.text.trim().length > 0 && line.trimEnd().endsWith('\\'))
}

export function isOrderedParenListSourceLine(line: MarkdownLine): boolean {
  return /^\d+\)(?:\s+.*)?$/u.test(line)
}

export function isIrregularOrderedDotListSource(lines: MarkdownLines): boolean {
  if (lines.length < 2) return false

  const numbers = lines.map(orderedDotListSourceLineNumber)
  const start = numbers[0]
  if (start === null || numbers.some((number) => number === null)) return false

  return numbers.some((number, index) => number !== start + index)
}

export function orderedDotListSourceLineNumber(line: MarkdownLine): number | null {
  const match = line.match(/^(\d+)\.(?:\s+.*)?$/u)
  return match ? Number(match[1]) : null
}

export function isIndentedTextSourceLine(line: MarkdownLine): boolean {
  return /^(?: {4,}|\t)\S/u.test(line)
}

export function isCodeIndentedLine(line: MarkdownLine): boolean {
  return /^(?: {4,}|\t)/u.test(line)
}

export function hasLeadingWhitespace(line: MarkdownLine): boolean {
  return /^\s/u.test(line)
}

export function leadingWhitespaceLength(line: MarkdownLine): number {
  return (line.match(/^\s*/u)?.[0] ?? '').replace(/\t/gu, '  ').length
}

export function listDepth(indent: MarkdownLine): number {
  const expanded = indent.replace(/\t/g, '  ')
  return Math.min(Math.floor(expanded.length / 2), 3)
}

export function isHorizontalRule(line: MarkdownLine): boolean {
  return /^[-*_]{3,}$/.test(line.trim())
}

export function isMarkdownTableDivider(line: MarkdownLine): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

export function prefixLines(text: PlainText, prefix: MarkdownLine): string {
  return text.split('\n').map((line) => `${prefix}${line}`).join('\n')
}

export function indentLines(text: PlainText, indent: MarkdownLine): string {
  return text.split('\n').map((line) => `${indent}${line}`).join('\n')
}
