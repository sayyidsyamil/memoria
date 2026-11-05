import type { EditorBridge } from '@10play/tentap-editor'
import { useEffect, useRef } from 'react'
import type { NativeTentapEditorRefs } from './MobileWysiwygEditorLifecycle.native'
import { useNativeWysiwygExternalLinkProbe } from './MobileWysiwygExternalLinkProbe.native'
import { useNativeWysiwygFormatCommandProbe } from './MobileWysiwygFormatCommandProbe.native'
import { useNativeWysiwygInputTransformProbe } from './MobileWysiwygInputTransformProbe.native'
import { useNativeWysiwygMathEditProbe } from './MobileWysiwygMathEditProbe.native'
import { useNativeWysiwygMutationProbe } from './MobileWysiwygMutationProbe.native'
import { useNativeWysiwygTableCommandMutationProbe } from './MobileWysiwygTableCommandMutationProbe.native'
import { insertNativeWysiwygWikilinkProbe } from './MobileWysiwygWikilinkInsertProbe.native'
import type { NativeTentapEditorBridgeOptions, NativeTentapEditorRuntime, TimerHandle, MathBlockRenderableEditorBridge } from './MobileNativeEditor.types'
import { insertNativeWysiwygMarkdownBlockProbe, settleNativeWysiwygEditorContent } from './mobileNativeEditorOperations'

export function useNativeWysiwygTextProbes(options: NativeTentapEditorBridgeOptions, { refs, flushEditorDocument }: NativeTentapEditorRuntime) {
  useNativeWysiwygExternalLinkProbe({
    enabled: options.wysiwygExternalLinkProbe === true,
    flushEditorDocument,
    refs,
  })
  useNativeWysiwygInputTransformProbe({
    enabled: options.wysiwygInputTransformProbe === true,
    refs,
  })
  useNativeWysiwygFormatCommandProbe({
    enabled: options.wysiwygFormatCommandProbe === true,
    refs,
  })
  useNativeWysiwygMathEditProbe({
    enabled: options.wysiwygMathEditProbe === true,
    refs,
    vaultRootUri: options.vaultRootUri,
  })
}

export function useNativeWysiwygBlockProbes(options: NativeTentapEditorBridgeOptions, { refs, flushEditorDocument }: NativeTentapEditorRuntime) {
  useNativeWysiwygDeferredInsertionProbe({
    enabled: options.wysiwygMarkdownBlockProbe === true,
    flushEditorDocument,
    insertIntoEditor: (candidateEditor) => insertNativeWysiwygMarkdownBlockProbe(candidateEditor, refs),
    refs,
    warning: '[mobile-editor] Failed to run native WYSIWYG markdown block probe:',
  })
  useNativeWysiwygDeferredInsertionProbe({
    enabled: options.wysiwygWikilinkInsertProbe === true,
    flushEditorDocument,
    insertIntoEditor: insertNativeWysiwygWikilinkProbe,
    refs,
    warning: '[mobile-editor] Failed to run native WYSIWYG wikilink insert probe:',
  })
  useNativeWysiwygTableCommandMutationProbe({
    enabled: options.wysiwygTableCommandMutationProbe === true,
    flushEditorDocument,
    refs,
  })
  useNativeWysiwygMutationProbe({
    enabled: options.wysiwygMutationProbe === true,
    flushEditorDocument,
    refs,
    vaultRootUri: options.vaultRootUri,
  })
}

export async function nativeWysiwygBlockMathRenderProof(editor: EditorBridge): Promise<boolean> {
  if (!isMathBlockRenderableEditorBridge(editor)) return false
  await settleNativeWysiwygEditorContent()
  return editor.getMathBlockRenderProof()
}

function useNativeWysiwygDeferredInsertionProbe({
  enabled,
  flushEditorDocument,
  insertIntoEditor,
  refs,
  warning,
}: {
  enabled: boolean
  flushEditorDocument: () => void
  insertIntoEditor: (editor: EditorBridge | null) => Promise<boolean>
  refs: NativeTentapEditorRefs
  warning: string
}) {
  const hasInsertedRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      hasInsertedRef.current = false
      return undefined
    }
    if (hasInsertedRef.current) return undefined

    let insertTimer: TimerHandle | null = null
    let disposed = false
    const scheduleRetry = () => {
      if (disposed) return
      insertTimer = setTimeout(insertWhenReady, 250)
    }
    const insertWhenReady = () => {
      if (!refs.acceptsEditorChangesRef.current) {
        scheduleRetry()
        return
      }

      const editor = refs.editorRef.current
      hasInsertedRef.current = true
      void insertIntoEditor(editor)
        .then((inserted) => {
          if (!inserted) {
            hasInsertedRef.current = false
            scheduleRetry()
            return
          }

          refs.hasAcceptedEditorChangeRef.current = true
          if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current)
          flushEditorDocument()
          refs.saveTimerRef.current = setTimeout(flushEditorDocument, 250)
        })
        .catch((error: unknown) => {
          hasInsertedRef.current = false
          console.warn(warning, error)
          scheduleRetry()
        })
    }

    scheduleRetry()

    return () => {
      disposed = true
      if (insertTimer) clearTimeout(insertTimer)
      if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current)
    }
  }, [enabled, flushEditorDocument, insertIntoEditor, refs, warning])
}

function isMathBlockRenderableEditorBridge(editor: EditorBridge | null): editor is MathBlockRenderableEditorBridge {
  return typeof (editor as Partial<MathBlockRenderableEditorBridge> | null)?.getMathBlockRenderProof === 'function'
}
