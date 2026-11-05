import { useEffect, type MutableRefObject } from 'react'
import type { EditorBridge } from '@10play/tentap-editor'
import { nativeTableOfContentsScrollProof, type NativeTableOfContentsProof } from '../../qa/nativeTableOfContentsProbe'
import type { MobileTableOfContentsTarget } from '../../workspace/mobileTableOfContents'
import type { MobileWysiwygOutlineEditorBridge, MobileWysiwygOutlineScrollResult } from './MobileWysiwygOutlineBridge'

type OutlineNavigationRefs = {
  acceptsEditorChangesRef: MutableRefObject<boolean>
  editorRef: MutableRefObject<EditorBridge | null>
}

const outlineNavigationRetryDelayMs = 250
const outlineNavigationMaxAttempts = 20

export function useMobileWysiwygOutlineNavigation({
  documentTitle,
  onProof,
  refs,
  target,
}: {
  documentTitle: string
  onProof?: (proof: NativeTableOfContentsProof) => void
  refs: OutlineNavigationRefs
  target?: MobileTableOfContentsTarget | null
}) {
  useEffect(() => {
    if (!target) return undefined

    let attempt = 0
    let disposed = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const publishFailure = () =>
      onProof?.(
        outlineScrollProof({
          afterY: 0,
          beforeY: 0,
          expectedY: 0,
          found: false,
          targetId: target.id,
        }),
      )
    const scheduleRetry = () => {
      if (disposed) return
      if (attempt >= outlineNavigationMaxAttempts) {
        publishFailure()
        return
      }
      retryTimer = setTimeout(run, outlineNavigationRetryDelayMs)
    }
    const handleResult = (result: MobileWysiwygOutlineScrollResult) => {
      if (disposed) return
      if (result.found) {
        onProof?.(outlineScrollProof(result))
        return
      }
      if (attempt >= outlineNavigationMaxAttempts) {
        onProof?.(outlineScrollProof(result))
        return
      }
      scheduleRetry()
    }
    const run = () => {
      attempt += 1
      const editor = outlineEditorBridge(refs.editorRef.current)
      if (!refs.acceptsEditorChangesRef.current || !editor) {
        scheduleRetry()
        return
      }

      void editor.scrollToMobileOutlineTarget(target, documentTitle).then(handleResult).catch(scheduleRetry)
    }

    run()
    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [documentTitle, onProof, refs, target])
}

function outlineEditorBridge(editor: EditorBridge | null): (EditorBridge & MobileWysiwygOutlineEditorBridge) | null {
  const candidate = editor as (EditorBridge & Partial<MobileWysiwygOutlineEditorBridge>) | null
  return typeof candidate?.scrollToMobileOutlineTarget === 'function'
    ? (candidate as EditorBridge & MobileWysiwygOutlineEditorBridge)
    : null
}

function outlineScrollProof(result: MobileWysiwygOutlineScrollResult): NativeTableOfContentsProof {
  return nativeTableOfContentsScrollProof(result)
}
