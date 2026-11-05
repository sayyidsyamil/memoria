import { mobileWikilinkHref } from '../../workspace/mobileWikilinks'
import { isMobileImageAttachment } from '../../workspace/mobileAttachments'
import type { TiptapJsonNode } from '../../workspace/mobileDocumentContent'
import { mobileMarkdownSourceBlockFormat, mobileMarkdownSourceBlockLines } from '../../workspace/mobileMarkdownSourceBlocks'
import type { NativeWysiwygMarkdownBlockAction } from './MobileWysiwygFormatCommands'
import type { NativeWysiwygWikilinkPayload, NativeWysiwygWikilinkTextNode, NativeWysiwygAttachmentPayload, NativeWysiwygSelection, NativeWysiwygMarkdownBlockPayload, NativeWysiwygPlainTextPayload, NativeWysiwygInsertionResult } from './mobileNativeWikilink.types'
import { isTiptapDocument, normalizedSelection, isInlineContainer, tiptapNodeSize } from './mobileNativeDocumentTree'

export function nativeWysiwygWikilinkContent(
  payload: NativeWysiwygWikilinkPayload,
): NativeWysiwygWikilinkTextNode[] | null {
  const target = payload.target.trim()
  if (!target) return null

  const label = payload.label.trim() || target
  return [
    {
      marks: [{ attrs: { href: mobileWikilinkHref(target) }, type: 'link' }],
      text: label,
      type: 'text',
    },
    { text: ' ', type: 'text' },
  ]
}

export function nativeWysiwygAttachmentContent(
  payload: NativeWysiwygAttachmentPayload,
): NativeWysiwygWikilinkTextNode[] | TiptapJsonNode[] | null {
  return isMobileImageAttachment(payload)
    ? nativeWysiwygImageAttachmentContent(payload)
    : nativeWysiwygLinkAttachmentContent(payload)
}

export function nativeWysiwygDocumentWithInsertedWikilink({
  json,
  payload,
  selection,
}: {
  json: unknown
  payload: NativeWysiwygWikilinkPayload,
  selection?: NativeWysiwygSelection
}): TiptapJsonNode | null {
  if (!isTiptapDocument(json)) return null
  const content = nativeWysiwygWikilinkContent(payload)
  if (!content) return null

  return insertInlineContentWithFallback(json, content, selection)
}

export function nativeWysiwygDocumentWithInsertedAttachment({
  json,
  payload,
  selection,
}: {
  json: unknown
  payload: NativeWysiwygAttachmentPayload
  selection?: NativeWysiwygSelection
}): TiptapJsonNode | null {
  if (!isTiptapDocument(json)) return null

  return isMobileImageAttachment(payload)
    ? insertImageAttachment(json, payload, selection)
    : insertLinkAttachment(json, payload, selection)
}

export function nativeWysiwygDocumentWithInsertedMarkdownBlock({
  json,
  payload,
  selection,
}: {
  json: unknown
  payload: NativeWysiwygMarkdownBlockPayload
  selection?: NativeWysiwygSelection
}): TiptapJsonNode | null {
  if (!isTiptapDocument(json)) return null

  return insertBlockAfterSelection(json, nativeWysiwygMarkdownBlockNode(payload.action), selection).node
}

export function nativeWysiwygDocumentWithInsertedPlainText({
  json,
  payload,
  selection,
}: {
  json: unknown
  payload: NativeWysiwygPlainTextPayload
  selection?: NativeWysiwygSelection
}): TiptapJsonNode | null {
  if (!isTiptapDocument(json)) return null

  const content = nativeWysiwygPlainTextContent(payload)
  if (!content) return null

  return insertInlineContentWithFallback(json, content, selection)
}

export function nativeWysiwygPlainTextContent(
  payload: NativeWysiwygPlainTextPayload,
): TiptapJsonNode[] | null {
  if (!payload.text) return null

  return payload.text.split('\n').flatMap((line, index): TiptapJsonNode[] => [
    ...(index > 0 ? [{ type: 'hardBreak' }] : []),
    ...(line ? [{ text: line, type: 'text' }] : []),
  ])
}

function nativeWysiwygImageAttachmentContent(payload: NativeWysiwygAttachmentPayload): TiptapJsonNode[] | null {
  const path = payload.path.trim()
  if (!path) return null

  return [{
    attrs: { alt: payload.name.trim() || 'attachment', src: path },
    type: 'image',
  }]
}

function nativeWysiwygLinkAttachmentContent(
  payload: NativeWysiwygAttachmentPayload,
): NativeWysiwygWikilinkTextNode[] | null {
  const path = payload.path.trim()
  if (!path) return null

  return [
    {
      marks: [{ attrs: { href: path }, type: 'link' }],
      text: payload.name.trim() || path,
      type: 'text',
    },
    { text: ' ', type: 'text' },
  ]
}

function nativeWysiwygMarkdownBlockNode(action: NativeWysiwygMarkdownBlockAction): TiptapJsonNode {
  if (action === 'codeBlock') return nativeWysiwygCodeBlockNode()
  if (action === 'mathBlock') return nativeWysiwygMathBlockNode()
  if (action === 'table') return nativeWysiwygTableNode()
  return nativeWysiwygSourceParagraph(mobileMarkdownSourceBlockLines(action))
}

function nativeWysiwygCodeBlockNode(): TiptapJsonNode {
  return {
    attrs: { language: 'text' },
    content: [{ text: mobileMarkdownSourceBlockFormat('codeBlock')?.fallback ?? '', type: 'text' }],
    type: 'codeBlock',
  }
}

function nativeWysiwygMathBlockNode(): TiptapJsonNode {
  return {
    attrs: {
      latex: mobileMarkdownSourceBlockFormat('mathBlock')?.fallback ?? '',
    },
    type: 'mathBlock',
  }
}

function nativeWysiwygTableNode(): TiptapJsonNode {
  return {
    content: [
      nativeWysiwygTableRow('tableHeader', ['Column', 'Value']),
      nativeWysiwygTableRow('tableCell', ['Item', 'Detail']),
    ],
    type: 'table',
  }
}

function nativeWysiwygTableRow(cellType: 'tableCell' | 'tableHeader', cells: string[]): TiptapJsonNode {
  return {
    content: cells.map((cell) => nativeWysiwygTableCell(cellType, cell)),
    type: 'tableRow',
  }
}

function nativeWysiwygTableCell(cellType: 'tableCell' | 'tableHeader', text: string): TiptapJsonNode {
  return {
    content: [{ content: [{ text, type: 'text' }], type: 'paragraph' }],
    type: cellType,
  }
}

function nativeWysiwygSourceParagraph(lines: string[]): TiptapJsonNode {
  return {
    content: lines.flatMap((line, index): TiptapJsonNode[] => [
      ...(index > 0 ? [{ type: 'hardBreak' }] : []),
      ...(line ? [{ text: line, type: 'text' }] : []),
    ]),
    type: 'paragraph',
  }
}

function insertImageAttachment(
  node: TiptapJsonNode,
  payload: NativeWysiwygAttachmentPayload,
  selection?: NativeWysiwygSelection,
): TiptapJsonNode | null {
  const content = nativeWysiwygImageAttachmentContent(payload)
  if (!content) return null

  return insertBlockAfterSelection(node, content[0], selection)?.node ?? null
}

function insertLinkAttachment(
  node: TiptapJsonNode,
  payload: NativeWysiwygAttachmentPayload,
  selection?: NativeWysiwygSelection,
): TiptapJsonNode | null {
  const content = nativeWysiwygLinkAttachmentContent(payload)
  if (!content) return null

  return insertInlineContentWithFallback(node, content, selection)
}

function insertInlineContentWithFallback(
  node: TiptapJsonNode,
  content: TiptapJsonNode[],
  selection?: NativeWysiwygSelection,
): TiptapJsonNode | null {
  const selectedDocument = selection
    ? insertWikilinkAtSelection(node, content, normalizedSelection(selection))
    : null
  if (selectedDocument?.inserted) return selectedDocument.node

  return appendWikilinkToFirstParagraph(node, content)?.node ?? null
}

function insertWikilinkAtSelection(
  node: TiptapJsonNode,
  wikilinkContent: TiptapJsonNode[],
  selection: NativeWysiwygSelection,
  nodeStart = 0,
): NativeWysiwygInsertionResult | null {
  if (isInlineContainer(node)) {
    return insertWikilinkIntoInlineContainer(node, wikilinkContent, selection, nodeStart + 1)
  }

  const children = node.content ?? []
  let childStart = node.type === 'doc' ? nodeStart : nodeStart + 1
  for (const [index, child] of children.entries()) {
    const childEnd = childStart + tiptapNodeSize(child)
    if (selection.from >= childStart && selection.from <= childEnd) {
      const childResult = insertWikilinkAtSelection(child, wikilinkContent, selection, childStart)
      if (childResult?.inserted) return withReplacedChild(node, index, childResult.node)
    }
    childStart = childEnd
  }

  return null
}

function appendWikilinkToFirstParagraph(
  node: TiptapJsonNode,
  wikilinkContent: TiptapJsonNode[],
): NativeWysiwygInsertionResult | null {
  return appendWikilinkToNodeType(node, wikilinkContent, 'paragraph')
    ?? appendWikilinkToNodeType(node, wikilinkContent, 'heading')
}

function insertBlockAfterSelection(
  node: TiptapJsonNode,
  block: TiptapJsonNode,
  selection?: NativeWysiwygSelection,
): NativeWysiwygInsertionResult {
  const children = node.content ?? []
  const insertionIndex = selection ? blockInsertionIndex(children, normalizedSelection(selection)) : children.length

  return {
    inserted: true,
    node: {
      ...node,
      content: [
        ...children.slice(0, insertionIndex).map(cloneNode),
        cloneNode(block),
        ...children.slice(insertionIndex).map(cloneNode),
      ],
    },
  }
}

function blockInsertionIndex(
  children: TiptapJsonNode[],
  selection: NativeWysiwygSelection,
): number {
  let childStart = 0
  for (const [index, child] of children.entries()) {
    const childEnd = childStart + tiptapNodeSize(child)
    if (selection.from >= childStart && selection.from <= childEnd) return index + 1
    childStart = childEnd
  }

  return children.length
}

function appendWikilinkToNodeType(
  node: TiptapJsonNode,
  wikilinkContent: TiptapJsonNode[],
  type: string,
): NativeWysiwygInsertionResult | null {
  if (node.type === type) {
    return {
      inserted: true,
      node: {
        ...node,
        content: [...(node.content ?? []), ...wikilinkContent.map(cloneNode)],
      },
    }
  }

  for (const [index, child] of (node.content ?? []).entries()) {
    const childResult = appendWikilinkToNodeType(child, wikilinkContent, type)
    if (childResult?.inserted) return withReplacedChild(node, index, childResult.node)
  }

  return null
}

function insertWikilinkIntoInlineContainer(
  node: TiptapJsonNode,
  wikilinkContent: TiptapJsonNode[],
  selection: NativeWysiwygSelection,
  contentStart: number,
): NativeWysiwygInsertionResult {
  return {
    inserted: true,
    node: {
      ...node,
      content: inlineContentWithInsertedWikilink(node.content ?? [], wikilinkContent, selection, contentStart),
    },
  }
}

function inlineContentWithInsertedWikilink(
  nodes: TiptapJsonNode[],
  wikilinkContent: TiptapJsonNode[],
  selection: NativeWysiwygSelection,
  contentStart: number,
): TiptapJsonNode[] {
  if (nodes.length === 0) return wikilinkContent.map(cloneNode)

  const contextualContent = inlineContentForSelection(nodes, wikilinkContent, selection, contentStart)
  return [
    ...inlineNodesBefore(nodes, selection.from, contentStart),
    ...contextualContent.map(cloneNode),
    ...inlineNodesAfter(nodes, contextualContent, selection.to, contentStart),
  ]
}

function inlineContentForSelection(
  nodes: TiptapJsonNode[],
  content: TiptapJsonNode[],
  selection: NativeWysiwygSelection,
  contentStart: number,
): TiptapJsonNode[] {
  const nextCharacter = firstInlineTextCharacterAtOrAfter(nodes, selection.to, contentStart)
  if (keepsTrailingInlineSeparator(nextCharacter)) return content

  return withoutTrailingInlineSeparator(content)
}

function firstInlineTextCharacterAtOrAfter(
  nodes: TiptapJsonNode[],
  position: number,
  contentStart: number,
): string | null {
  let cursor = contentStart

  for (const node of nodes) {
    const nodeEnd = cursor + tiptapNodeSize(node)
    if (typeof node.text === 'string') {
      if (position < nodeEnd) return node.text.at(Math.max(position - cursor, 0)) ?? null
    } else if (position <= nodeEnd) {
      return null
    }
    cursor = nodeEnd
  }

  return null
}

function keepsTrailingInlineSeparator(nextCharacter: string | null): boolean {
  if (nextCharacter === null) return true
  if (/\s/u.test(nextCharacter)) return true

  return !/^[,.;:!?%)}\]”’]/u.test(nextCharacter)
}

function withoutTrailingInlineSeparator(content: TiptapJsonNode[]): TiptapJsonNode[] {
  const trailingNode = content.at(-1)
  return trailingNode?.text === ' ' ? content.slice(0, -1) : content
}

function inlineNodesBefore(
  nodes: TiptapJsonNode[],
  position: number,
  contentStart: number,
): TiptapJsonNode[] {
  const before: TiptapJsonNode[] = []
  let cursor = contentStart

  for (const node of nodes) {
    const nodeEnd = cursor + tiptapNodeSize(node)
    appendInlineSlice(before, node, 0, Math.min(position, nodeEnd) - cursor)
    if (position <= nodeEnd) break
    cursor = nodeEnd
  }

  return before
}

function inlineNodesAfter(
  nodes: TiptapJsonNode[],
  wikilinkContent: TiptapJsonNode[],
  position: number,
  contentStart: number,
): TiptapJsonNode[] {
  const after: TiptapJsonNode[] = []
  let cursor = contentStart
  let trimLeadingSpace = wikilinkContent.at(-1)?.text === ' '

  for (const node of nodes) {
    const nodeEnd = cursor + tiptapNodeSize(node)
    if (position < nodeEnd) {
      const beforeLength = after.length
      appendInlineSlice(after, node, Math.max(position - cursor, 0), nodeEnd - cursor, { trimLeadingSpace })
      trimLeadingSpace = trimLeadingSpace && after.length === beforeLength
    }
    cursor = nodeEnd
  }

  return after
}

function appendInlineSlice(
  nodes: TiptapJsonNode[],
  node: TiptapJsonNode,
  from: number,
  to: number,
  options: { trimLeadingSpace?: boolean } = {},
): void {
  if (from >= to) return
  if (typeof node.text === 'string') {
    const text = node.text.slice(from, to)
    const normalizedText = options.trimLeadingSpace && text.startsWith(' ') ? text.slice(1) : text
    if (normalizedText) nodes.push(textNodeWithText(node, normalizedText))
    return
  }
  if (from === 0 && to >= tiptapNodeSize(node)) nodes.push(cloneNode(node))
}

function withReplacedChild(
  node: TiptapJsonNode,
  index: number,
  child: TiptapJsonNode,
): NativeWysiwygInsertionResult {
  return {
    inserted: true,
    node: {
      ...node,
      content: (node.content ?? []).map((candidate, candidateIndex) => (
        candidateIndex === index ? child : cloneNode(candidate)
      )),
    },
  }
}

function textNodeWithText(node: TiptapJsonNode, text: string): TiptapJsonNode {
  return { ...cloneNode(node), text }
}

function cloneNode(node: TiptapJsonNode): TiptapJsonNode {
  return {
    ...node,
    attrs: node.attrs ? { ...node.attrs } : undefined,
    content: node.content?.map(cloneNode),
    marks: node.marks?.map((mark) => ({
      ...mark,
      attrs: mark.attrs ? { ...mark.attrs } : undefined,
    })),
  }
}

export type { NativeWysiwygWikilinkPayload, NativeWysiwygSelection, NativeWysiwygInlineAutocompleteKind, NativeWysiwygInlineAutocomplete, NativeWysiwygAttachmentPayload, NativeWysiwygMarkdownBlockPayload, NativeWysiwygPlainTextPayload } from './mobileNativeWikilink.types'
export { nativeWysiwygInlineAutocompleteAtSelection } from './mobileNativeInlineAutocomplete'
