import { useEffect, useRef, type MutableRefObject } from 'react'
import type { EditorBridge } from '@10play/tentap-editor'
import {
  nativeWysiwygExternalLinkProbeContent,
  nativeWysiwygExternalLinkProbeNormalizedUrl,
  nativeWysiwygExternalLinkProbeSelection,
} from '../../qa/nativeWysiwygExternalLinkProbe'
import { nativeWysiwygDocumentWithoutExternalLink } from './MobileWysiwygExternalLinkBridgeModel'
import type { NativeWysiwygCommandBridge } from './MobileWysiwygFormatCommands'

type TimerHandle = ReturnType<typeof setTimeout>

type ExternalLinkProbeEditorBridge = EditorBridge & {
  getJSON: () => Promise<unknown>
  setContent: (content: unknown) => void
  setSelection: (from: number, to: number) => void
}

export type NativeWysiwygExternalLinkProbeRefs = {
  acceptsEditorChangesRef: MutableRefObject<boolean>
  editorRef: MutableRefObject<EditorBridge | null>
  hasAcceptedEditorChangeRef: MutableRefObject<boolean>
  saveTimerRef: MutableRefObject<TimerHandle | null>
}

export function useNativeWysiwygExternalLinkProbe({
  enabled,
  flushEditorDocument,
  refs,
}: {
  enabled: boolean
  flushEditorDocument: () => void
  refs: NativeWysiwygExternalLinkProbeRefs
}) {
  const hasRunProbeRef = useRef(false)
  const flushEditorDocumentRef = useRef(flushEditorDocument)

  useEffect(() => {
    flushEditorDocumentRef.current = flushEditorDocument
  }, [flushEditorDocument])

  useEffect(() => {
    if (!enabled) {
      hasRunProbeRef.current = false
      return undefined
    }
    if (hasRunProbeRef.current) return undefined

    let probeTimer: TimerHandle | null = null
    let removeTimer: TimerHandle | null = null
    const runProbe = () => {
      if (!refs.acceptsEditorChangesRef.current) {
        probeTimer = setTimeout(runProbe, 250)
        return
      }

      const editor = refs.editorRef.current
      if (!isExternalLinkProbeEditorBridge(editor) || !isLinkCommandBridge(editor)) {
        probeTimer = setTimeout(runProbe, 250)
        return
      }

      hasRunProbeRef.current = true
      const flushCurrentEditorDocument = () => flushEditorDocumentRef.current()
      applyExternalLinkProbeStage(editor, nativeWysiwygExternalLinkProbeNormalizedUrl(), refs, flushCurrentEditorDocument)
      removeTimer = setTimeout(() => {
        void removeExternalLinkProbeStage(editor, refs, flushCurrentEditorDocument)
      }, 700)
    }

    probeTimer = setTimeout(runProbe, 500)

    return () => {
      if (probeTimer) clearTimeout(probeTimer)
      if (removeTimer) clearTimeout(removeTimer)
    }
  }, [enabled, refs])
}

function applyExternalLinkProbeStage(
  editor: ExternalLinkProbeEditorBridge & NativeWysiwygCommandBridge,
  link: string,
  refs: NativeWysiwygExternalLinkProbeRefs,
  flushEditorDocument: () => void,
): void {
  const selection = nativeWysiwygExternalLinkProbeSelection()
  editor.setContent(nativeWysiwygExternalLinkProbeContent())
  editor.setSelection(selection.from, selection.to)
  editor.setLink?.(link)
  refs.hasAcceptedEditorChangeRef.current = true
  if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current)
  flushEditorDocument()
  refs.saveTimerRef.current = setTimeout(flushEditorDocument, 250)
}

async function removeExternalLinkProbeStage(
  editor: ExternalLinkProbeEditorBridge,
  refs: NativeWysiwygExternalLinkProbeRefs,
  flushEditorDocument: () => void,
): Promise<void> {
  const selection = nativeWysiwygExternalLinkProbeSelection()
  editor.setSelection(selection.from, selection.to)
  const json = await editor.getJSON()
  const nextJson = nativeWysiwygDocumentWithoutExternalLink({
    json,
    selection,
  })
  if (!nextJson) return

  editor.setContent(nextJson)
  refs.hasAcceptedEditorChangeRef.current = true
  if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current)
  flushEditorDocument()
  refs.saveTimerRef.current = setTimeout(flushEditorDocument, 250)
}

function isExternalLinkProbeEditorBridge(editor: EditorBridge | null): editor is ExternalLinkProbeEditorBridge {
  if (!editor) return false

  const candidate = editor as unknown as Record<string, unknown>
  return typeof candidate.getJSON === 'function'
    && typeof candidate.setContent === 'function'
    && typeof candidate.setSelection === 'function'
}

function isLinkCommandBridge(editor: EditorBridge | null): editor is EditorBridge & NativeWysiwygCommandBridge {
  return typeof (editor as NativeWysiwygCommandBridge | null)?.setLink === 'function'
}
