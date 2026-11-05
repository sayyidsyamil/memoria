import type { EditorToolbarProps } from './TabletEditorPanel.types'
import { MobileEditorToolbarFileActions } from './MobileEditorToolbarFileActions'
import { MobileEditorToolbarMarkdownActions } from './MobileEditorToolbarMarkdownActions'

export function MobileEditorToolbarActions(props: EditorToolbarProps) {
  if (props.fileMode !== 'markdown') return <MobileEditorToolbarFileActions {...props} />
  return <MobileEditorToolbarMarkdownActions {...props} />
}
