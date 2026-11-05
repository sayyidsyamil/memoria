import type { TiptapJsonNode } from '../../workspace/mobileDocumentContent'
import type { NativeWysiwygSelection } from './MobileWysiwygWikilinkBridgeModel'

type RemoveExternalLinkInput = {
  json: unknown
  selection?: NativeWysiwygSelection
}
type RemoveResult = {
  changed: boolean
  nextPosition: number
  node: TiptapJsonNode
}

export function nativeWysiwygDocumentWithoutExternalLink({
  json,
  selection,
}: RemoveExternalLinkInput): unknown | null {
  if (!isTiptapJsonNode(json)) return null

  const result = removeExternalLinkMarks(json, {
    from: selection?.from ?? Number.NEGATIVE_INFINITY,
    to: selection?.to ?? Number.POSITIVE_INFINITY,
  }, 0)

  return result.changed ? result.node : null
}

function removeExternalLinkMarks(
  node: TiptapJsonNode,
  selection: NativeWysiwygSelection,
  position: number,
): RemoveResult {
  if (typeof node.text === 'string') return removeExternalLinkMarksFromTextNode(node, selection, position)
  const boundarySize = node.type === 'doc' ? 0 : 1
  const children = node.content ?? []
  if (children.length === 0) {
    return {
      changed: false,
      nextPosition: position + boundarySize,
      node,
    }
  }

  let changed = false
  let cursor = position + boundarySize
  const content = children.map((child) => {
    const result = removeExternalLinkMarks(child, selection, cursor)
    cursor = result.nextPosition
    changed = changed || result.changed
    return result.node
  })

  return {
    changed,
    nextPosition: cursor + boundarySize,
    node: changed ? { ...node, content } : node,
  }
}

function removeExternalLinkMarksFromTextNode(
  node: TiptapJsonNode,
  selection: NativeWysiwygSelection,
  position: number,
): RemoveResult {
  const textLength = node.text?.length ?? 0
  const nextPosition = position + textLength
  if (!rangesOverlap(selection, { from: position, to: nextPosition })) {
    return { changed: false, nextPosition, node }
  }

  const previousMarks = node.marks ?? []
  const marks = previousMarks.filter((mark) => mark.type !== 'link')
  const changed = marks.length !== previousMarks.length
  if (!changed) return { changed: false, nextPosition, node }

  return {
    changed,
    nextPosition,
    node: marks.length > 0 ? { ...node, marks } : withoutMarks(node),
  }
}

function rangesOverlap(left: NativeWysiwygSelection, right: NativeWysiwygSelection): boolean {
  return left.from < right.to && right.from < left.to
}

function withoutMarks(node: TiptapJsonNode): TiptapJsonNode {
  const nextNode = { ...node }
  delete nextNode.marks
  return nextNode
}

function isTiptapJsonNode(value: unknown): value is TiptapJsonNode {
  return Boolean(value) && typeof value === 'object'
}
