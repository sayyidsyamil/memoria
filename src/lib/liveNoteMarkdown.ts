import type { Block, BlockNoteEditor, BlockSchema, InlineContentSchema, StyleSchema } from '@blocknote/core'
import type * as Y from 'yjs'
import { patchBlocks } from '../../packages/markdown-yjs/src/blockPatch'
import { markdownToBlocks } from '../../packages/markdown-yjs/src/markdownParse'
import { patchText } from '../../packages/markdown-yjs/src/textPatch'
import { DOC_BLOCKS_FRAGMENT, DOC_FRONTMATTER_FIELD } from '../../packages/protocol/src/index'
import { splitFrontmatter } from '../utils/wikilinks'

/**
 * A whole note's markdown written into its live document, the way the server writes a file
 * into one: the frontmatter text and the blocks change only where they differ, in one
 * transaction. The server then saves it to the file like any other edit of the document, so
 * nothing else writes the file meanwhile. The web raw editor saves through this.
 */

/** Transaction origin of a raw-mode edit, for observers that tell edits apart. */
export const RAW_EDIT_ORIGIN = 'memoria:raw-edit'

/** Resolves with the blocks written, or null when a later write replaced this one first. */
export type LiveMarkdownWrite<TBlock> = (markdown: string) => Promise<TBlock[] | null>

/** Parsing is asynchronous: of writes made in a row, only the last one is applied. */
export function createLiveMarkdownWriter<B extends BlockSchema, I extends InlineContentSchema, S extends StyleSchema>(
  doc: Y.Doc,
  editor: BlockNoteEditor<B, I, S>,
): LiveMarkdownWrite<Block<B, I, S>> {
  let latest = 0
  return async (markdown) => {
    latest += 1
    const write = latest
    const [frontmatter, body] = splitFrontmatter(markdown)
    const blocks = await markdownToBlocks(editor, body)
    if (write !== latest) return null
    doc.transact(() => {
      patchText(doc.getText(DOC_FRONTMATTER_FIELD), frontmatter)
      patchBlocks(editor, doc.getXmlFragment(DOC_BLOCKS_FRAGMENT), blocks)
    }, RAW_EDIT_ORIGIN)
    return blocks
  }
}
