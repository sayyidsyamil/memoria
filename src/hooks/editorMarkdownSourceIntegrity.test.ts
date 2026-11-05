import integrityMarkdown from '../test/fixtures/markdown-integrity.md?raw'
import { describe, expect, it } from 'vitest'
import { BlockNoteEditor } from '@blocknote/core'
import { schema } from '../components/editorSchema'
import { syncActiveTabIntoRawBuffer } from '../components/editorRawModeSync'
import { installRichEditorMarkdownSerializer, serializeRichEditorDocumentToMarkdown } from '../utils/richEditorMarkdown'
import { resolveBlocksForTarget } from './editorBlockResolution'

const source = integrityMarkdown
const path = '/vault/integrity.md'

async function loadedEditor() {
  const editor = BlockNoteEditor.create({ schema })
  installRichEditorMarkdownSerializer(editor)
  const { blocks } = await resolveBlocksForTarget({ editor, cache: new Map(), content: source, targetPath: path })
  editor.replaceBlocks(editor.document, blocks)
  return editor
}

describe('real editor Markdown source integrity', () => {
  it('preserves the original source after editing one rich-editor character', async () => {
    const editor = await loadedEditor()
    const first = editor.document[0]
    const content = first.content
    if (!Array.isArray(content)) throw new Error('Expected inline content')
    const edited = content.map(item => item.type === 'text'
      ? { ...item, text: item.text.replace('Inline code:', 'Inline codes:') }
      : item)
    editor.updateBlock(first, { content: edited })
    expect(serializeRichEditorDocumentToMarkdown({ editor, tabContent: source, notePath: path }))
      .toBe(source.replace('Inline code:', 'Inline codes:'))
  })

  it('seeds raw mode from the real source and keeps code spans out of wikilink nodes', async () => {
    const editor = await loadedEditor()
    const rawLatestContentRef = { current: null as string | null }
    expect(syncActiveTabIntoRawBuffer({
      editor,
      activeTabPath: path,
      activeTabContent: source,
      editorContentPath: path,
      rawLatestContentRef,
    })).toBe(source)
    expect(rawLatestContentRef.current).toBe(source)
    expect(editor.document[0].content).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'wikilink' }),
    ]))
  })
  it('preserves source through repeated saves, undo and raw re-entry', async () => {
    const editor = await loadedEditor()
    const first = editor.document[0]
    const content = first.content
    if (!Array.isArray(content)) throw new Error('Expected inline content')
    const edited = content.map(item => item.type === 'text'
      ? { ...item, text: item.text.replace('Inline code:', 'Inline codes:') }
      : item)
    editor.updateBlock(first, { content: edited })
    const saved = serializeRichEditorDocumentToMarkdown({ editor, tabContent: source, notePath: path })
    expect(serializeRichEditorDocumentToMarkdown({ editor, tabContent: saved, notePath: path })).toBe(saved)
    editor.updateBlock(first, { content })
    expect(serializeRichEditorDocumentToMarkdown({ editor, tabContent: saved, notePath: path })).toBe(source)
    expect(syncActiveTabIntoRawBuffer({ editor, activeTabPath: path, activeTabContent: source,
      editorContentPath: path, rawLatestContentRef: { current: null } })).toBe(source)
  })

  it('preserves a raw edit after reparsing into rich mode', async () => {
    const editor = await loadedEditor()
    const rawEdited = source.replace('Entity:', 'Entities:')
    const resolved = await resolveBlocksForTarget({ editor, cache: new Map(), content: rawEdited, targetPath: path })
    editor.replaceBlocks(editor.document, resolved.blocks)
    expect(serializeRichEditorDocumentToMarkdown({ editor, tabContent: rawEdited, notePath: path })).toBe(rawEdited)
  })

  it('keeps original body bytes when frontmatter properties change', async () => {
    const editor = await loadedEditor()
    const withProperties = `---\nstatus: done\n---\n${source}`
    expect(serializeRichEditorDocumentToMarkdown({ editor, tabContent: withProperties, notePath: path }))
      .toBe(withProperties)
  })

})
