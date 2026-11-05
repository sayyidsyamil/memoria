import * as Y from 'yjs'
import { DOC_BLOCKS_FRAGMENT, DOC_FRONTMATTER_FIELD } from '../../../../packages/protocol/src/index.ts'
import { type LinkRewrites, linkEdits, rewriteLinks, type TextEdit } from '../renameLinks.ts'

/**
 * A rename's wikilink rewrite applied to a live document with the smallest changes Yjs has:
 * the `target` attribute of each `wikilink` element that points at the note, and the exact
 * ranges of plain text (frontmatter, code) that spell such a link. No block is replaced, so
 * an edit made at the same time anywhere else, even in the same paragraph, is kept.
 * Must run inside a transaction on the document.
 */

const WIKILINK_ELEMENT = 'wikilink'
const TARGET_ATTRIBUTE = 'target'
/** Stands for an embed in a text's characters: never part of a `[[` or `]]`. */
const EMBED = '￼'

type Attributes = Record<string, unknown>

interface DeltaOp {
  insert?: unknown
  attributes?: Attributes
}

function opText(op: DeltaOp): string {
  return typeof op.insert === 'string' ? op.insert : EMBED
}

/** The characters of a text, one per Yjs position. */
function plainText(text: Y.Text): string {
  return (text.toDelta() as DeltaOp[]).map(opText).join('')
}

/** The formatting of the character at `index`, carried over to its replacement (none: `{}`, not inherited). */
function formatAt(text: Y.Text, index: number): Attributes {
  let offset = 0
  for (const op of text.toDelta() as DeltaOp[]) {
    offset += opText(op).length
    if (index < offset) return op.attributes ?? {}
  }
  return {}
}

function patchRanges(text: Y.Text, edits: readonly TextEdit[]): void {
  // Back to front, so the positions of earlier edits stay valid.
  for (const edit of [...edits].reverse()) {
    const attributes = formatAt(text, edit.start)
    text.delete(edit.start, edit.end - edit.start)
    text.insert(edit.start, edit.text, attributes)
  }
}

function patchText(text: Y.Text, rewrite: LinkRewrites): void {
  const edits = linkEdits(plainText(text), rewrite)
  if (edits.length > 0) patchRanges(text, edits)
}

function patchWikilink(element: Y.XmlElement, rewrite: LinkRewrites): void {
  const target = element.getAttribute(TARGET_ATTRIBUTE)
  if (typeof target !== 'string') return
  const link = `[[${target}]]`
  const rewritten = rewriteLinks(link, rewrite)
  if (rewritten !== link) element.setAttribute(TARGET_ATTRIBUTE, rewritten.slice(2, -2))
}

function patchChildren(parent: Y.XmlFragment | Y.XmlElement, rewrite: LinkRewrites): void {
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlText) patchText(child, rewrite)
    if (!(child instanceof Y.XmlElement)) continue
    if (child.nodeName === WIKILINK_ELEMENT) patchWikilink(child, rewrite)
    patchChildren(child, rewrite)
  }
}

export function patchLiveLinks(doc: Y.Doc, rewrite: LinkRewrites): void {
  patchText(doc.getText(DOC_FRONTMATTER_FIELD), rewrite)
  patchChildren(doc.getXmlFragment(DOC_BLOCKS_FRAGMENT), rewrite)
}
