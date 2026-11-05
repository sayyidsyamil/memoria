import type { MobileMetrics } from '../ui/mobileMetrics'
import { StyleSheet } from 'react-native'


import type { MobileColors } from '../ui/theme/mobilePalette'

export function createEditorPanelStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { editor: desktopEditorParity, space: mobileSpace, type: mobileType } = metrics
  const panelStyles = StyleSheet.create({
    content: {
      alignSelf: 'center',
      maxWidth: desktopEditorParity.contentMaxWidth,
      paddingHorizontal: desktopEditorParity.contentPaddingHorizontal,
      paddingVertical: desktopEditorParity.contentPaddingVertical,
      width: '100%',
    },
    contentCompact: {
      paddingHorizontal: mobileSpace.xl,
    },
    contentWide: {
      alignSelf: 'stretch',
      maxWidth: '100%',
      paddingHorizontal: metrics.size(56),
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: mobileSpace.xxl,
    },
    emptyTitle: {
      color: mobileColors.textMuted,
      fontSize: mobileType.title,
      fontWeight: '600',
      textAlign: 'center',
    },
    editorHost: {
      flex: 1,
    },
    ...createEditorFilePreviewStyles(mobileColors, metrics),
    panel: {
      flex: 1,
    },
  })
  return { panelStyles }
}

function createEditorFilePreviewStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { space: mobileSpace, type: mobileType } = metrics
  return StyleSheet.create({
    filePreviewContent: {
      alignItems: 'center',
      flexGrow: 1,
      justifyContent: 'center',
      padding: mobileSpace.xxl,
    },
    filePreviewDescription: {
      maxWidth: 360,
      color: mobileColors.textMuted,
      fontSize: mobileType.body,
      lineHeight: metrics.size(22),
      textAlign: 'center',
    },
    filePreviewFallback: {
      alignItems: 'center',
      gap: mobileSpace.md,
    },
    filePreviewTitle: {
      color: mobileColors.text,
      fontSize: mobileType.title,
      fontWeight: '600',
    },
  })
}
