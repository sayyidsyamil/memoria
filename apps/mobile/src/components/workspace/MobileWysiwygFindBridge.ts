import { Extension, type AnyExtension, type Editor } from '@tiptap/core'
import type { MobileEditorFindOptions } from '../../workspace/mobileEditorFind'

export type MobileFindRequest =
  | { kind: 'query'; query: string; options: MobileEditorFindOptions }
  | { kind: 'move'; direction: 1 | -1 }
  | { kind: 'replace'; replacement: string; all: boolean }
  | { kind: 'close' }
export type MobileFindSnapshot = { activeIndex: number; matchCount: number; error: string | null }
export type MobileFindEditorBridge = { updateMobileFind: (request: MobileFindRequest) => void }
type FindRuntime = {
  extension: AnyExtension
  read: (editor: Editor) => MobileFindSnapshot
  run: (editor: Editor, request: MobileFindRequest) => void
}
const nativeRuntime: FindRuntime = {
  extension: Extension.create({ name: 'mobileFind' }),
  read: () => ({ activeIndex: 0, matchCount: 0, error: null }),
  run: () => {},
}

export function createMobileFindBridge(runtime = nativeRuntime) {
  return {
    name: 'mobileFind',
    tiptapExtension: runtime.extension,
    clone: () => createMobileFindBridge(runtime),
    configureCSS: () => createMobileFindBridge(runtime),
    configureExtension: () => createMobileFindBridge(runtime),
    extendExtension: () => createMobileFindBridge(runtime),
    configureTiptapExtensionsOnRunTime: () => [runtime.extension],
    extendCSS: '.memoria-find-match{background:rgba(245,184,44,.3);color:inherit}'
      + '[data-memoria-find-active]{background:rgba(245,184,44,.6);outline:2px solid #305dff}',
    extendEditorState: (editor: Editor) => ({ mobileFind: runtime.read(editor) }),
    extendEditorInstance: (send: (message: { type: 'mobile-find'; payload: MobileFindRequest }) => void): MobileFindEditorBridge => ({
      updateMobileFind: (request) => send({ type: 'mobile-find', payload: request }),
    }),
    onBridgeMessage: (editor: Editor, message: { type: string; payload: MobileFindRequest }) => {
      if (message.type !== 'mobile-find') return false
      runtime.run(editor, message.payload)
      return true
    },
  }
}
export const MobileWysiwygFindBridge = createMobileFindBridge()
