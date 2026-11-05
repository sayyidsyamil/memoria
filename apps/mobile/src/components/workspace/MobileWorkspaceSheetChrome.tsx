import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { createMobileWorkspaceSheetStyles as createThemeStyles } from './mobileWorkspaceActionSheetStyles'

export function ActionRow({
  icon,
  destructive = false,
  label,
  onPress,
  testID,
}: {
  destructive?: boolean
  icon: ReactNode
  label: string
  onPress: () => void
  testID?: string
}) {
  const { actionStyles } = useMobileStyles(createThemeStyles)
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" style={({ pressed }) => [actionStyles.actionRow, pressed ? actionStyles.actionRowPressed : null]} testID={testID} onPress={onPress}>
      <View style={actionStyles.actionRowContent}>
        <View style={actionStyles.actionIcon}>{icon}</View>
        <Text numberOfLines={1} style={[actionStyles.actionText, destructive ? actionStyles.actionTextDestructive : null]}>{label}</Text>
      </View>
    </Pressable>
  )
}

export function SheetFooter({ children, pinned = false }: { children: ReactNode; pinned?: boolean }) {
  const { styles } = useMobileStyles(createThemeStyles)
  return <View style={[styles.footer, pinned ? styles.pinnedFooter : null]}>{children}</View>
}
