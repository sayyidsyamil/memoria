import type { MobileMetrics } from '../../ui/mobileMetrics'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { StyleSheet } from 'react-native'
import { mobileWorkspaceFilterControlLayoutContract, mobileWorkspaceFormSectionLayoutContract } from './MobileWorkspaceActionSheetModel'

export function createViewFilterStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const styles = {
    ...filterLayoutStyles(mobileColors, metrics),
    ...filterConditionStyles(mobileColors, metrics),
    ...filterControlStyles(mobileColors, metrics),
  }
  return { mobileColors, styles }
}

function filterLayoutStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { space: mobileSpace, type: mobileType } = metrics
  return StyleSheet.create({
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: mobileSpace.xs,
    },
    builder: {
      gap: metrics.size(mobileWorkspaceFormSectionLayoutContract.gap),
      borderColor: mobileColors.border,
      borderRadius: mobileWorkspaceFormSectionLayoutContract.radius,
      borderWidth: StyleSheet.hairlineWidth,
      padding: metrics.size(mobileWorkspaceFormSectionLayoutContract.padding),
    },
    group: {
      gap: mobileSpace.sm,
    },
    groupHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: mobileSpace.xs,
    },
    groupHint: {
      flex: 1,
      color: mobileColors.textMuted,
      fontSize: mobileType.caption,
    },
    nestedGroup: {
      borderLeftColor: mobileColors.borderStrong,
      borderLeftWidth: 2,
      paddingLeft: mobileSpace.sm,
    },
    nodeList: {
      gap: mobileSpace.sm,
    }
  })
}

function filterConditionStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { space: mobileSpace, type: mobileType } = metrics
  return StyleSheet.create({
    condition: {
      gap: mobileSpace.sm,
      borderColor: mobileColors.border,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      padding: mobileSpace.sm,
    },
    conditionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: mobileSpace.sm,
    },
    conditionTitle: {
      flex: 1,
      color: mobileColors.text,
      fontSize: mobileType.caption,
      fontWeight: '600',
    },
    feedbackRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: mobileSpace.xs,
    },
    invalidInput: {
      borderColor: mobileColors.danger,
    },
    invalidText: {
      color: mobileColors.danger,
      fontSize: mobileType.caption,
    },
    label: {
      color: mobileColors.textMuted,
      fontSize: mobileType.caption,
      fontWeight: '500',
    },
    valuePreview: {
      color: mobileColors.textMuted,
      fontSize: mobileType.caption,
      paddingLeft: mobileSpace.xs,
    }
  })
}

function filterControlStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  return StyleSheet.create({
    iconButton: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 4,
      height: 24,
      width: 24,
    },
    modeButton: {
      minHeight: metrics.size(mobileWorkspaceFilterControlLayoutContract.minHeight),
      backgroundColor: mobileColors.control,
      borderColor: mobileColors.borderStrong,
      borderRadius: mobileWorkspaceFilterControlLayoutContract.radius,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: metrics.size(mobileWorkspaceFilterControlLayoutContract.paddingHorizontal),
    },
    operatorPill: {
      minHeight: metrics.size(mobileWorkspaceFilterControlLayoutContract.minHeight),
      backgroundColor: mobileColors.control,
      borderColor: mobileColors.border,
      borderRadius: mobileWorkspaceFilterControlLayoutContract.radius,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: metrics.size(mobileWorkspaceFilterControlLayoutContract.paddingHorizontal),
    },
    operatorPillActive: {
      backgroundColor: mobileColors.primarySoft,
      borderColor: mobileColors.primary,
    },
    operatorWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: metrics.size(mobileWorkspaceFilterControlLayoutContract.gap),
    }
  })
}
