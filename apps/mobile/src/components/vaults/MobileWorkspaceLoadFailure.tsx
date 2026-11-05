import type { MobileMetrics } from '../../ui/mobileMetrics'
import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { StyleSheet, View } from 'react-native'
import { FolderOpen } from 'phosphor-react-native'
import { Text } from '../ui/text'
import { mobileText } from '../../i18n/mobileText'
import { MobileButton } from '../../ui/MobileButton'

export function MobileWorkspaceLoadFailure({ onManage, onRetry, reason }: {
  onManage: () => void; onRetry?: () => void; reason?: 'catalog' | 'selection'
}) {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  return <View style={styles.root} testID="workspace-load-failure">
    <Text accessibilityRole="alert" style={styles.message}>{mobileText(reason === 'catalog' ? 'mobile.vaults.catalogFailed' : 'mobile.vaults.requestFailed')}</Text>
    {onRetry && <MobileButton label={mobileText('pulse.retry')} onPress={onRetry} testID="vault-recovery-retry" />}
    <MobileButton label={mobileText('status.vault.manageWorkspaces')} onPress={onManage}
      icon={<FolderOpen size={16} color={mobileColors.text} />} />
  </View>
}

function createThemeStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const styles = StyleSheet.create({
    root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: metrics.size(24), gap: metrics.size(16), backgroundColor: mobileColors.app },
    message: { color: mobileColors.textMuted, fontSize: metrics.size(14), lineHeight: metrics.size(20), maxWidth: 440, textAlign: 'center' },
  })
  return { mobileColors, styles }
}
