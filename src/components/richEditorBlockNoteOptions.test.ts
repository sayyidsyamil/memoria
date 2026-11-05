import { BlockNoteEditor } from '@blocknote/core'
import { afterEach, describe, expect, it } from 'vitest'
import { schema } from './editorSchema'
import {
  RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS,
  RICH_EDITOR_DISABLED_BLOCKNOTE_EXTENSIONS,
} from './richEditorBlockNoteOptions'

type TiptapExtension = {
  name: string
}

describe('rich editor BlockNote performance options', () => {
  it('does not install BlockNote previous-block animation tracking', () => {
    expect(RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS.animations).toBe(false)
    expect(RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS.disableExtensions).toEqual(
      [...RICH_EDITOR_DISABLED_BLOCKNOTE_EXTENSIONS],
    )

    const editor = BlockNoteEditor.create({
      ...RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS,
      schema,
    })

    try {
      const blockNoteExtensions = Array.from(editor.extensions.keys())
      const tiptapExtensions = editor._tiptapEditor.extensionManager.extensions as TiptapExtension[]

      expect(blockNoteExtensions).not.toContain('previousBlockType')
      expect(tiptapExtensions.some((extension) => extension.name === 'previousBlockType')).toBe(false)
    } finally {
      editor._tiptapEditor.destroy()
    }
  })
})

describe('rich editor file URLs (TOL-204)', () => {
  const target = window as { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

  afterEach(() => {
    delete target.MEMORIA_REMOTE_URL
    delete target.MEMORIA_REMOTE_TOKEN
  })

  it('leaves BlockNote without a resolver unless a remote serves the vault', () => {
    expect({ ...RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS }.resolveFileUrl).toBeUndefined()

    target.MEMORIA_REMOTE_URL = 'https://vault.example'
    target.MEMORIA_REMOTE_TOKEN = 'token-for-tests'
    expect({ ...RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS }.resolveFileUrl).toEqual(expect.any(Function))
  })
})
