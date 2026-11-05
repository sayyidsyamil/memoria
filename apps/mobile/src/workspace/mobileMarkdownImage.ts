import { mobilePortableAttachmentHref } from './mobileAttachmentUris'

type HtmlSnippet = string
type ImageAltText = string
type MarkdownLine = string
type PlainText = string
type UrlText = string

export type MobileMarkdownImage = {
  alt: ImageAltText
  src: UrlText
  title?: PlainText
}
export type MobileMarkdownImageAt = {
  endIndex: number
  image: MobileMarkdownImage
}
type MobileImageNodeMarkdownOptions = {
  vaultRootUri?: string | null
}

type BareDestinationCursor = {
  depth: number
  index: number
  value: UrlText
}

const MARKDOWN_IMAGE_AT_PATTERN = /^!\[((?:\\.|[^\]\\\n])*)\]\(/u
const MARKDOWN_IMAGE_PREFIX_PATTERN = /^(\s*)!\[((?:\\.|[^\]\\\n])*)\]\(/u
const MARKDOWN_IMAGE_CLOSE_PATTERN = /^(?:[ \t]+"((?:\\.|[^"\\\n])*)")?\)/u
const MARKDOWN_IMAGE_SUFFIX_PATTERN = /^(?:[ \t]+"((?:\\.|[^"\\\n])*)")?\)\s*$/u

export function mobileMarkdownImageHtml(line: MarkdownLine): HtmlSnippet | null {
  const image = readMobileMarkdownImage(line)
  return image ? imageHtml(image) : null
}

export function readMobileMarkdownImageAt(
  line: MarkdownLine,
  startIndex: number,
): MobileMarkdownImageAt | null {
  const source = line.slice(startIndex)
  const prefix = source.match(MARKDOWN_IMAGE_AT_PATTERN)
  if (!prefix) return null

  const destination = readImageDestination(source, prefix[0].length)
  if (!destination) return null

  const close = source.slice(destination.nextIndex).match(MARKDOWN_IMAGE_CLOSE_PATTERN)
  if (!close) return null

  return {
    endIndex: startIndex + destination.nextIndex + close[0].length,
    image: {
      alt: unescapeMarkdownText(prefix[1] ?? ''),
      src: unescapeMarkdownDestination(destination.value),
      title: close[1] ? unescapeMarkdownText(close[1]) : undefined,
    },
  }
}

export function mobileImageNodeMarkdown(
  attrs: Record<string, unknown> | undefined,
  options: MobileImageNodeMarkdownOptions = {},
): MarkdownLine {
  const src = typeof attrs?.src === 'string' ? mobilePortableAttachmentHref(attrs.src, options.vaultRootUri) : ''
  const alt = typeof attrs?.alt === 'string' ? attrs.alt : ''
  const title = typeof attrs?.title === 'string' ? attrs.title : ''
  return src ? `![${escapeMarkdownLabel(alt)}](${imageDestination(src, title)})` : ''
}

function readMobileMarkdownImage(line: MarkdownLine): MobileMarkdownImage | null {
  const prefix = line.match(MARKDOWN_IMAGE_PREFIX_PATTERN)
  if (!prefix) return null

  const destination = readImageDestination(line, prefix[0].length)
  if (!destination) return null

  const suffix = line.slice(destination.nextIndex).match(MARKDOWN_IMAGE_SUFFIX_PATTERN)
  if (!suffix) return null

  return {
    alt: unescapeMarkdownText(prefix[2] ?? ''),
    src: unescapeMarkdownDestination(destination.value),
    title: suffix[1] ? unescapeMarkdownText(suffix[1]) : undefined,
  }
}

function readImageDestination(
  line: MarkdownLine,
  startIndex: number,
): { nextIndex: number; value: UrlText } | null {
  return line[startIndex] === '<'
    ? readAngledImageDestination(line, startIndex)
    : readBareImageDestination(line, startIndex)
}

function readAngledImageDestination(
  line: MarkdownLine,
  startIndex: number,
): { nextIndex: number; value: UrlText } | null {
  const closeIndex = line.indexOf('>', startIndex + 1)
  if (closeIndex === -1) return null

  const value = line.slice(startIndex, closeIndex + 1)
  return value.includes('\n') ? null : { nextIndex: closeIndex + 1, value }
}

function readBareImageDestination(
  line: MarkdownLine,
  startIndex: number,
): { nextIndex: number; value: UrlText } | null {
  let cursor: BareDestinationCursor = { depth: 0, index: startIndex, value: '' }

  while (cursor.index < line.length) {
    const nextCursor = nextBareDestinationCursor(line, cursor)
    if (!nextCursor) break
    cursor = nextCursor
  }

  return cursor.value ? { nextIndex: cursor.index, value: cursor.value } : null
}

function nextBareDestinationCursor(
  line: MarkdownLine,
  cursor: BareDestinationCursor,
): BareDestinationCursor | null {
  const char = line[cursor.index] ?? ''
  if (isEscapedDestinationChar(line, cursor.index)) return appendEscapedDestinationChar(line, cursor)
  if (isBareDestinationEnd(char, cursor.depth)) return null

  return appendBareDestinationChar(cursor, char)
}

function isEscapedDestinationChar(line: MarkdownLine, index: number): boolean {
  return line[index] === '\\' && index + 1 < line.length
}

function appendEscapedDestinationChar(
  line: MarkdownLine,
  cursor: BareDestinationCursor,
): BareDestinationCursor {
  return {
    ...cursor,
    index: cursor.index + 2,
    value: cursor.value + line.slice(cursor.index, cursor.index + 2),
  }
}

function isBareDestinationEnd(char: PlainText, depth: number): boolean {
  return /\s/u.test(char) || (char === ')' && depth === 0)
}

function appendBareDestinationChar(
  cursor: BareDestinationCursor,
  char: PlainText,
): BareDestinationCursor {
  return {
    depth: nextBareDestinationDepth(cursor.depth, char),
    index: cursor.index + 1,
    value: cursor.value + char,
  }
}

function nextBareDestinationDepth(depth: number, char: PlainText): number {
  if (char === '(') return depth + 1
  if (char === ')') return Math.max(0, depth - 1)
  return depth
}

function imageHtml(image: MobileMarkdownImage): HtmlSnippet {
  const title = image.title ? ` title="${escapeHtml(image.title)}"` : ''
  return `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}"${title}>`
}

function escapeMarkdownLabel(value: PlainText): PlainText {
  return value.replace(/\\/gu, '\\\\').replace(/\]/gu, '\\]')
}

function escapeMarkdownDestination(value: UrlText): UrlText {
  if (/[\s<>]/u.test(value)) return `<${value.replace(/>/gu, '%3E')}>`
  return value.replace(/\\/gu, '\\\\').replace(/[()]/gu, '\\$&')
}

function imageDestination(src: UrlText, title: PlainText): PlainText {
  const destination = escapeMarkdownDestination(src)
  return title ? `${destination} "${escapeMarkdownTitle(title)}"` : destination
}

function escapeMarkdownTitle(value: PlainText): PlainText {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')
}

function unescapeMarkdownText(value: PlainText): PlainText {
  return value.replace(/\\([\\\]"'])/gu, '$1')
}

function unescapeMarkdownDestination(value: UrlText): UrlText {
  const withoutAngles = value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value
  return withoutAngles.replace(/\\([\\()<>])/gu, '$1')
}

function escapeHtml(value: PlainText): PlainText {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}
