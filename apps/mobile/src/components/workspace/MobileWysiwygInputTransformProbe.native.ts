import { useEffect, type MutableRefObject } from 'react'
import type { EditorBridge } from '@10play/tentap-editor'
import {
  nativeWysiwygInputTransformLogLine,
  nativeWysiwygInputTransformProbeSteps,
  nativeWysiwygInputTransformProof,
  type NativeWysiwygInputTransformProbeStep,
} from '../../qa/nativeWysiwygInputTransformProbe'
import { nativeWysiwygDocumentWithInputTransforms } from '../../workspace/mobileWysiwygInputTransforms'
import { nativeWysiwygDocumentWithInsertedPlainText } from './MobileWysiwygWikilinkBridgeModel'

type TimerHandle = ReturnType<typeof setTimeout>
type InputTransformProbeRefs = {
  acceptsEditorChangesRef: MutableRefObject<boolean>
  editorRef: MutableRefObject<EditorBridge | null>
}
type InputTransformEditorBridge = EditorBridge & {
  getJSON: () => Promise<unknown>
  setContent: (content: unknown) => void
  setSelection: (from: number, to: number) => void
}
type InputTransformProbeRun = {
  editor: InputTransformEditorBridge
  step: NativeWysiwygInputTransformProbeStep
}
type MathInlineProofEditorBridge = EditorBridge & {
  getMathInlineRenderProof: () => Promise<boolean>
}

export function useNativeWysiwygInputTransformProbe({
  enabled,
  refs,
}: {
  enabled: boolean
  refs: InputTransformProbeRefs
}) {
  useEffect(() => {
    if (!enabled) return undefined

    const timers = new Set<TimerHandle>()
    const schedule = (callback: () => void, delayMs: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        callback()
      }, delayMs)
      timers.add(timer)
    }
    const runProbe = (stepIndex = 0) => {
      const run = inputTransformProbeRun(refs, stepIndex)
      if (!run) {
        if (!refs.acceptsEditorChangesRef.current) schedule(() => runProbe(stepIndex), 250)
        return
      }

      prepareInputTransformProbe(run)
      schedule(() => {
        void runInputTransformProbeStep(run)
          .then(() => schedule(() => runProbe(stepIndex + 1), 250))
          .catch((error: unknown) => {
            console.warn('[mobile-editor] Failed to run native WYSIWYG input transform probe:', error)
          })
      }, 500)
    }

    schedule(runProbe, 500)
    return () => timers.forEach(clearTimeout)
  }, [enabled, refs])
}

function inputTransformProbeRun(refs: InputTransformProbeRefs, stepIndex: number): InputTransformProbeRun | null {
  if (!refs.acceptsEditorChangesRef.current) return null
  const editor = inputTransformEditorBridge(refs.editorRef.current)
  const step = nativeWysiwygInputTransformProbeSteps()[stepIndex]
  return editor && step ? { editor, step } : null
}

function prepareInputTransformProbe({ editor, step }: InputTransformProbeRun): void {
  editor.setContent(step.content)
  editor.setSelection(step.selection.from, step.selection.to)
}

async function runInputTransformProbeStep({ editor, step }: InputTransformProbeRun): Promise<void> {
  const json = await editor.getJSON()
  const insertedJson = nativeWysiwygDocumentWithInsertedPlainText({
    json,
    payload: { text: step.input },
    selection: step.selection,
  })
  if (!insertedJson) return

  const nextJson = nativeWysiwygDocumentWithInputTransforms({
    json: insertedJson,
    selection: inputTransformSelection(step),
  })
  if (nextJson) editor.setContent(nextJson)
  const mathInlineRendered = nextJson ? await mathInlineRenderProof(editor) : false

  console.info(
    nativeWysiwygInputTransformLogLine(
      nativeWysiwygInputTransformProof({
        json: nextJson ?? insertedJson,
        mathInlineRendered,
        step: step.step,
        transformed: nextJson !== null,
      }),
    ),
  )
}

function inputTransformSelection(step: NativeWysiwygInputTransformProbeStep) {
  return {
    from: step.selection.from + step.input.length,
    to: step.selection.to + step.input.length,
  }
}

async function mathInlineRenderProof(editor: EditorBridge): Promise<boolean> {
  const candidate = editor as Partial<MathInlineProofEditorBridge>
  if (typeof candidate.getMathInlineRenderProof !== 'function') return false
  await new Promise((resolve) => setTimeout(resolve, 60))
  return candidate.getMathInlineRenderProof()
}

function inputTransformEditorBridge(editor: EditorBridge | null): InputTransformEditorBridge | null {
  const candidate = editor as Partial<InputTransformEditorBridge> | null
  if (typeof candidate?.getJSON !== 'function') return null
  if (typeof candidate.setContent !== 'function') return null
  if (typeof candidate.setSelection !== 'function') return null
  return candidate as InputTransformEditorBridge
}
