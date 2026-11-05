// @vitest-environment jsdom
import { Editor, Node } from '@tiptap/core'
import { expect, it } from 'vitest'
import { MobileDiagramBridge } from './MobileWysiwygDiagramBridge'
import { mobileDiagramFenceHtml } from '../../workspace/mobileDiagramMarkdown'
import { tiptapJsonToMobileMarkdown } from '../../workspace/mobileDocumentContent'

it('keeps source in an atomic editor block even when its preview is unavailable', () => {
  const source = '~~~tldraw id="board" height="520"\n{ "store": {} }\n~~~'
  const editor = new Editor({ extensions: [
    Node.create({ name: 'doc', topNode: true, content: 'block+' }),
    Node.create({ name: 'text', group: 'inline' }),
    Node.create({ name: 'paragraph', group: 'block', content: 'inline*',
      parseHTML: () => [{ tag: 'p' }], renderHTML: () => ['p', 0] }),
    MobileDiagramBridge.tiptapExtension,
  ], content: `${mobileDiagramFenceHtml(source)}<p>Following text</p>` })
  try {
    expect(editor.state.doc.firstChild?.type.name).toBe('mobileDiagram')
    expect(editor.state.doc.firstChild?.isAtom).toBe(true)
    expect(tiptapJsonToMobileMarkdown(editor.getJSON())).toBe(`${source}\n\nFollowing text`)
    expect(editor.getHTML()).toContain(encodeURIComponent(source))
    expect(editor.getHTML()).toContain('<pre>')
  } finally { editor.destroy() }
})

it('keeps the WebView node renderer when native runtime options do not override it', () => {
  const addNodeView = () => () => ({ dom: document.createElement('div') })
  const bridge = MobileDiagramBridge.extendExtension({ addNodeView })
  const [extension] = bridge.configureTiptapExtensionsOnRunTime(undefined, undefined)
  expect(extension.config).toHaveProperty('addNodeView', addNodeView)
})
