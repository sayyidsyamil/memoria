import { mobileMarkdownFenceForContent } from './mobileMarkdownCodeFence'

export type MobileMarkdownEditableSourceBlockKind = 'codeBlock' | 'mathBlock' | 'mermaid'

export type MobileMarkdownEditableSourceBlock = {
  content: string
  endLine: number
  fence: string
  indent: string
  infoSuffix: string
  key: string
  kind: MobileMarkdownEditableSourceBlockKind
  language: string
  startLine: number
}

type MarkdownSourceBlockUpdate = {
  content: string
  infoSuffix?: string
  key: string
  kind: MobileMarkdownEditableSourceBlockKind
  language: string
}

type SourceBlockMatch = {
  block: MobileMarkdownEditableSourceBlock | null
  nextLine: number
}

type FenceMatch = {
  fence: string
  indent: string
  infoSuffix: string
  language: string
}

export function readMobileMarkdownEditableSourceBlocks({
  markdown,
}: {
  markdown: string
}): MobileMarkdownEditableSourceBlock[] {
  const lines = markdownLines({ markdown })
  const blocks: MobileMarkdownEditableSourceBlock[] = []
  let lineNumber = 0

  while (lineNumber < lines.length) {
    const match = readSourceBlockAt({ lineNumber, lines })
    if (!match) {
      lineNumber += 1
      continue
    }

    if (match.block) blocks.push(match.block)
    lineNumber = match.nextLine
  }

  return blocks
}

export function updateMobileMarkdownEditableSourceBlock({
  markdown,
  update,
}: {
  markdown: string
  update: MarkdownSourceBlockUpdate
}): { markdown: string; updated: boolean } {
  const lines = markdownLines({ markdown })
  const block = readMobileMarkdownEditableSourceBlocks({ markdown }).find((candidate) => candidate.key === update.key)
  if (!block) return { markdown, updated: false }

  const nextSource = mobileMarkdownEditableSourceBlockSource({
    content: update.content,
    fence: block.fence,
    indent: block.indent,
    infoSuffix: update.infoSuffix ?? block.infoSuffix,
    kind: update.kind,
    language: update.language,
  })

  return {
    markdown: [
      ...lines.slice(0, block.startLine),
      ...nextSource.split('\n'),
      ...lines.slice(block.endLine + 1),
    ].join('\n'),
    updated: true,
  }
}

export function mobileMarkdownEditableSourceBlockSource({
  content,
  fence,
  indent = '',
  infoSuffix = '',
  kind,
  language,
}: {
  content: string
  fence: string
  indent?: string
  infoSuffix?: string
  kind: MobileMarkdownEditableSourceBlockKind
  language: string
}): string {
  if (kind === 'mathBlock') return indentSourceBlock(`$$\n${content.trimEnd()}\n$$`, indent)

  const blockContent = content.trimEnd()
  const blockFence = mobileMarkdownFenceForContent({
    content: blockContent,
    fenceChar: sourceBlockFenceChar(fence),
    minLength: fence.length,
  })
  const blockInfo = sourceBlockInfo({
    infoSuffix,
    language: kind === 'mermaid' ? 'mermaid' : language,
  })
  return indentSourceBlock(`${blockFence}${blockInfo}\n${blockContent}\n${blockFence}`, indent)
}

function sourceBlockFenceChar(fence: string): '`' | '~' {
  return fence.startsWith('~') ? '~' : '`'
}

function readSourceBlockAt({
  lineNumber,
  lines,
}: {
  lineNumber: number
  lines: string[]
}): SourceBlockMatch | null {
  const mathBlock = readMathBlockAt({ lineNumber, lines })
  if (mathBlock) return mathBlock

  return readFencedBlockAt({ lineNumber, lines })
}

function readMathBlockAt({
  lineNumber,
  lines,
}: {
  lineNumber: number
  lines: string[]
}): SourceBlockMatch | null {
  const opening = sourceBlockMarkerLine({ line: lines[lineNumber] ?? '', marker: '$$' })
  if (!opening) return null

  const closingLine = findClosingMathLine({ lineNumber, lines })
  if (closingLine === null) return null

  return {
    block: {
      content: sourceBlockContent({ indent: opening.indent, lines: lines.slice(lineNumber + 1, closingLine) }),
      endLine: closingLine,
      fence: '$$',
      indent: opening.indent,
      infoSuffix: '',
      key: `line:${lineNumber}`,
      kind: 'mathBlock',
      language: '',
      startLine: lineNumber,
    },
    nextLine: closingLine + 1,
  }
}

function readFencedBlockAt({
  lineNumber,
  lines,
}: {
  lineNumber: number
  lines: string[]
}): SourceBlockMatch | null {
  const match = openingFence({ line: lines[lineNumber] ?? '' })
  if (!match) return null

  const closingLine = findClosingFenceLine({ fence: match.fence, lineNumber, lines })
  if (closingLine === null) return null
  if (normalizedLanguageName(match.language) === 'tldraw') {
    return { block: null, nextLine: closingLine + 1 }
  }

  return {
    block: {
      content: sourceBlockContent({ indent: match.indent, lines: lines.slice(lineNumber + 1, closingLine) }),
      endLine: closingLine,
      fence: match.fence,
      indent: match.indent,
      infoSuffix: match.infoSuffix,
      key: `line:${lineNumber}`,
      kind: normalizedLanguageName(match.language) === 'mermaid' ? 'mermaid' : 'codeBlock',
      language: match.language,
      startLine: lineNumber,
    },
    nextLine: closingLine + 1,
  }
}

function openingFence({ line }: { line: string }): FenceMatch | null {
  const sourceLine = sourceBlockLine(line)
  if (!sourceLine) return null

  const match = /^(`{3,}|~{3,})(.*)$/u.exec(sourceLine.content)
  if (!match) return null
  const info = sourceBlockInfoParts({ info: match[2] ?? '' })
  return {
    fence: match[1] ?? '```',
    indent: sourceLine.indent,
    infoSuffix: info.suffix,
    language: info.language,
  }
}

function findClosingFenceLine({
  fence,
  lineNumber,
  lines,
}: {
  fence: string
  lineNumber: number
  lines: string[]
}): number | null {
  const fenceChar = fence[0] ?? '`'
  for (let index = lineNumber + 1; index < lines.length; index += 1) {
    if (isClosingFenceLine({ fenceChar, line: lines[index] ?? '', minLength: fence.length })) return index
  }
  return null
}

function findClosingMathLine({
  lineNumber,
  lines,
}: {
  lineNumber: number
  lines: string[]
}): number | null {
  for (let index = lineNumber + 1; index < lines.length; index += 1) {
    if (sourceBlockMarkerLine({ line: lines[index] ?? '', marker: '$$' })) return index
  }
  return null
}

function isClosingFenceLine({
  fenceChar,
  line,
  minLength,
}: {
  fenceChar: string
  line: string
  minLength: number
}): boolean {
  const sourceLine = sourceBlockLine(line)
  const marker = sourceLine?.content.trim()
  if (!marker || marker.length < minLength) return false
  return Array.from(marker).every((char) => char === fenceChar)
}

function normalizedLanguageName(language: string): string {
  return language.trim().split(/\s+/u)[0]?.toLowerCase() ?? ''
}

function sourceBlockInfo({
  infoSuffix,
  language,
}: {
  infoSuffix: string
  language: string
}): string {
  return [language.trim(), infoSuffix.trim()].filter(Boolean).join(' ')
}

function sourceBlockInfoParts({ info }: { info: string }): { language: string; suffix: string } {
  const trimmed = info.trim()
  if (!trimmed) return { language: '', suffix: '' }

  const [language = '', ...suffixParts] = trimmed.split(/\s+/u)
  return {
    language,
    suffix: suffixParts.join(' '),
  }
}

function sourceBlockLine(line: string): { content: string; indent: string } | null {
  const match = /^( {0,3})(\S.*)$/u.exec(line)
  return match ? { content: match[2] ?? '', indent: match[1] ?? '' } : null
}

function sourceBlockMarkerLine({
  line,
  marker,
}: {
  line: string
  marker: string
}): { indent: string } | null {
  const sourceLine = sourceBlockLine(line)
  return sourceLine?.content.trim() === marker ? { indent: sourceLine.indent } : null
}

function sourceBlockContent({ indent, lines }: { indent: string; lines: string[] }): string {
  return lines.map((line) => stripSourceBlockIndent(line, indent)).join('\n')
}

function stripSourceBlockIndent(line: string, indent: string): string {
  return indent && line.startsWith(indent) ? line.slice(indent.length) : line
}

function indentSourceBlock(source: string, indent: string): string {
  return indent ? source.split('\n').map((line) => `${indent}${line}`).join('\n') : source
}

function markdownLines({ markdown }: { markdown: string }): string[] {
  return markdown.replace(/\r\n/g, '\n').split('\n')
}
