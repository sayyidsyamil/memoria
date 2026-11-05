import { useSyncExternalStore } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { X } from 'phosphor-react-native'
import { Text } from '../ui/text'
import { MobileButton } from '../../ui/MobileButton'
import { mobileText } from '../../i18n/mobileText'
import { useMobileColors, useMobileStyles } from '../../ui/theme/useMobileTheme'
import { createVaultManagerStyles } from './vaultManagerStyles'
import { gitCloneProgressLabel } from '../../workspace/git/gitCloneProgressLabel'
import type { useGitCloneProgress } from '../../workspace/git/useGitCloneProgress'
import { useMobileAnalytics } from '../../analytics/useMobileAnalytics'

export function MobileCloneProgress({ clone }: { clone: ReturnType<typeof useGitCloneProgress> }) {
  const styles = useMobileStyles(createVaultManagerStyles)
  const colors = useMobileColors()
  const analytics = useMobileAnalytics()
  const progress = useSyncExternalStore(clone.progress.subscribe, clone.progress.snapshot, clone.progress.snapshot)
  if (!clone.running) return null
  const status = gitCloneProgressLabel({ progress, cancelling: clone.cancelling, publishing: clone.publishing })
  return <View style={styles.content} testID="git-clone-progress">
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityValue={status.value}>
      <ActivityIndicator color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.label} testID="git-clone-phase">{status.label}</Text>
        {status.count && <Text style={styles.detail} testID="git-clone-count">{status.count}</Text>}
      </View>
    </View>
    {!clone.publishing && <MobileButton label={mobileText('common.cancel')} icon={<X size={16} color={colors.text} />}
      disabled={clone.cancelling} onPress={() => {
        analytics.capture({ name: 'mobile_git_clone_cancel_requested' })
        clone.cancel()
      }} testID="git-clone-cancel" />}
  </View>
}
