import { StyleSheet, View } from 'react-native'
import { Text } from '../components/ui/text'
import { MobileButton } from '../ui/MobileButton'
import { mobileText } from '../i18n/mobileText'
import { useMobileStyles } from '../ui/theme/useMobileTheme'
import type { MobileColors } from '../ui/theme/mobilePalette'
import type { MobileMetrics } from '../ui/mobileMetrics'
import { useMobileSettings } from './useMobileSettings'
import { useMobileAnalytics } from '../analytics/useMobileAnalytics'

export function MobileAppearanceSettings() {
  const preferences = useMobileSettings()
  const analytics = useMobileAnalytics()
  const styles = useMobileStyles(createStyles)
  const disabled = !preferences.ready || preferences.saving
  return <View style={styles.section}>
    <Text style={styles.heading}>{mobileText('settings.appearance.title')}</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel={mobileText('settings.theme.label')} style={styles.options}>
      {(['system', 'light', 'dark'] as const).map(theme => <MobileButton
        key={theme}
        label={mobileText(`settings.theme.${theme}`)}
        accessibilityRole="radio"
        accessibilityState={{ checked: preferences.settings.theme === theme }}
        disabled={disabled}
        variant={preferences.settings.theme === theme ? 'secondary' : 'ghost'}
        style={styles.option}
        testID={`settings-theme-${theme}`}
        onPress={() => { void preferences.update({ theme }).then(saved => {
          if (saved) analytics.capture({ name: 'theme_mode_changed', mode: theme })
        }) }}
      />)}
    </View>
  </View>
}

function createStyles(colors: MobileColors, metrics: MobileMetrics) {
  return StyleSheet.create({
    section: { gap: metrics.size(12), paddingBottom: metrics.size(12) },
    heading: { fontSize: metrics.size(16), fontWeight: '600', color: colors.text },
    options: { flexDirection: 'row', gap: metrics.size(4), padding: metrics.size(4), borderRadius: 6, backgroundColor: colors.graySoft },
    option: { flex: 1, minHeight: 44 },
  })
}
