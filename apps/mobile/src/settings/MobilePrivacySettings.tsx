import { StyleSheet, View } from 'react-native'
import { Text } from '../components/ui/text'
import { Switch } from '../components/ui/switch'
import { mobileText } from '../i18n/mobileText'
import { useMobileStyles } from '../ui/theme/useMobileTheme'
import type { MobileColors } from '../ui/theme/mobilePalette'
import type { MobileMetrics } from '../ui/mobileMetrics'
import { useMobileAnalytics } from '../analytics/useMobileAnalytics'
import { useMobileSettings } from './useMobileSettings'
import { mobileCrashReporting } from '../analytics/mobileSentry'

export function MobilePrivacySettings() {
  const preferences = useMobileSettings()
  const analytics = useMobileAnalytics()
  const styles = useMobileStyles(createStyles)
  return <View style={styles.section}>
    <Text style={styles.heading}>{mobileText('settings.privacy.title')}</Text>
    <View style={styles.row}>
      <View style={styles.label}>
        <Text style={styles.title}>{mobileText('settings.privacy.analytics')}</Text>
        <Text style={styles.detail}>{mobileText('settings.privacy.analyticsDescription')}</Text>
      </View>
      <Switch checked={preferences.settings.analytics} disabled={!preferences.ready || preferences.saving}
        accessibilityLabel={mobileText('settings.privacy.analytics')} testID="settings-analytics"
        onCheckedChange={(enabled) => {
          if (!enabled) analytics.setEnabled(false)
          void preferences.update({ analytics: enabled })
        }} />
    </View>
    <View style={styles.row}>
      <View style={styles.label}>
        <Text style={styles.title}>{mobileText('settings.privacy.crashReporting')}</Text>
        <Text style={styles.detail}>{mobileText('settings.privacy.crashReportingDescription')}</Text>
      </View>
      <Switch checked={preferences.settings.crashReporting} disabled={!preferences.ready || preferences.saving}
        accessibilityLabel={mobileText('settings.privacy.crashReporting')} testID="settings-crash-reporting"
        onCheckedChange={(enabled) => {
          if (!enabled) void mobileCrashReporting.setEnabled(false)
          void preferences.update({ crashReporting: enabled })
        }} />
    </View>
  </View>
}

function createStyles(colors: MobileColors, metrics: MobileMetrics) {
  return StyleSheet.create({
    section: { gap: metrics.size(12), paddingTop: metrics.size(12) },
    row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: metrics.size(16) },
    label: { flex: 1, gap: metrics.size(4) },
    heading: { fontSize: metrics.size(16), fontWeight: '600', color: colors.text },
    title: { fontSize: metrics.size(14), color: colors.text },
    detail: { fontSize: metrics.size(12), lineHeight: metrics.size(18), color: colors.textMuted },
  })
}
