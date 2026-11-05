import { parseLocalVaultDocument } from './localVaultFrontmatter'
import { mobileEditorBlocksToMarkdown, mobileFallbackBulletsToMarkdown } from './mobileEditorBlockMarkdown'
import type { MarkdownContent, MarkdownBody, NoteTitleText, MobileEditableDocumentSource } from './mobileDocumentContent.types'

export const FRONTMATTER_OPEN = /^---\r?\n/

export const FRONTMATTER_CLOSE = /\r?\n---(?:\r?\n|$)/

export function mobileNoteEditableContent(note: MobileEditableDocumentSource): MarkdownContent {
  if (note.rawContent !== undefined) return note.rawContent

  const blocks = [
    optionalTitleHeading(note.title),
    mobileEditorBlocksToMarkdown(note.editorBlocks ?? []),
    mobileFallbackBulletsToMarkdown(note.editorBullets ?? []),
  ].filter(Boolean)

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : ''
}

export function mobileDocumentBody(content: MarkdownContent): MarkdownBody {
  return parseLocalVaultDocument(content).body
}

export function mobileDocumentWithBody(
  content: MarkdownContent,
  body: MarkdownBody,
): MarkdownContent {
  const boundary = rawFrontmatterBoundary(content)
  if (!boundary) return body

  return `${content.slice(0, boundary.bodyStart)}${body}`
}

export function optionalTitleHeading(title: NoteTitleText): string {
  const text = title.trim()
  return text ? `# ${text.replace(/\r?\n/gu, ' ')}` : ''
}

export function rawFrontmatterBoundary(content: MarkdownContent): { bodyStart: number } | null {
  const open = content.match(FRONTMATTER_OPEN)
  if (!open) return null

  const rest = content.slice(open[0].length)
  const close = rest.match(FRONTMATTER_CLOSE)
  if (!close || close.index === undefined) return null

  return {
    bodyStart: open[0].length + close.index + close[0].length,
  }
}

export { mobileMarkdownBodyToTentapHtml } from './mobileMarkdownHtmlBlocks'
export { tiptapJsonToMobileMarkdown } from './mobileTiptapMarkdown'
export type { TiptapJsonMark, TiptapJsonNode } from './mobileDocumentContent.types'
