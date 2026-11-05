import { useCallback, useState } from 'react'
import { mobileDocumentBody } from '../../workspace/mobileDocumentContent'
import type { MobileWysiwygMarkdownEditorProps, NativeTentapEditorSurfaceProps, NativeWysiwygExternalLinkSheetState, NativeWysiwygPickerState } from './MobileNativeEditor.types'
import { nativeWysiwygInitialExternalLinkValue } from './MobileWysiwygExternalLinkSheetModel'
import type { NativeWysiwygInlineAutocomplete } from './MobileWysiwygWikilinkBridgeModel'
import { nativeWysiwygEditorSelection, nativeWysiwygEditorState } from './mobileNativeEditorOperations'
import { initialNativeEditorContent, useNativeTentapEditorBridge } from './useMobileNativeEditorRuntime'
import type { NativeEditorRecoveryHandlers } from './useNativeEditorRecovery'

type Options = MobileWysiwygMarkdownEditorProps & NativeEditorRecoveryHandlers
type Surface = NativeTentapEditorSurfaceProps & NativeEditorRecoveryHandlers

export function useNativeEditorSurfaceSession(props: Options): Surface {
  const picker = useNativeWikilinkPickerState()
  const bridge = useNativeTentapEditorBridge({
    ...props, initialDocumentContent: initialNativeEditorContent(props),
    onInitialContentSyncFailure: () => props.onProcessLoss('initialContentSyncFailed'),
    onInlineAutocomplete: picker.onInlineAutocomplete,
  })
  const externalLink = useNativeExternalLinkState(bridge.editor)
  return {
    ...props, ...bridge, ...picker, ...externalLink,
    previewMarkdown: mobileDocumentBody(initialNativeEditorContent(props)),
    sourceNote: props.note,
    onProcessLoss: reason => { bridge.retireEditor(); props.onProcessLoss(reason) },
  }
}

function useNativeWikilinkPickerState() {
  const [pickerState, setPickerState] = useState<NativeWysiwygPickerState | null>(null)
  const onInlineAutocomplete = useCallback((match: NativeWysiwygInlineAutocomplete | null) => {
    setPickerState(current => inlineAutocompletePickerState(current, match))
  }, [])
  const onOpenToolbarWikilinkPicker = useCallback(() => {
    setPickerState({ kind: 'wikilink', query: '', source: 'toolbar' })
  }, [])
  const onCloseWikilinkPicker = useCallback(() => { setPickerState(null) }, [])
  return { pickerState, onInlineAutocomplete, onOpenToolbarWikilinkPicker, onCloseWikilinkPicker }
}

function useNativeExternalLinkState(editor: NativeTentapEditorSurfaceProps['editor']) {
  const [externalLinkState, setExternalLinkState] = useState<NativeWysiwygExternalLinkSheetState | null>(null)
  const onOpenExternalLinkSheet = useCallback(() => {
    setExternalLinkState({
      initialUrl: nativeWysiwygInitialExternalLinkValue(nativeWysiwygEditorState(editor)),
      selection: nativeWysiwygEditorSelection(editor),
    })
  }, [editor])
  const onCloseExternalLinkSheet = useCallback(() => { setExternalLinkState(null) }, [])
  return { externalLinkState, onOpenExternalLinkSheet, onCloseExternalLinkSheet }
}

function inlineAutocompletePickerState(
  current: NativeWysiwygPickerState | null,
  match: NativeWysiwygInlineAutocomplete | null,
): NativeWysiwygPickerState | null {
  if (current?.source === 'toolbar') return current
  if (!match) return current?.source === 'inline' ? null : current
  return { kind: match.kind, query: match.query, replacementRange: match.range, source: 'inline' }
}
