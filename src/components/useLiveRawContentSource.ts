import type { useCreateBlockNote } from '@blocknote/react'
import { useMemo } from 'react'
import type * as Y from 'yjs'
import { DOC_FRONTMATTER_FIELD } from '../../packages/protocol/src/index'
import { createLiveMarkdownWriter } from '../lib/liveNoteMarkdown'
import { reportLiveNoteTitle } from '../lib/liveNoteTitle'
import { serializeRichEditorDocumentToMarkdown } from '../utils/richEditorMarkdown'
import { type CollabEditorBinding, liveDocumentTitle, type TitleBlock } from './collabEditorBinding'

type NoteEditor = ReturnType<typeof useCreateBlockNote>
type ContentChange = (path: string, content: string) => void
type NoteContent = string | null

/** How the raw editor reads and saves the active note. */
export interface RawContentSource {
  /** Saves raw edits. */
  contentChange: ContentChange | undefined
  /** The note the raw editor opens on, from the tab's content and path. */
  entryContent: (tabContent: NoteContent, path: string | null) => NoteContent
}

interface LiveRawContentSourceOptions {
  binding: CollabEditorBinding
  editor: NoteEditor
  onContentChange: ContentChange | undefined
  vaultPath?: string
}

function reportWriteFailure(error: unknown): void {
  console.warn('[editor] A raw edit could not be written to the live document:', error)
}

function tabEntryContent(tabContent: NoteContent): NoteContent {
  return tabContent
}

/**
 * A bound note is its live document, which property edits and raw edits change without
 * changing the tab: its properties come from the document's frontmatter, its body from the
 * rich editor, which shows the document's blocks.
 */
function liveEntryContent(doc: Y.Doc, editor: NoteEditor, vaultPath: string | undefined): RawContentSource['entryContent'] {
  return (tabContent, path) => {
    if (tabContent === null || path === null) return tabContent
    const frontmatter = doc.getText(DOC_FRONTMATTER_FIELD).toString()
    return serializeRichEditorDocumentToMarkdown({ editor, notePath: path, tabContent: frontmatter, vaultPath })
  }
}

function liveContentChange(doc: Y.Doc, editor: NoteEditor): ContentChange {
  const write = createLiveMarkdownWriter(doc, editor)
  return (path, content) => {
    write(content)
      .then((blocks) => {
        if (blocks) reportLiveNoteTitle(path, liveDocumentTitle(blocks as readonly TitleBlock[]))
      })
      .catch(reportWriteFailure)
  }
}

/**
 * Where the raw editor reads and saves. A note bound to a live document saves into the
 * document, which the server writes to the file; writing the file as well would race it. The
 * rich editor of a bound note shows the document, so it shows the edit too. Any other note
 * reads its tab and saves through `onContentChange`.
 */
export function useLiveRawContentSource({
  binding,
  editor,
  onContentChange,
  vaultPath,
}: LiveRawContentSourceOptions): RawContentSource {
  const doc = binding.kind === 'bound' ? binding.doc.doc : null
  const live = useMemo(
    () => (doc ? { contentChange: liveContentChange(doc, editor), entryContent: liveEntryContent(doc, editor, vaultPath) } : null),
    [doc, editor, vaultPath],
  )
  return useMemo(
    () => live ?? { contentChange: onContentChange, entryContent: tabEntryContent },
    [live, onContentChange],
  )
}
