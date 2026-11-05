// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readMobileSlash, runMobileSlash } from './MobileWysiwygSlashExtension'
import { createTestTentapEditor, undoTestTentapEditor } from './MobileTentapTestHarness'
import { mobileSlashCommands } from './MobileWysiwygSlashCommands'

const disposals: Array<() => void> = []
async function editorWith(content: string) {
  const { editor, dispose } = await createTestTentapEditor(content)
  disposals.push(dispose)
  return editor
}
afterEach(async () => {
  for (const dispose of disposals.splice(0)) dispose()
  // TenTap's 10ms trailing bridge notification must settle before jsdom closes.
  await new Promise(resolve => setTimeout(resolve, 25))
})

describe('native rich editor slash commands', () => {
  it.each(mobileSlashCommands)('executes $action with the production editor schema', async ({ action }) => {
    const editor = await editorWith('<p>/</p>')
    expect(runMobileSlash(editor, action)).toBe(true)
    expect(editor.getText()).not.toContain('/')
  })
  it('filters at the caret without treating URLs as slash commands', async () => {
    expect(readMobileSlash(await editorWith('<p>/heading 2</p>'))?.commands.map((item) => item.action)).toEqual(['heading2'])
    expect(readMobileSlash(await editorWith('<p>https://example.com/heading</p>'))).toBeNull()
  })

  it('replaces only the slash query in one undoable transaction', async () => {
    const editor = await editorWith('<p>Unchanged</p><p>/heading 2</p>')
    expect(runMobileSlash(editor, 'heading2')).toBe(true)
    expect(editor.getHTML()).toBe('<p>Unchanged</p><h2></h2>')
    undoTestTentapEditor(editor)
    expect(editor.getHTML()).toBe('<p>Unchanged</p><p>/heading 2</p>')
  })

  it('ignores a selected range and inline code', async () => {
    const editor = await editorWith('<p>/heading</p>')
    editor.commands.setTextSelection({ from: 1, to: 4 })
    expect(readMobileSlash(editor)).toBeNull()
    expect(readMobileSlash(await editorWith('<p><code>/heading</code></p>'))).toBeNull()
  })

  it('handles keyboard navigation, Enter, and Escape without leaving the editor', async () => {
    const editor = await editorWith('<p>/heading</p>')
    const key = (value: string) => editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, new KeyboardEvent('keydown', { key: value })))
    expect(key('ArrowDown')).toBe(true)
    expect(readMobileSlash(editor)?.index).toBe(1)
    expect(key('Enter')).toBe(true)
    expect(editor.getHTML()).toBe('<h2></h2>')
    editor.commands.setContent('<p>/heading</p>')
    editor.commands.setTextSelection(9)
    expect(key('Escape')).toBe(true)
    expect(readMobileSlash(editor)).toBeNull()
    expect(editor.getText()).toBe('/heading')
    editor.commands.setContent('<p>/heading</p>')
    editor.commands.setTextSelection(9)
    expect(readMobileSlash(editor)?.commands.length).toBeGreaterThan(0)
  })

  it('does not execute stale or unknown menu choices', async () => {
    const editor = await editorWith('<p>/heading 2</p>')
    expect(runMobileSlash(editor, 'table')).toBe(false)
    expect(editor.getText()).toBe('/heading 2')
    editor.commands.insertContent(' missing')
    expect(readMobileSlash(editor)?.commands).toEqual([])
  })
})
