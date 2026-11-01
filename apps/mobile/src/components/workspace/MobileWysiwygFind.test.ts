// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createTestTentapEditor, undoTestTentapEditor } from './MobileTentapTestHarness'
import { applyMobileFindRequest, readMobileFind } from './MobileWysiwygFindExtension'

const disposals: Array<() => void> = []
async function editorWith(content: string) {
  const result = await createTestTentapEditor(content)
  disposals.push(result.dispose)
  return result.editor
}
afterEach(async () => {
  for (const dispose of disposals.splice(0)) dispose()
  // TenTap's 10ms trailing bridge notification must settle before jsdom closes.
  await new Promise(resolve => setTimeout(resolve, 25))
})
const options = { caseSensitive: false, regex: false }

describe('inline rich editor find', () => {
  it('highlights rendered text across marks and navigates actual matches', async () => {
    const editor = await editorWith('<p>First <strong>match</strong></p><p>First match</p>')
    const selection = editor.state.selection.from
    applyMobileFindRequest(editor, { kind: 'query', query: 'First match', options })
    expect(readMobileFind(editor).matchCount).toBe(2)
    expect(editor.view.dom.querySelectorAll('.memoria-find-match').length).toBeGreaterThanOrEqual(2)
    applyMobileFindRequest(editor, { kind: 'move', direction: 1 })
    expect(readMobileFind(editor).activeIndex).toBe(1)
    expect(editor.view.dom.querySelector('[data-memoria-find-active]')?.parentElement?.textContent).toBe('First match')
    expect(editor.state.selection.from).toBe(selection)
    applyMobileFindRequest(editor, { kind: 'close' })
    expect(editor.view.dom.querySelectorAll('.memoria-find-match')).toHaveLength(0)
  })

  it('replaces in transactions, preserves surrounding formatting, and supports Undo', async () => {
    const editor = await editorWith('<p><em>Keep</em> word word</p>')
    applyMobileFindRequest(editor, { kind: 'query', query: 'word', options })
    applyMobileFindRequest(editor, { kind: 'replace', replacement: 'changed', all: true })
    expect(editor.getHTML()).toBe('<p><em>Keep</em> changed changed</p>')
    expect(readMobileFind(editor).matchCount).toBe(0)
    undoTestTentapEditor(editor)
    expect(editor.getHTML()).toBe('<p><em>Keep</em> word word</p>')
    expect(readMobileFind(editor).matchCount).toBe(2)
  })

  it('rejects unsafe regex and respects case and regex replacement captures', async () => {
    const editor = await editorWith('<p>Word word 123</p>')
    applyMobileFindRequest(editor, { kind: 'query', query: 'Word', options: { ...options, caseSensitive: true } })
    expect(readMobileFind(editor).matchCount).toBe(1)
    applyMobileFindRequest(editor, { kind: 'query', query: '(a+)+$', options: { ...options, regex: true } })
    expect(readMobileFind(editor).error).toBeTruthy()
    applyMobileFindRequest(editor, { kind: 'query', query: '(\\d+)', options: { ...options, regex: true } })
    applyMobileFindRequest(editor, { kind: 'replace', replacement: '[$1]', all: false })
    expect(editor.getText()).toBe('Word word [123]')
  })
})
