import { useEffect, useRef, type MutableRefObject } from 'react'
import type { EditorBridge } from '@10play/tentap-editor'
import {
  nativeWysiwygTableCommandMutationLogLine,
  nativeWysiwygTableCommandMutationProbeJson,
  nativeWysiwygTableCommandMutationProof,
} from '../../qa/nativeWysiwygTableCommandMutationProbe'
import type { NativeWysiwygCommandBridge } from './MobileWysiwygFormatCommands'

type TimerHandle = ReturnType<typeof setTimeout>

type ContentSettableEditorBridge = EditorBridge & {
  setContent: (content: unknown) => void
}

export type NativeWysiwygTableCommandMutationProbeRefs = {
  acceptsEditorChangesRef: MutableRefObject<boolean>
  editorRef: MutableRefObject<EditorBridge | null>
  hasAcceptedEditorChangeRef: MutableRefObject<boolean>
  tableCommandMutationProofReadyRef: MutableRefObject<boolean>
}

export function useNativeWysiwygTableCommandMutationProbe({
  enabled,
  flushEditorDocument,
  refs,
}: {
  enabled: boolean
  flushEditorDocument: () => void
  refs: NativeWysiwygTableCommandMutationProbeRefs
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

    const timers = tableCommandMutationProbeTimers()
    timers.probe = setTimeout(() => {
      runTableCommandMutationProbe({
        flushEditorDocumentRef,
        refs,
        timers,
        onStarted: () => {
          hasRunProbeRef.current = true
        },
      })
    }, 500)

    return () => clearTableCommandMutationProbeTimers(timers)
  }, [enabled, refs])
}

export function publishNativeWysiwygTableCommandMutationProof({
  content,
  json,
  noteId,
}: {
  content: string
  json: unknown
  noteId: string
}): void {
  console.info(nativeWysiwygTableCommandMutationLogLine(
    nativeWysiwygTableCommandMutationProof({ content, json, noteId }),
  ))
}

function runTableCommandMutationProbe({
  flushEditorDocumentRef,
  onStarted,
  refs,
  timers,
}: {
  flushEditorDocumentRef: MutableRefObject<() => void>
  onStarted: () => void
  refs: NativeWysiwygTableCommandMutationProbeRefs
  timers: TableCommandMutationProbeTimers
}) {
  if (!refs.acceptsEditorChangesRef.current) {
    timers.probe = setTimeout(() => runTableCommandMutationProbe({
      flushEditorDocumentRef,
      onStarted,
      refs,
      timers,
    }), 250)
    return
  }

  const editor = refs.editorRef.current
  if (!isContentSettableEditorBridge(editor)) return

  onStarted()
  refs.hasAcceptedEditorChangeRef.current = true
  editor.setContent(nativeWysiwygTableCommandMutationProbeJson())
  timers.command = setTimeout(() => {
    const tableCommandEditor = editor as NativeWysiwygCommandBridge
    tableCommandEditor.addRowAndColumnAfterFirstBodyCell?.()
    refs.tableCommandMutationProofReadyRef.current = true
    timers.flush = setTimeout(() => flushEditorDocumentRef.current(), 750)
  }, 500)
}

type TableCommandMutationProbeTimers = {
  command: TimerHandle | null
  flush: TimerHandle | null
  probe: TimerHandle | null
}

function tableCommandMutationProbeTimers(): TableCommandMutationProbeTimers {
  return {
    command: null,
    flush: null,
    probe: null,
  }
}

function clearTableCommandMutationProbeTimers(timers: TableCommandMutationProbeTimers) {
  clearTimer(timers.command)
  clearTimer(timers.flush)
  clearTimer(timers.probe)
}

function clearTimer(timer: TimerHandle | null) {
  if (timer) clearTimeout(timer)
}

function isContentSettableEditorBridge(editor: EditorBridge | null): editor is ContentSettableEditorBridge {
  return typeof (editor as Partial<ContentSettableEditorBridge> | null)?.setContent === 'function'
}
