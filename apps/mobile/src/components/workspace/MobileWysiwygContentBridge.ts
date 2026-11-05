import { Extension, type AnyExtension, type Editor } from '@tiptap/core'
import { applyMobileWysiwygContentMessage } from './MobileWysiwygContentBridgeModel'

const MobileWysiwygContentExtension = Extension.create({ name: 'mobileWysiwygContent' })

type MobileWysiwygContentMessage = {
  payload: { content: string }
  type: 'mobile-set-content-silently'
}
type MobileWysiwygContentBridgeExtension = {
  clone: () => MobileWysiwygContentBridgeExtension
  configureCSS: (css: string) => MobileWysiwygContentBridgeExtension
  configureExtension: (config: unknown) => MobileWysiwygContentBridgeExtension
  configureTiptapExtensionsOnRunTime: () => AnyExtension[]
  extendCSS: string
  extendEditorInstance: (
    sendBridgeMessage: (message: MobileWysiwygContentMessage) => void,
  ) => { setContentSilently: (content: string) => void }
  extendExtension: (config: unknown) => MobileWysiwygContentBridgeExtension
  name: string
  onBridgeMessage: (editor: Editor, message: unknown) => boolean
  tiptapExtension: AnyExtension
}

export const MobileWysiwygContentBridge = mobileWysiwygContentBridge()

function mobileWysiwygContentBridge(): MobileWysiwygContentBridgeExtension {
  return {
    clone: mobileWysiwygContentBridge,
    configureCSS: mobileWysiwygContentBridge,
    configureExtension: mobileWysiwygContentBridge,
    configureTiptapExtensionsOnRunTime: () => [MobileWysiwygContentExtension],
    extendCSS: '',
    extendEditorInstance: (sendBridgeMessage) => ({
      setContentSilently: (content) => sendBridgeMessage({
        payload: { content },
        type: 'mobile-set-content-silently',
      }),
    }),
    extendExtension: mobileWysiwygContentBridge,
    name: MobileWysiwygContentExtension.name,
    onBridgeMessage: (editor, message) => applyMobileWysiwygContentMessage(editor, message),
    tiptapExtension: MobileWysiwygContentExtension,
  }
}
