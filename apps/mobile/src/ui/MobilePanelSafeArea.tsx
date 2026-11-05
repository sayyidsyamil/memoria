import { useMobileStyles } from './theme/useMobileTheme'
import type { MobileColors } from './theme/mobilePalette'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function MobilePanelSafeArea({ children, sidebar = false, divider = 'right' }: {
  children: ReactNode
  sidebar?: boolean
  divider?: 'left' | 'right' | 'none'
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  const { top } = useSafeAreaInsets()
  return <View style={[styles.panel, sidebar && styles.sidebar, { paddingTop: top }]}>
    {divider !== 'none' && <View pointerEvents="none" style={[styles.divider, { height: top }, divider === 'left' ? styles.left : styles.right]} />}
    {children}
  </View>
}

function createThemeStyles(mobileColors: MobileColors) {
  const styles = StyleSheet.create({
    panel: { flex: 1, minWidth: 0, backgroundColor: mobileColors.card },
    sidebar: { backgroundColor: mobileColors.sidebar },
    divider: { position: 'absolute', top: 0, width: StyleSheet.hairlineWidth, backgroundColor: mobileColors.border },
    left: { left: 0 },
    right: { right: 0 },
  })
  return { mobileColors, styles }
}
