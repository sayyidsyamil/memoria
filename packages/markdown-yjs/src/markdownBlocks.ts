import { BlockNoteEditor } from '@blocknote/core'
import type { DirectMarkdownCapableSerializer } from '../../../src/utils/blockNoteDirectMarkdown'
import { installRichEditorMarkdownSerializer, serializeRichEditorBlocksToMarkdown } from '../../../src/utils/richEditorMarkdown'
import { installHeadlessDom } from './headlessDom.ts'
import { markdownToBlocks as parseMarkdownBlocks } from './markdownParse.ts'
import { headlessSchema } from './schema.ts'

/**
 * Markdown body to BlockNote blocks and back, through the same steps the Memoria editor runs
 * when it opens and saves a note (`src/hooks/editorBlockResolution.ts`,
 * `src/utils/richEditorMarkdown.ts`), on an editor that is never mounted.
 */

export type HeadlessEditor = ReturnType<typeof createHeadlessEditor>
export type NoteBlock = HeadlessEditor['document'][number]

export function createHeadlessEditor() {
  installHeadlessDom()
  const editor = BlockNoteEditor.create({ schema: headlessSchema })
  installRichEditorMarkdownSerializer(editor)
  return editor
}

/** The body of a note (no frontmatter) as the blocks the editor would show. */
export function markdownToBlocks(editor: HeadlessEditor, body: string): Promise<NoteBlock[]> {
  return parseMarkdownBlocks<NoteBlock>(editor, body)
}

/** Blocks as the markdown body the editor would save. */
export function blocksToMarkdown(editor: HeadlessEditor, blocks: readonly NoteBlock[]): string {
  // The app's serializer takes blocks untyped; the editor is the same object either way.
  const serializer = editor as unknown as DirectMarkdownCapableSerializer
  return serializeRichEditorBlocksToMarkdown({ blocks: [...blocks], editor: serializer })
}
