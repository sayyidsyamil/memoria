import type { MobileMetrics } from '../../ui/mobileMetrics'
import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'

import { visibleMobileWorkspaceSuggestions, type MobileWorkspaceSuggestionItem } from './MobileWorkspaceSuggestionListModel'
import { mobileWorkspaceSuggestionRowLayoutContract } from './MobileWorkspaceActionSheetModel'

export function MobileWorkspaceSuggestionList({
  items,
  labels,
  maxVisibleItems,
  onSelect,
  testID,
  testIDPrefix,
}: {
  items?: MobileWorkspaceSuggestionItem[]
  labels?: string[]
  maxVisibleItems?: number
  onSelect: (value: string, item: MobileWorkspaceSuggestionItem) => void
  testID: string
  testIDPrefix: string
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  const suggestions = suggestionItems(labels, items)
  if (suggestions.length === 0) return null
  const visibleSuggestions = visibleMobileWorkspaceSuggestions(suggestions, maxVisibleItems)
  if (visibleSuggestions.length === 0) return null

  return (
    <View style={styles.list} testID={testID}>
      {visibleSuggestions.map((item) => (
        <Pressable
          accessibilityLabel={humanizeSuggestionLabel(item.label)}
          accessibilityRole="button"
          key={`${item.value}-${item.label}`}
          style={styles.pressable}
          testID={`${testIDPrefix}-${item.testId ?? testIdSegment(item.value)}`}
          onPress={() => onSelect(item.value, item)}
        >
          {({ pressed }) => (
            <View style={[styles.row, pressed ? styles.rowPressed : null]}>
              <Text numberOfLines={1} style={styles.title}>{humanizeSuggestionLabel(item.label)}</Text>
              {item.meta ? <Text numberOfLines={1} style={styles.meta}>{item.meta}</Text> : null}
            </View>
          )}
        </Pressable>
      ))}
    </View>
  )
}

function suggestionItems(
  labels: string[] | undefined,
  items: MobileWorkspaceSuggestionItem[] | undefined,
): MobileWorkspaceSuggestionItem[] {
  return items ?? labels?.map((label) => ({ label, value: label })) ?? []
}

function humanizeSuggestionLabel(label: string) {
  return label
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function testIdSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function createThemeStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { space: mobileSpace, type: mobileType } = metrics
  const styles = StyleSheet.create({
    list: {
      gap: mobileSpace.xs,
    },
    meta: {
      maxWidth: 140,
      flexShrink: 0,
      color: mobileColors.textMuted,
      fontSize: mobileType.caption,
      textAlign: 'right',
    },
    pressable: {
      alignSelf: 'stretch',
      width: '100%',
    },
    row: {
      minHeight: metrics.size(mobileWorkspaceSuggestionRowLayoutContract.minHeight),
      minWidth: 0,
      alignSelf: 'stretch',
      alignItems: 'center',
      flexDirection: 'row',
      gap: mobileSpace.sm,
      width: '100%',
      backgroundColor: mobileColors.control,
      borderColor: mobileColors.border,
      borderRadius: mobileWorkspaceSuggestionRowLayoutContract.radius,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: metrics.size(mobileWorkspaceSuggestionRowLayoutContract.paddingHorizontal),
      paddingVertical: metrics.size(mobileWorkspaceSuggestionRowLayoutContract.paddingVertical),
    },
    rowPressed: {
      backgroundColor: mobileColors.graySoft,
    },
    title: {
      minWidth: 0,
      flex: 1,
      color: mobileColors.text,
      fontSize: mobileType.body,
      fontWeight: '500',
    },
  })
  return { mobileColors, styles }
}
