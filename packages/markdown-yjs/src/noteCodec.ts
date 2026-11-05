import { yXmlFragmentToBlocks } from '@blocknote/core/yjs'
import type * as Y from 'yjs'
import { splitFrontmatter } from '../../../src/utils/wikilinks'
import {
  DOC_BLOCKS_FRAGMENT,
  DOC_FORMAT,
  DOC_FRONTMATTER_FIELD,
  DOC_META,
  DOC_META_MAP,
} from '../../protocol/src/index.ts'
import { patchBlocks, patchText } from './blockPatch.ts'
import { type DocVocabulary, docVocabulary, vocabularyViolation } from './docVocabulary.ts'
import { preserveSource, type SourceVersions } from './sourcePreserve.ts'
import { blocksToMarkdown, createHeadlessEditor, type HeadlessEditor, markdownToBlocks, type NoteBlock } from './markdownBlocks.ts'

/**
 * A note as a `memoria.blocknote/1` document:
 *  - `blocks`: a `Y.XmlFragment` with the body, in the shape BlockNote's collaboration binds to;
 *  - `frontmatter`: a `Y.Text` with the frontmatter block exactly as it is in the file,
 *    delimiters included, or empty;
 *  - `meta`: a `Y.Map` with `format` and `baseRevision`.
 */

/** What to write to the file for a document, and whether the source's formatting was kept. */
export interface FileContent {
  markdown: string
  preserved: boolean
}

/** The content of a note's file at one revision (its etag). */
export interface NoteVersion {
  markdown: string
  revision: string
}

export interface ParsedNote {
  frontmatter: string
  blocks: NoteBlock[]
}

export class NoteCodec {
  private readonly editor: HeadlessEditor
  private readonly vocabulary: DocVocabulary

  constructor(editor: HeadlessEditor = createHeadlessEditor()) {
    this.editor = editor
    this.vocabulary = docVocabulary(editor)
  }

  /** Why a document is not one this codec can hold, or null when it is made of known parts. */
  violation(doc: Y.Doc): string | null {
    return vocabularyViolation(doc, this.vocabulary)
  }

  async parse(markdown: string): Promise<ParsedNote> {
    const [frontmatter, body] = splitFrontmatter(markdown)
    return { frontmatter, blocks: await markdownToBlocks(this.editor, body) }
  }

  serialize({ frontmatter, blocks }: ParsedNote): string {
    return `${frontmatter}${blocksToMarkdown(this.editor, blocks)}`
  }

  /** The serializer's rendering of a markdown file: what an unedited document reads back as. */
  async canonical(markdown: string): Promise<string> {
    return this.serialize(await this.parse(markdown))
  }

  /**
   * The file content for an edited document: the source file with the edit applied. The result
   * must read back as exactly the document; if carrying the edit over to the source's
   * formatting would change the content, the serializer's form is written instead.
   */
  async fileContent(versions: SourceVersions): Promise<FileContent> {
    const markdown = preserveSource(versions)
    if ((await this.canonical(markdown)) === versions.canonical) return { markdown, preserved: true }
    return { markdown: versions.canonical, preserved: false }
  }

  /** The document as markdown, in the serializer's form. */
  read(doc: Y.Doc): string {
    return this.serialize({
      frontmatter: doc.getText(DOC_FRONTMATTER_FIELD).toString(),
      blocks: yXmlFragmentToBlocks(this.editor, doc.getXmlFragment(DOC_BLOCKS_FRAGMENT)),
    })
  }

  /**
   * Makes the document say what the markdown says, changing only the blocks that differ.
   * Fills an empty document.
   */
  async write(doc: Y.Doc, { markdown, revision }: NoteVersion, origin: unknown = null): Promise<void> {
    const note = await this.parse(markdown)
    doc.transact(() => {
      patchText(doc.getText(DOC_FRONTMATTER_FIELD), note.frontmatter)
      patchBlocks(this.editor, doc.getXmlFragment(DOC_BLOCKS_FRAGMENT), note.blocks)
      setRevision(doc, revision)
    }, origin)
  }
}

/** Records the file revision the document is in step with. Call inside a transaction or alone. */
export function setRevision(doc: Y.Doc, revision: string): void {
  const meta = doc.getMap<string>(DOC_META_MAP)
  if (meta.get(DOC_META.format) !== DOC_FORMAT) meta.set(DOC_META.format, DOC_FORMAT)
  if (meta.get(DOC_META.baseRevision) !== revision) meta.set(DOC_META.baseRevision, revision)
}

export function baseRevision(doc: Y.Doc): string | undefined {
  return doc.getMap<string>(DOC_META_MAP).get(DOC_META.baseRevision)
}
