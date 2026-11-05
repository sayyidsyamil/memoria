import type { TiptapJsonNode } from '../../workspace/mobileDocumentContent'
import type { NativeWysiwygSelection } from './mobileNativeWikilink.types'

export function normalizedSelection(selection: NativeWysiwygSelection): NativeWysiwygSelection {
  return {
    from: Math.max(0, Math.min(selection.from, selection.to)),
    to: Math.max(0, Math.max(selection.from, selection.to)),
  }
}

export function isInlineContainer(node: TiptapJsonNode): boolean {
  return node.type === 'paragraph' || node.type === 'heading'
}

export function isTiptapDocument(value: unknown): value is TiptapJsonNode {
  return Boolean(value && typeof value === 'object' && (value as TiptapJsonNode).type === 'doc')
}

export function tiptapNodeSize(node: TiptapJsonNode): number {
  if (typeof node.text === 'string') return node.text.length
  if (!node.content) return 1

  return node.content.reduce((size, child) => size + tiptapNodeSize(child), 2)
}
