import type { EditorBridge } from '@10play/tentap-editor'
import {
  nativeWysiwygDocumentWithInsertedPlainText,
  nativeWysiwygDocumentWithInsertedWikilink,
  type NativeWysiwygPlainTextPayload,
  type NativeWysiwygSelection,
  type NativeWysiwygWikilinkPayload,
} from './MobileWysiwygWikilinkBridgeModel'
import { nativeWysiwygDocumentContentFromJson } from './MobileWysiwygDocumentSerialization'
import {
  nativeWysiwygEmojiInsertProbePayload,
  nativeWysiwygEmojiInsertProbeSelection,
  nativeWysiwygPersonMentionInsertProbeContent,
  nativeWysiwygPersonMentionInsertProbePayload,
  nativeWysiwygPersonMentionInsertProbeSelection,
  nativeWysiwygWikilinkInsertProbePayload,
  nativeWysiwygWikilinkInsertProof,
} from '../../qa/nativeWysiwygWikilinkInsertProbe'

type NativeWysiwygProbeEditorBridge = EditorBridge & {
  getJSON: () => Promise<unknown>
  setContent: (content: unknown) => void
}
type NativeWysiwygWikilinkProbeStep =
  | {
    kind: 'plainText'
    payload: NativeWysiwygPlainTextPayload
    selection: NativeWysiwygSelection
  }
  | {
    kind: 'wikilink'
    payload: NativeWysiwygWikilinkPayload
    selection?: NativeWysiwygSelection
  }

const nativeWysiwygWikilinkProbeSteps: NativeWysiwygWikilinkProbeStep[] = [{
  kind: 'plainText',
  payload: nativeWysiwygEmojiInsertProbePayload(),
  selection: nativeWysiwygEmojiInsertProbeSelection(),
}, {
  kind: 'wikilink',
  payload: nativeWysiwygPersonMentionInsertProbePayload(),
  selection: nativeWysiwygPersonMentionInsertProbeSelection(),
}, {
  kind: 'wikilink',
  payload: nativeWysiwygWikilinkInsertProbePayload(),
}]

export async function insertNativeWysiwygWikilinkProbe(editor: EditorBridge | null): Promise<boolean> {
  if (!isProbeEditorBridge(editor)) return false

  const combinedJson = nativeWysiwygWikilinkProbeDocument()
  if (!combinedJson) return false

  editor.setContent(combinedJson)
  await settleNativeWysiwygProbeContent()
  const content = nativeWysiwygDocumentContentFromJson({
    currentContent: '',
    initialBodyHasContent: false,
    isFirstSerialization: false,
    json: await editor.getJSON(),
  }).content

  return nativeWysiwygWikilinkInsertProofPassed(content)
}

function nativeWysiwygWikilinkProbeDocument(): unknown | null {
  return nativeWysiwygWikilinkProbeSteps.reduce<unknown | null>((json, step) => (
    json ? nativeWysiwygWikilinkProbeStepDocument(json, step) : null
  ), nativeWysiwygPersonMentionInsertProbeContent())
}

function nativeWysiwygWikilinkProbeStepDocument(
  json: unknown,
  step: NativeWysiwygWikilinkProbeStep,
): unknown | null {
  if (step.kind === 'plainText') {
    return nativeWysiwygDocumentWithInsertedPlainText({ json, payload: step.payload, selection: step.selection })
  }

  return nativeWysiwygDocumentWithInsertedWikilink({ json, payload: step.payload, selection: step.selection })
}

function nativeWysiwygWikilinkInsertProofPassed(content: string): boolean {
  const proof = nativeWysiwygWikilinkInsertProof({ content, noteId: 'probe' })
  return proof.insertedWikilinkSaved
    && proof.insertedPersonMentionSaved
    && proof.insertedPersonMentionSourceRemoved
    && proof.insertedEmojiSaved
    && proof.insertedEmojiSourceRemoved
}

function isProbeEditorBridge(editor: EditorBridge | null): editor is NativeWysiwygProbeEditorBridge {
  if (!editor) return false

  const candidate = editor as unknown as Record<string, unknown>
  return typeof candidate.getJSON === 'function' && typeof candidate.setContent === 'function'
}

function settleNativeWysiwygProbeContent(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 60)
  })
}
