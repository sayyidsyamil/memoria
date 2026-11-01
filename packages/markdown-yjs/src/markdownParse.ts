import { repairMalformedEditorBlocks } from '../../../src/hooks/editorBlockRepair'
import { parseMarkdownBlocksWithFallback } from '../../../src/hooks/editorMarkdownParseFallback'
import { inferCodeBlockLanguages } from '../../../src/utils/codeBlockLanguage'
import { injectRichEditorMarkdownBlocks, preProcessRichEditorMarkdown } from '../../../src/utils/richEditorMarkdown'

/**
 * Markdown body to BlockNote blocks, through the same steps the Memoria editor runs when it
 * opens a note (`src/hooks/editorBlockResolution.ts`). It needs no DOM of its own, so the web
 * editor parses with its live editor exactly as the server parses with its headless one.
 */

/** A BlockNote editor, mounted or headless: the parser of its schema. */
export interface MarkdownBlockParser<TBlock> {
  tryParseMarkdownToBlocks(markdown: string): TBlock[]
}

const EMPTY_CHECKLIST_FILLER = '​'

interface LooseBlock {
  type?: string
  content?: unknown
  children?: unknown
}

function isFillerContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length !== 1) return false
  const [item] = content as { type?: unknown; text?: unknown }[]
  return item.type === 'text' && item.text === EMPTY_CHECKLIST_FILLER
}

/** The preprocessor gives an empty checklist item a filler so the parser keeps it. */
function withoutChecklistFillers(blocks: unknown[]): unknown[] {
  for (const block of blocks as LooseBlock[]) {
    if (block.type === 'checkListItem' && isFillerContent(block.content)) block.content = []
    if (Array.isArray(block.children)) withoutChecklistFillers(block.children)
  }
  return blocks
}

function editorBlocks(parsed: unknown[]): unknown[] {
  const safe = withoutChecklistFillers(repairMalformedEditorBlocks(parsed))
  return inferCodeBlockLanguages(repairMalformedEditorBlocks(injectRichEditorMarkdownBlocks(safe)))
}

/** The body of a note (no frontmatter) as the blocks the editor would show. */
export async function markdownToBlocks<TBlock>(editor: MarkdownBlockParser<TBlock>, body: string): Promise<TBlock[]> {
  const source = body.trimStart()
  const parsed = await parseMarkdownBlocksWithFallback({
    parseMarkdownBlocks: (markdown) => editor.tryParseMarkdownToBlocks(markdown),
    preprocessed: preProcessRichEditorMarkdown(source),
    sourceMarkdown: source,
    context: 'note',
  })
  const blocks = parsed.usedSourceFallback ? parsed.blocks : editorBlocks(parsed.blocks)
  return blocks as TBlock[]
}
