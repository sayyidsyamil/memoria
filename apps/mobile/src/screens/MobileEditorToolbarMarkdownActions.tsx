import { MobileEditorToolbarMarkdownPrimaryActions } from './MobileEditorToolbarMarkdownPrimaryActions'
import { MobileEditorToolbarMarkdownSecondaryActions } from './MobileEditorToolbarMarkdownSecondaryActions'
import type { EditorToolbarProps } from './TabletEditorPanel.types'

export function MobileEditorToolbarMarkdownActions({
  editingMode,
  ...props
}: EditorToolbarProps) {
  const sourceModeActive = editingMode === 'source'
  return (
    <>
      <MobileEditorToolbarMarkdownPrimaryActions {...props} sourceModeActive={sourceModeActive} />
      <MobileEditorToolbarMarkdownSecondaryActions {...props} />
    </>
  )
}
