import './global.css'
import { StatusBar } from 'expo-status-bar'
import { PortalHost } from '@rn-primitives/portal'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { MobileUiLab } from './src/screens/MobileUiLab'
import { MobileThemeProvider } from './src/ui/theme/MobileThemeProvider'
import { useMobileTheme } from './src/ui/theme/useMobileTheme'
import { useNativeGitProbe } from './src/qa/nativeGitProbe'
import { MobileVaultProvider } from './src/workspace/MobileVaultProvider'
import { MobileSettingsProvider } from './src/settings/MobileSettingsProvider'
import { MobileAnalyticsProvider } from './src/analytics/MobileAnalyticsProvider'

export function App() {
  useNativeGitProbe()
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileSettingsProvider>
        <MobileAnalyticsProvider><MobileThemeProvider><AppSurface /></MobileThemeProvider></MobileAnalyticsProvider>
      </MobileSettingsProvider>
    </GestureHandlerRootView>
  )
}

function AppSurface() {
  const { colors, mode } = useMobileTheme()
  return (
      <SafeAreaProvider>
        <SafeAreaView edges={['left', 'right']} style={{ backgroundColor: colors.app, flex: 1 }}>
          <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
          <MobileVaultProvider><MobileUiLab /></MobileVaultProvider>
        </SafeAreaView>
        <PortalHost />
      </SafeAreaProvider>
  )
}
