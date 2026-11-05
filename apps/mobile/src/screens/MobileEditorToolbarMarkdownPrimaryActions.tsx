import { Code, Star } from 'phosphor-react-native'
import { mobileText } from '../i18n/mobileText'
import { MobileIconButton } from '../ui/MobileIconButton'
import { useMobileColors, useMobileMetrics } from '../ui/theme/useMobileTheme'
import type { EditorToolbarProps } from './TabletEditorPanel.types'

export function MobileEditorToolbarMarkdownPrimaryActions({
  note,
  onToggleFavorite,
  onToggleSourceMode,
  sourceModeActive,
}: Pick<EditorToolbarProps, 'note' | 'onToggleFavorite' | 'onToggleSourceMode'> & {
  sourceModeActive: boolean
}) {
  const mobileColors = useMobileColors()
  const toolbarAction = useMobileMetrics().toolbarAction
  return (
    <>
      <MobileIconButton
        accessibilityLabel={mobileText(
          note.favorite ? 'command.note.removeFavorite' : 'command.note.addFavorite',
        )}
        testID="editor-favorite-action"
        onPress={onToggleFavorite}
      >
        <Star
          color={note.favorite ? mobileColors.primary : mobileColors.textMuted}
          size={toolbarAction.iconSize}
          weight={note.favorite ? 'fill' : 'regular'}
        />
      </MobileIconButton>
      <MobileIconButton
        accessibilityLabel={mobileText(
          sourceModeActive ? 'editor.toolbar.rawReturn' : 'editor.toolbar.rawOpen',
        )}
        selected={sourceModeActive}
        testID="editor-source-action"
        onPress={onToggleSourceMode}
      >
        <Code
          color={sourceModeActive ? mobileColors.primary : mobileColors.textMuted}
          size={toolbarAction.iconSize}
        />
      </MobileIconButton>
    </>
  )
}
