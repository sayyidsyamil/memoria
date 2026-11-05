import type { MobileMetrics } from '../../ui/mobileMetrics'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { StyleSheet } from 'react-native'

export function createWhiteboardActionStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const styles = {
    ...whiteboardActionStyles(mobileColors, metrics),
    ...whiteboardEditorStyles(mobileColors, metrics),
    ...whiteboardShapeStyles(mobileColors, metrics),
    ...whiteboardPickerStyles(mobileColors, metrics),
  }
  return { mobileColors, styles }
}

function whiteboardActionStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { toolbarAction: desktopToolbarActionParity, space: mobileSpace, type: mobileType } = metrics
  return StyleSheet.create({
    actionIcon: {
      width: desktopToolbarActionParity.iconSize,
      alignItems: 'center',
    },
    actionRow: {
      minWidth: 0,
      borderRadius: 6,
    },
    actionRowContent: {
      minHeight: 44,
      alignItems: 'center',
      flexDirection: 'row',
      gap: mobileSpace.sm,
      paddingHorizontal: mobileSpace.sm,
    },
    actionText: {
      minWidth: 0,
      flex: 1,
      color: mobileColors.text,
      fontSize: mobileType.body,
      fontWeight: '500',
    },
    rowPressed: {
      backgroundColor: mobileColors.graySoft,
    }
  })
}

function whiteboardEditorStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { space: mobileSpace, type: mobileType } = metrics
  return StyleSheet.create({
    editor: {
      gap: mobileSpace.md,
      borderColor: mobileColors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: mobileSpace.md,
    },
    footer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: mobileSpace.sm,
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: mobileSpace.sm,
    },
    metadataFields: {
      gap: mobileSpace.sm,
    },
    snapshotInput: {
      minHeight: 160,
    },
    title: {
      color: mobileColors.text,
      fontSize: mobileType.body,
      fontWeight: '500',
    },
  })
}

function whiteboardShapeStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { space: mobileSpace } = metrics
  return StyleSheet.create({
    structuredEditor: {
      gap: mobileSpace.sm,
      borderColor: mobileColors.border,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      padding: mobileSpace.sm,
    },
    structuredEditorFooter: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    removeTextShapeButton: {
      alignSelf: 'flex-end',
    },
    textShapeInput: {
      minWidth: 0,
      flex: 1,
    },
    textShapeList: {
      gap: mobileSpace.sm,
    },
    textShapeRow: {
      minWidth: 0,
      alignItems: 'flex-end',
      flexDirection: 'row',
      gap: mobileSpace.sm,
    },
  })
}

function whiteboardPickerStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { space: mobileSpace, type: mobileType } = metrics
  return StyleSheet.create({
    picker: {
      gap: mobileSpace.xs,
    },
    pickerRow: {
      minHeight: 34,
      alignItems: 'center',
      flexDirection: 'row',
      borderRadius: 6,
      paddingHorizontal: mobileSpace.sm,
      paddingVertical: mobileSpace.xs,
    },
    pickerRowSelected: {
      backgroundColor: mobileColors.selected,
    },
    pickerTitle: {
      minWidth: 0,
      flex: 1,
      color: mobileColors.text,
      fontSize: mobileType.body,
      fontWeight: '500',
    }
  })
}
