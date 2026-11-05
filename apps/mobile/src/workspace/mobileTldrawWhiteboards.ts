import {
  isMobileMarkdownCodeFenceClose,
  mobileMarkdownFenceForContent,
  readMobileMarkdownCodeFence,
} from './mobileMarkdownCodeFence'

export type MobileTldrawWhiteboard = {
  boardId: string
  endLine: number
  height: string
  indent: string
  key: string
  metadataSuffix: string
  snapshot: string
  startLine: number
  width: string
}

type MobileTldrawFenceMetadata = Pick<MobileTldrawWhiteboard, 'boardId' | 'height' | 'metadataSuffix' | 'width'>

type MobileTldrawWhiteboardUpdate = {
  height?: string
  key: string
  snapshot?: string
  width?: string
}

type MobileTldrawFenceBody = {
  endLine: number
  snapshot: string
}

type MobileTldrawFenceMatch = {
  nextLine: number
  whiteboard: MobileTldrawWhiteboard
}

export const mobileTldrawDefaultHeight = '520'
export const mobileTldrawEmptySnapshot = '{}'

export function readMobileTldrawWhiteboards({ markdown }: { markdown: string }): MobileTldrawWhiteboard[] {
  const lines = markdownLines({ markdown })
  const whiteboards: MobileTldrawWhiteboard[] = []
  let lineNumber = 0

  while (lineNumber < lines.length) {
    const match = readMobileTldrawFenceAt({ lineNumber, lines })
    if (!match) {
      lineNumber += 1
      continue
    }

    whiteboards.push(match.whiteboard)
    lineNumber = match.nextLine
  }

  return whiteboards
}

export function updateMobileTldrawWhiteboard(
  { markdown, update }: { markdown: string; update: MobileTldrawWhiteboardUpdate },
): { markdown: string; updated: boolean } {
  const lines = markdownLines({ markdown })
  const whiteboard = readMobileTldrawWhiteboards({ markdown }).find((candidate) => candidate.key === update.key)
  if (!whiteboard) return { markdown, updated: false }

  const nextSource = mobileTldrawFenceSource({
    boardId: whiteboard.boardId,
    height: normalizedDimension({
      blankFallback: mobileTldrawDefaultHeight,
      fallback: whiteboard.height,
      value: update.height,
    }),
    indent: whiteboard.indent,
    metadataSuffix: whiteboard.metadataSuffix,
    snapshot: normalizedSnapshot({ snapshot: update.snapshot ?? whiteboard.snapshot }),
    width: normalizedDimension({ blankFallback: '', fallback: whiteboard.width, value: update.width }),
  })
  const nextLines = [
    ...lines.slice(0, whiteboard.startLine),
    ...nextSource.split('\n'),
    ...lines.slice(whiteboard.endLine + 1),
  ]

  return {
    markdown: nextLines.join('\n'),
    updated: true,
  }
}

export function mobileTldrawFenceSource({
  boardId,
  height,
  indent = '',
  metadataSuffix = '',
  snapshot,
  width,
}: Pick<MobileTldrawWhiteboard, 'boardId' | 'height' | 'snapshot' | 'width'> & {
  indent?: string
  metadataSuffix?: string
}): string {
  const fence = mobileMarkdownFenceForContent({ content: snapshot })
  return indentTldrawFenceSource(`${fence}tldraw${mobileTldrawFenceMetadata({
    boardId,
    height,
    metadataSuffix,
    width,
  })}\n${snapshotBody({ snapshot })}${fence}`, indent)
}

function readMobileTldrawFenceAt({
  lineNumber,
  lines,
}: {
  lineNumber: number
  lines: string[]
}): MobileTldrawFenceMatch | null {
  const sourceLine = tldrawSourceLine(lines[lineNumber] ?? '')
  if (!sourceLine) return null

  const opening = readMobileMarkdownCodeFence(sourceLine.content)
  const metadata = opening?.info ? readMobileTldrawFenceMetadata({ info: opening.info }) : null
  if (!opening || !metadata) return null

  const body = readMobileTldrawFenceBody({ indent: sourceLine.indent, lineNumber, lines, opening })
  if (!body) return null

  return {
    nextLine: body.endLine + 1,
    whiteboard: {
      ...metadata,
      endLine: body.endLine,
      indent: sourceLine.indent,
      key: mobileTldrawWhiteboardKey({ boardId: metadata.boardId, startLine: lineNumber }),
      snapshot: body.snapshot,
      startLine: lineNumber,
    },
  }
}

function readMobileTldrawFenceBody({
  indent,
  lineNumber,
  lines,
  opening,
}: {
  indent: string
  lineNumber: number
  lines: string[]
  opening: NonNullable<ReturnType<typeof readMobileMarkdownCodeFence>>
}): MobileTldrawFenceBody | null {
  const bodyLines: string[] = []
  let closeLine = lineNumber + 1

  while (closeLine < lines.length && !isTldrawFenceClose({ line: lines[closeLine] ?? '', opening })) {
    bodyLines.push(stripTldrawFenceIndent({ indent, line: lines[closeLine] ?? '' }))
    closeLine += 1
  }

  if (closeLine >= lines.length) return null
  return {
    endLine: closeLine,
    snapshot: normalizedSnapshot({ snapshot: bodyLines.join('\n') }),
  }
}

function readMobileTldrawFenceMetadata({ info }: { info: string }): MobileTldrawFenceMetadata | null {
  const [language = '', ...metadataParts] = info.trim().split(/\s+/u)
  if (language.toLowerCase() !== 'tldraw') return null

  const metadata = metadataParts.join(' ')
  return {
    boardId: readFenceAttribute({ info: metadata, name: 'id' }),
    height: readFenceAttribute({ info: metadata, name: 'height' }) || mobileTldrawDefaultHeight,
    metadataSuffix: metadataWithoutKnownAttributes({ metadata }),
    width: readFenceAttribute({ info: metadata, name: 'width' }),
  }
}

function mobileTldrawWhiteboardKey({ boardId, startLine }: { boardId: string; startLine: number }): string {
  return boardId || `line:${startLine}`
}

function mobileTldrawFenceMetadata({
  boardId,
  height,
  metadataSuffix,
  width,
}: MobileTldrawFenceMetadata): string {
  const attributes: string[] = []
  if (boardId) attributes.push(`id="${escapeFenceAttribute({ value: boardId })}"`)
  if (height) attributes.push(`height="${escapeFenceAttribute({ value: height })}"`)
  if (width) attributes.push(`width="${escapeFenceAttribute({ value: width })}"`)
  if (metadataSuffix.trim()) attributes.push(metadataSuffix.trim())
  return attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
}

function metadataWithoutKnownAttributes({ metadata }: { metadata: string }): string {
  return metadata
    .replace(/\b(?:height|id|width)=(?:"[^"]*"|'[^']*'|[^\s]+)/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function readFenceAttribute({ info, name }: { info: string; name: 'height' | 'id' | 'width' }): string {
  for (const match of info.matchAll(/\b([A-Za-z][\w-]*)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/gu)) {
    if (match.at(1) === name) return match.at(2) ?? match.at(3) ?? match.at(4) ?? ''
  }
  return ''
}

function normalizedDimension({
  blankFallback,
  fallback,
  value,
}: {
  blankFallback: string
  fallback: string
  value: string | undefined
}): string {
  const trimmed = value?.trim()
  if (trimmed) return trimmed
  return fallback.trim() || blankFallback
}

function normalizedSnapshot({ snapshot }: { snapshot: string }): string {
  const normalized = snapshot.replace(/\r\n/g, '\n')
  return normalized.trim().length > 0 ? normalized : mobileTldrawEmptySnapshot
}

function snapshotBody({ snapshot }: { snapshot: string }): string {
  return snapshot.endsWith('\n') ? snapshot : `${snapshot}\n`
}

function isTldrawFenceClose({
  line,
  opening,
}: {
  line: string
  opening: NonNullable<ReturnType<typeof readMobileMarkdownCodeFence>>
}): boolean {
  const sourceLine = tldrawSourceLine(line)
  return sourceLine ? isMobileMarkdownCodeFenceClose(sourceLine.content, opening) : false
}

function tldrawSourceLine(line: string): { content: string; indent: string } | null {
  const match = /^( {0,3})(\S.*)$/u.exec(line)
  return match ? { content: match[2] ?? '', indent: match[1] ?? '' } : null
}

function stripTldrawFenceIndent({ indent, line }: { indent: string; line: string }): string {
  return indent && line.startsWith(indent) ? line.slice(indent.length) : line
}

function indentTldrawFenceSource(source: string, indent: string): string {
  return indent ? source.split('\n').map((line) => `${indent}${line}`).join('\n') : source
}

function escapeFenceAttribute({ value }: { value: string }): string {
  return value.replace(/"/gu, '&quot;')
}

function markdownLines({ markdown }: { markdown: string }): string[] {
  return markdown.replace(/\r\n/g, '\n').split('\n')
}
