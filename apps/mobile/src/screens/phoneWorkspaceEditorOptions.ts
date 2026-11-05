import type { EditorEditingMode } from './TabletEditorPanel'

export type PhoneWorkspaceEditorOptions = {
  initialEditorEditing: boolean
  initialEditorEditingMode: EditorEditingMode
  layoutProbe: boolean
  sourceIdleSave: boolean
  sourceSelectionProbe: boolean
  wysiwygAutocompleteProbe: boolean
  wysiwygExternalLinkProbe: boolean
  wysiwygFormatCommandProbe: boolean
  wysiwygInputTransformProbe: boolean
  wysiwygMarkdownBlockProbe: boolean
  wysiwygMathEditProbe: boolean
  wysiwygTableCommandMutationProbe: boolean
  wysiwygWikilinkInsertProbe: boolean
  wysiwygMutationProbe: boolean
}

export function phoneWorkspaceEditorOptions(props: Partial<PhoneWorkspaceEditorOptions>): PhoneWorkspaceEditorOptions {
  return {
    initialEditorEditing: props.initialEditorEditing ?? true,
    initialEditorEditingMode: props.initialEditorEditingMode ?? 'wysiwyg',
    layoutProbe: Boolean(props.layoutProbe),
    sourceIdleSave: props.sourceIdleSave ?? true,
    sourceSelectionProbe: Boolean(props.sourceSelectionProbe),
    wysiwygAutocompleteProbe: Boolean(props.wysiwygAutocompleteProbe),
    wysiwygExternalLinkProbe: Boolean(props.wysiwygExternalLinkProbe),
    wysiwygFormatCommandProbe: Boolean(props.wysiwygFormatCommandProbe),
    wysiwygInputTransformProbe: Boolean(props.wysiwygInputTransformProbe),
    wysiwygMarkdownBlockProbe: Boolean(props.wysiwygMarkdownBlockProbe),
    wysiwygMathEditProbe: Boolean(props.wysiwygMathEditProbe),
    wysiwygMutationProbe: Boolean(props.wysiwygMutationProbe),
    wysiwygTableCommandMutationProbe: Boolean(props.wysiwygTableCommandMutationProbe),
    wysiwygWikilinkInsertProbe: Boolean(props.wysiwygWikilinkInsertProbe),
  }
}
