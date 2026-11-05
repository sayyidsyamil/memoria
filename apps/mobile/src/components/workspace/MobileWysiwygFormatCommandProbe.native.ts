import { useEffect, useRef, type MutableRefObject } from 'react'
import type { EditorBridge } from '@10play/tentap-editor'
import {
  nativeWysiwygFormatCommandEffectContent,
  nativeWysiwygFormatCommandEffectMarkdown,
  nativeWysiwygFormatCommandEffectProbeActions,
  nativeWysiwygFormatCommandEffectSelection,
  nativeWysiwygFormatCommandLogLine,
  nativeWysiwygFormatCommandProbeActions,
  nativeWysiwygFormatCommandProof,
} from '../../qa/nativeWysiwygFormatCommandProbe'
import {
  applyNativeWysiwygFormat,
  type NativeWysiwygCommandBridge,
} from './MobileWysiwygFormatCommands'

type TimerHandle = ReturnType<typeof setTimeout>

export type NativeWysiwygFormatCommandProbeRefs = {
  acceptsEditorChangesRef: MutableRefObject<boolean>
  editorRef: MutableRefObject<EditorBridge | null>
}
type JsonReadableEditorBridge = EditorBridge & {
  getJSON: () => Promise<unknown>
}
type ContentSettableEditorBridge = EditorBridge & {
  setContent: (content: unknown) => void
}
type SelectionSettableEditorBridge = EditorBridge & {
  setSelection: (from: number, to: number) => void
}

export function useNativeWysiwygFormatCommandProbe({
  enabled,
  refs,
}: {
  enabled: boolean
  refs: NativeWysiwygFormatCommandProbeRefs
}) {
  const hasRunProbeRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      hasRunProbeRef.current = false
      return undefined
    }
    if (hasRunProbeRef.current) return undefined

    let probeTimer: TimerHandle | null = null
    const runProbe = () => {
      if (!refs.acceptsEditorChangesRef.current) {
        probeTimer = setTimeout(runProbe, 250)
        return
      }

      const editor = refs.editorRef.current
      hasRunProbeRef.current = true
      for (const action of nativeWysiwygFormatCommandProbeActions) {
        if (editor) applyNativeWysiwygFormat(editor as NativeWysiwygCommandBridge, action)
        console.info(nativeWysiwygFormatCommandLogLine(nativeWysiwygFormatCommandProof({ action, editor })))
      }
      void runNativeWysiwygFormatEffectProbe(editor)
    }

    probeTimer = setTimeout(runProbe, 500)

    return () => {
      if (probeTimer) clearTimeout(probeTimer)
    }
  }, [enabled, refs])
}

async function runNativeWysiwygFormatEffectProbe(editor: EditorBridge | null): Promise<void> {
  if (!isFormatEffectProbeEditor(editor)) return

  for (const action of nativeWysiwygFormatCommandEffectProbeActions) {
    editor.setContent(nativeWysiwygFormatCommandEffectContent())
    await delay(100)
    const selection = nativeWysiwygFormatCommandEffectSelection()
    editor.setSelection(selection.from, selection.to)
    await delay(100)
    applyNativeWysiwygFormat(editor as NativeWysiwygCommandBridge, action)
    await delay(220)
    const json = await editor.getJSON()
    console.info(nativeWysiwygFormatCommandLogLine(nativeWysiwygFormatCommandProof({
      action,
      editor,
      effectMarkdown: nativeWysiwygFormatCommandEffectMarkdown(json),
    })))
  }
}

function isFormatEffectProbeEditor(
  editor: EditorBridge | null,
): editor is ContentSettableEditorBridge & JsonReadableEditorBridge & SelectionSettableEditorBridge {
  const candidate = editor as Partial<ContentSettableEditorBridge & JsonReadableEditorBridge & SelectionSettableEditorBridge> | null
  return typeof candidate?.getJSON === 'function'
    && typeof candidate.setContent === 'function'
    && typeof candidate.setSelection === 'function'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
