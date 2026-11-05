import { mobileText } from '../i18n/mobileText'
import { MobileEditorFileIdentity } from '../components/workspace/MobileEditorFileIdentity'
import { MobileChip } from '../ui/MobileChip'
import { MobileToolbar, MobileToolbarSpacer } from '../ui/MobilePanel'
import { MobileEditorToolbarActions } from './MobileEditorToolbarActions'
import type { EditorFileMode, EditorToolbarProps } from './TabletEditorPanel.types'

export function MobileEditorToolbar(props: EditorToolbarProps) {
  const chipLabel = editorToolbarChipLabel(props.fileMode)

  return (
    <MobileToolbar testID="editor-toolbar">
      {props.leading}
      <MobileEditorFileIdentity
        note={props.note}
        rename={props.renameFilename}
        typeDefinitions={props.typeDefinitions}
      >
        {chipLabel ? <MobileChip label={chipLabel} tone="gray" /> : null}
        <MobileToolbarSpacer />
        <MobileEditorToolbarActions {...props} />
        {props.trailing}
      </MobileEditorFileIdentity>
    </MobileToolbar>
  )
}

function editorToolbarChipLabel(fileMode: EditorFileMode): string | null {
  if (fileMode === 'text') return mobileText('filePreview.textFile')
  if (fileMode === 'binary') return mobileText('filePreview.file')
  return null
}
