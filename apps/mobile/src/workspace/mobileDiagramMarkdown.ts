import { isMobileMarkdownCodeFenceClose, readMobileMarkdownCodeFence, type MobileMarkdownCodeFence } from './mobileMarkdownCodeFence'

export type MobileDiagramKind = 'mermaid' | 'tldraw'
export type MobileDiagramSource = { kind: MobileDiagramKind; source: string; content: string }

export function readMobileDiagramSource(source: string): MobileDiagramSource | null {
  const lines = source.trimEnd().split(/\r?\n/u)
  const opening = readMobileMarkdownCodeFence(lines[0] ?? '')
  if (!opening || !isMobileMarkdownCodeFenceClose(lines[lines.length - 1] ?? '', opening)) return null
  const kind = diagramKind(opening.info)
  return kind ? { kind, source, content: lines.slice(1, -1).join('\n') } : null
}

export function mobileDiagramFenceHtml(source: string): string | null {
  const diagram = readMobileDiagramSource(source)
  if (!diagram) return null
  return `<div data-mobile-diagram-kind="${diagram.kind}" data-mobile-diagram-source="${encodeURIComponent(source)}"></div>`
}

export function mobileDiagramHtmlBlock(lines: string[], start: number) {
  const opening = readMobileMarkdownCodeFence(lines[start] ?? '')
  if (!opening || !diagramKind(opening.info)) return null
  const end = closingLine(lines, start + 1, opening)
  if (end === lines.length) return null
  const html = mobileDiagramFenceHtml(lines.slice(start, end + 1).join('\n'))
  return html ? { html, nextIndex: end + 1 } : null
}

export function mobileMarkdownHasDiagrams(markdown: string, kind?: MobileDiagramKind): boolean {
  const lines = markdown.split(/\r?\n/u)
  let index = 0
  while (index < lines.length) {
    const opening = readMobileMarkdownCodeFence(lines[index] ?? '')
    if (!opening) { index += 1; continue }
    const end = closingLine(lines, index + 1, opening)
    const found = diagramKind(opening.info)
    if (end < lines.length && found && (!kind || kind === found)) return true
    index = end + 1
  }
  return false
}

function diagramKind(info: string | null): MobileDiagramKind | null {
  const language = info?.split(/\s+/u)[0]?.toLowerCase()
  return language === 'mermaid' || language === 'tldraw' ? language : null
}

function closingLine(lines: string[], start: number, opening: MobileMarkdownCodeFence): number {
  let index = start
  while (index < lines.length && !isMobileMarkdownCodeFenceClose(lines[index] ?? '', opening)) index += 1
  return index
}
