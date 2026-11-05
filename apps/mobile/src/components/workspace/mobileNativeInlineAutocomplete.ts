import { activeMobileEmojiShortcodeQuery, activeMobilePersonMentionQuery, activeMobileWikilinkQuery } from '../../workspace/mobileWikilinkAutocomplete'
import type { TiptapJsonNode } from '../../workspace/mobileDocumentContent'
import type { NativeWysiwygSelection, NativeWysiwygInlineAutocomplete, NativeWysiwygInlineMatchInput, NativeWysiwygProjectedInlineText } from './mobileNativeWikilink.types'
import { isTiptapDocument, normalizedSelection, isInlineContainer, tiptapNodeSize } from './mobileNativeDocumentTree'

type InlineNodeCursor = {
  position: number
  nodeStart: number
  nodeEnd: number
}

type InlineContentCursor = {
  position: number
  contentStart: number
}

export function nativeWysiwygInlineAutocompleteAtSelection({
  json,
  selection,
}: {
  json: unknown
  selection?: NativeWysiwygSelection
}): NativeWysiwygInlineAutocomplete | null {
  if (!isTiptapDocument(json) || !selection) return null
  const normalized = normalizedSelection(selection)
  if (normalized.from !== normalized.to) return null

  return findInlineAutocompleteAtPosition(json, { position: normalized.from })
}

function findInlineAutocompleteAtPosition(
  node: TiptapJsonNode,
  { position, nodeStart = 0 }: { position: number; nodeStart?: number },
): NativeWysiwygInlineAutocomplete | null {
  if (isInlineContainer(node)) {
    return inlineAutocompleteForContainer(node, { position, contentStart: nodeStart + 1 })
  }

  const children = node.content ?? []
  let childStart = node.type === 'doc' ? nodeStart : nodeStart + 1
  for (const child of children) {
    const childEnd = childStart + tiptapNodeSize(child)
    if (position >= childStart && position <= childEnd) {
      const match = findInlineAutocompleteAtPosition(child, { position, nodeStart: childStart })
      if (match) return match
    }
    childStart = childEnd
  }

  return null
}

function inlineAutocompleteForContainer(
  node: TiptapJsonNode,
  cursor: InlineContentCursor,
): NativeWysiwygInlineAutocomplete | null {
  const content = node.content ?? []
  if (positionInsideCodeMark(content, cursor)) return null

  const projection = projectedInlineText(content, cursor)
  const match = activeInlineQuery(projection)
  return match ? inlineAutocompleteMatch({ ...match, position: cursor.position, projection }) : null
}

const autocompleteSources = [
  { kind: 'wikilink', read: activeMobileWikilinkQuery },
  { kind: 'personMention', read: activeNonemptyPersonMention },
  { kind: 'emoji', read: activeMobileEmojiShortcodeQuery },
] as const

function activeInlineQuery(projection: NativeWysiwygProjectedInlineText) {
  for (const { kind, read } of autocompleteSources) {
    const match = read(projection.text, projection.cursor)
    if (match) return { ...match, kind }
  }
  return null
}

function activeNonemptyPersonMention(text: string, cursor: number) {
  const match = activeMobilePersonMentionQuery(text, cursor)
  return match?.query.length ? match : null
}

function inlineAutocompleteMatch({
  kind,
  position,
  projection,
  query,
  start,
}: NativeWysiwygInlineMatchInput): NativeWysiwygInlineAutocomplete | null {
  const from = projection.positions[start]
  if (from === undefined) return null

  return {
    kind,
    query,
    range: { from, to: position },
  }
}

function projectedInlineText(
  nodes: TiptapJsonNode[],
  { position, contentStart }: InlineContentCursor,
): NativeWysiwygProjectedInlineText {
  const positions: number[] = []
  let cursor = contentStart
  let text = ''
  let textCursor: number | null = null

  for (const node of nodes) {
    const nodeSize = tiptapNodeSize(node)
    const nodeEnd = cursor + nodeSize
    const projectedCursor = inlineNodeCursorOffset(node, { position, nodeStart: cursor, nodeEnd, textLength: text.length })
    if (projectedCursor !== null) textCursor = projectedCursor
    text += appendInlineNodeProjection(node, { nodeStart: cursor, positions })
    cursor = nodeEnd
  }

  return {
    cursor: textCursor ?? text.length,
    positions,
    text,
  }
}

function inlineNodeCursorOffset(node: TiptapJsonNode, cursor: InlineNodeCursor & { textLength: number }) {
  if (cursor.position < cursor.nodeStart || cursor.position > cursor.nodeEnd) return null
  return typeof node.text === 'string' ? cursor.textLength + cursor.position - cursor.nodeStart : cursor.textLength
}

function appendInlineNodeProjection(node: TiptapJsonNode, { nodeStart, positions }: { nodeStart: number; positions: number[] }): string {
  if (typeof node.text !== 'string') {
    positions.push(nodeStart)
    return '\n'
  }
  for (let index = 0; index < node.text.length; index += 1) positions.push(nodeStart + index)
  return node.text
}

function positionInsideCodeMark(
  nodes: TiptapJsonNode[],
  { position, contentStart }: InlineContentCursor,
): boolean {
  let cursor = contentStart

  for (const node of nodes) {
    const nodeEnd = cursor + tiptapNodeSize(node)
    if (positionTargetsCodeMarkedText(node, { position, nodeStart: cursor, nodeEnd })) {
      return true
    }
    cursor = nodeEnd
  }

  return false
}

function positionTargetsCodeMarkedText(
  node: TiptapJsonNode,
  { position, nodeStart, nodeEnd }: InlineNodeCursor,
): boolean {
  if (typeof node.text !== 'string') return false
  if (!hasCodeMark(node)) return false

  return position > nodeStart && position <= nodeEnd
}

function hasCodeMark(node: TiptapJsonNode): boolean {
  return node.marks?.some((mark) => mark.type === 'code') ?? false
}
