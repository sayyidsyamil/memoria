import type { MobileFileKind } from './mobileWorkspaceModel'

type FrontmatterState = 'valid' | 'empty' | 'none' | 'invalid'
export type MobileFrontmatterState = FrontmatterState | 'unknown' | 'unsupported'

const FRONTMATTER_CLOSE_DELIMITER = /(?:^|\r?\n)---(?:\r?\n|$)/

export function mobileFrontmatterState({
  fileKind,
  rawContent,
}: {
  fileKind?: MobileFileKind
  rawContent?: string
}): MobileFrontmatterState {
  if (fileKind && fileKind !== 'markdown') return 'unsupported'
  if (rawContent === undefined) return 'unknown'
  return detectMobileMarkdownFrontmatterState(rawContent)
}

export function needsMobileFrontmatterNotice(state: MobileFrontmatterState): boolean {
  return state === 'empty' || state === 'invalid' || state === 'none'
}

function detectMobileMarkdownFrontmatterState(content: string): FrontmatterState {
  const body = mobileMarkdownFrontmatterBody(content)
  if (body === null) return 'none'
  if (!body.trim()) return 'empty'
  return hasFrontmatterKey(body) ? 'valid' : 'invalid'
}

function mobileMarkdownFrontmatterBody(content: string): string | null {
  const start = mobileFrontmatterStart(content)
  if (start === null) return null

  const rest = content.slice(start)
  const close = rest.match(FRONTMATTER_CLOSE_DELIMITER)
  return close?.index === undefined ? null : rest.slice(0, close.index)
}

function mobileFrontmatterStart(content: string): number | null {
  if (content.startsWith('---\r\n')) return 5
  if (content.startsWith('---\n')) return 4
  return null
}

function hasFrontmatterKey(body: string): boolean {
  return body.split(/\r?\n/).some((line) => /^[A-Za-z][\w -]*:/.test(line))
}
