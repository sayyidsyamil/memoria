import { BlockNoteEditor } from '@blocknote/core'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { RemoteBindings } from '../../packages/collab-client/src/remoteVaultBackend'
import { NoteCodec } from '../../packages/markdown-yjs/src/index'
import { onLiveNoteTitle } from '../lib/liveNoteTitle'
import type { VaultCollabDoc } from '../lib/vaultBackend/types'
import { installRichEditorMarkdownSerializer } from '../utils/richEditorMarkdown'
import type { CollabEditorBinding } from './collabEditorBinding'
import { schema } from './editorSchema'
import { useLiveRawContentSource } from './useLiveRawContentSource'

const PATH = 'projects/heron.md'
const NOTE = '---\ntype: Project\n---\n# Heron\n\nOwned by Ada.\n'

function noteEditor() {
  const editor = BlockNoteEditor.create({ schema })
  installRichEditorMarkdownSerializer(editor)
  return editor
}

type NoteEditor = ReturnType<typeof noteEditor>

async function boundTo(doc: Y.Doc): Promise<CollabEditorBinding> {
  await new NoteCodec().write(doc, { markdown: NOTE, revision: 'r1' })
  const live = { path: PATH, doc } as unknown as VaultCollabDoc<RemoteBindings>
  return { kind: 'bound', doc: live }
}

function renderSource(binding: CollabEditorBinding, editor: NoteEditor, onContentChange = vi.fn()) {
  const { result } = renderHook(() => useLiveRawContentSource({ binding, editor: editor as never, onContentChange }))
  return { source: result.current, onContentChange }
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('useLiveRawContentSource', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the tab and saves through onContentChange when the note is local', () => {
    const { source, onContentChange } = renderSource({ kind: 'local' }, noteEditor())

    expect(source.contentChange).toBe(onContentChange)
    expect(source.entryContent(NOTE, PATH)).toBe(NOTE)
  })

  it('saves raw edits of a bound note into its live document and reports the title', async () => {
    const doc = new Y.Doc()
    const binding = await boundTo(doc)
    const titles: Array<[string, string | null]> = []
    const stop = onLiveNoteTitle((path, title) => titles.push([path, title]))
    const { source, onContentChange } = renderSource(binding, noteEditor())

    source.contentChange?.(PATH, '---\ntype: Project\n---\n# Heron Two\n\nOwned by Ada.\n')
    await settle()
    stop()

    expect(onContentChange).not.toHaveBeenCalled()
    expect(new NoteCodec().read(doc)).toContain('# Heron Two')
    expect(titles).toEqual([[PATH, 'Heron Two']])
  })

  it('opens a bound note on the document frontmatter and the editor body', async () => {
    const doc = new Y.Doc()
    const binding = await boundTo(doc)
    const editor = noteEditor()
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: 'Shown by the editor.' }])
    const { source } = renderSource(binding, editor)

    const content = source.entryContent('---\ntype: Stale\n---\nStale body\n', PATH)

    expect(content).toBe('---\ntype: Project\n---\nShown by the editor.\n')
    expect(source.entryContent(null, PATH)).toBeNull()
  })

  it('logs a raw edit the document could not take', async () => {
    const doc = new Y.Doc()
    const binding = await boundTo(doc)
    vi.spyOn(doc, 'transact').mockImplementation(() => {
      throw new Error('closed')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { source } = renderSource(binding, noteEditor())

    source.contentChange?.(PATH, NOTE)
    await settle()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('raw edit'), expect.any(Error))
  })
})
