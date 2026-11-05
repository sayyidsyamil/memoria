import { useEffect, useMemo, type ReactNode } from 'react'
import { Appearance, Platform, useColorScheme, View } from 'react-native'
import { vars } from 'nativewind'
import { useMobileSettings } from '../../settings/useMobileSettings'
import { mobilePalettes, resolveMobileTheme } from './mobilePalette'
import { nativewindPalettes } from './nativewindPalette'
import { MobileThemeContext } from './useMobileTheme'
import { mobileMetrics } from '../mobileMetrics'

const variableStyles = { light: vars(nativewindPalettes.light), dark: vars(nativewindPalettes.dark) }

export function MobileThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useMobileSettings()
  const system = useColorScheme()
  const mode = resolveMobileTheme(settings.theme, system)
  const theme = useMemo(() => ({ mode, colors: mobilePalettes[mode], metrics: mobileMetrics[settings.uiScale] }), [mode, settings.uiScale])
  useEffect(() => {
    if (Platform.OS === 'web') return
    Appearance.setColorScheme(settings.theme === 'system' ? 'unspecified' : settings.theme)
    return () => Appearance.setColorScheme('unspecified')
  }, [settings.theme])
  return <MobileThemeContext.Provider value={theme}>
    <View style={[{ flex: 1, backgroundColor: theme.colors.app }, variableStyles[mode]]}>
      {children}
    </View>
  </MobileThemeContext.Provider>
}
