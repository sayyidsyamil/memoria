import type { Block, BlockNoteEditor, BlockSchema, InlineContentSchema, StyleSchema } from '@blocknote/core'
import { blocksToYXmlFragment, yXmlFragmentToBlocks } from '@blocknote/core/yjs'
import * as Y from 'yjs'
import { patchInPlace, sameShape } from './inPlacePatch.ts'
import { type LineMatch, matchLines } from './lineMerge.ts'

/**
 * Changes a live document to a new list of blocks while touching as little as possible:
 * top-level blocks that did not change keep their Yjs items, so cursors, selections and
 * concurrent edits inside them survive. Changed blocks whose new versions line up one to one
 * and only differ in their text are patched in place, so the same holds inside them
 * (TOL-236); any other change replaces the changed blocks whole.
 */

interface Gap {
  /** Top-level blocks `[from, to)` of the live document to remove. */
  from: number
  to: number
  /** Top-level blocks `[insertFrom, insertTo)` of the new list to put in their place. */
  insertFrom: number
  insertTo: number
}

function withoutIds(_key: string, value: unknown): unknown {
  if (value instanceof Object && 'id' in value) return { ...value, id: undefined }
  return value
}

/** A block's content regardless of its id: equal signatures mean nothing to change. */
function signature(block: unknown): string {
  return JSON.stringify(block, withoutIds)
}

function gaps(matches: readonly LineMatch[], liveCount: number, nextCount: number): Gap[] {
  const found: Gap[] = []
  let live = 0
  let next = 0
  for (const [inLive, inNext] of [...matches, [liveCount, nextCount] as const]) {
    if (inLive > live || inNext > next) found.push({ from: live, to: inLive, insertFrom: next, insertTo: inNext })
    live = inLive + 1
    next = inNext + 1
  }
  return found
}

function topLevelGroup(fragment: Y.XmlFragment): Y.XmlElement {
  return fragment.get(0) as Y.XmlElement
}

/** Patches the gap's blocks in place when each lines up with a new block of the same shape. */
function patchedInPlace(group: Y.XmlElement, replacement: Y.XmlElement, gap: Gap): boolean {
  const live = group.slice(gap.from, gap.to)
  const next = replacement.slice(gap.insertFrom, gap.insertTo)
  if (live.length !== next.length || !live.every((block, index) => sameShape(block, next[index]))) return false
  for (const [index, block] of live.entries()) patchInPlace(block as Y.XmlElement, next[index] as Y.XmlElement)
  return true
}

function clones(group: Y.XmlElement, from: number, to: number): Y.XmlElement[] {
  return group.slice(from, to).map((node) => (node as Y.XmlElement).clone())
}

/**
 * Must run inside a transaction on the fragment's document. Any editor of the note schema
 * will do: the server's headless one, or the web editor bound to the fragment.
 */
export function patchBlocks<B extends BlockSchema, I extends InlineContentSchema, S extends StyleSchema>(
  editor: BlockNoteEditor<B, I, S>,
  fragment: Y.XmlFragment,
  next: Block<B, I, S>[],
): void {
  if (fragment.length === 0) {
    blocksToYXmlFragment(editor, next, fragment)
    return
  }
  const live = yXmlFragmentToBlocks(editor, fragment)
  const matches = matchLines(live.map(signature), next.map(signature))
  const replacement = topLevelGroup(blocksToYXmlFragment(editor, next, new Y.Doc().getXmlFragment('next')))
  const group = topLevelGroup(fragment)
  // Back to front, so the positions of earlier gaps stay valid.
  for (const gap of gaps(matches, live.length, next.length).reverse()) {
    if (patchedInPlace(group, replacement, gap)) continue
    group.delete(gap.from, gap.to - gap.from)
    group.insert(gap.from, clones(replacement, gap.insertFrom, gap.insertTo))
  }
}

export { patchText } from './textPatch.ts'
