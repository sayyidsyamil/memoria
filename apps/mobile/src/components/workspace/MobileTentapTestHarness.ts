import { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useTenTap } from '@10play/tentap-editor/web'
import { mobileWikilinkStartKit } from './MobileWysiwygLinkBridge.web'
import { MobileSlashExtension, readMobileSlash, runMobileSlash } from './MobileWysiwygSlashExtension'
import { createMobileSlashBridge } from './MobileWysiwygSlashBridge'
import { createMobileFindBridge } from './MobileWysiwygFindBridge'
import { MobileFindExtension, readMobileFind, applyMobileFindRequest } from './MobileWysiwygFindExtension'
import { MobileMathInlineBridge } from './MobileWysiwygMathBridge'
import { MobileTableBridge } from './MobileWysiwygTableBridge'
import { MobileCodeBlockBridge } from './MobileWysiwygCodeBlockBridge'

const bridges = [...mobileWikilinkStartKit(), MobileMathInlineBridge, MobileTableBridge, MobileCodeBlockBridge, createMobileSlashBridge({
  extension: MobileSlashExtension, read: readMobileSlash, run: runMobileSlash,
}), createMobileFindBridge({ extension: MobileFindExtension, read: readMobileFind, run: applyMobileFindRequest })]

export function undoTestTentapEditor(editor: Editor) {
  return editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })))
}

export async function createTestTentapEditor(content: string) {
  window.initialContent = content
  window.editable = 'true'
  window.disableColorHighlight = true
  window.bridgeExtensionConfigMap = JSON.stringify(Object.fromEntries(bridges.map((bridge) => [bridge.name, {}])))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const editor = await new Promise<Editor>((resolve) => {
    function Harness() {
      const editor = useTenTap({ bridges })
      useEffect(() => { if (editor) resolve(editor) }, [editor])
      return createElement(EditorContent, { editor })
    }
    root.render(createElement(Harness))
  })
  editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  return { editor, dispose: () => { root.unmount(); host.remove() } }
}
