import { useMobileColors, useMobileStyles } from '../../ui/theme/useMobileTheme'
import { useState } from 'react'
import { View } from 'react-native'
import { ArrowClockwise, GitCommit } from 'phosphor-react-native'
import { Text } from '../ui/text'
import { Switch } from '../ui/switch'
import { mobileText } from '../../i18n/mobileText'
import { MobileButton } from '../../ui/MobileButton'
import { MobileTextInput } from '../../ui/MobileTextInput'

import { useMobileSettings } from '../../settings/useMobileSettings'
import { useMobileAnalytics } from '../../analytics/useMobileAnalytics'
import type { useMobileVaults } from '../../workspace/git/useMobileVaults'
import { createVaultManagerStyles } from './vaultManagerStyles'

type GitControlsManager = Pick<ReturnType<typeof useMobileVaults>, 'active' | 'busy' | 'status' | 'sync' | 'commit' | 'lastCommitId'>

export function MobileGitControls({ manager }: { manager: GitControlsManager }) {
  const styles = useMobileStyles(createVaultManagerStyles)
  const mobileColors = useMobileColors()
  const [message, setMessage] = useState('')
  const preferences = useMobileSettings()
  if (!manager.active.git) return null
  return <View style={styles.section} testID="vault-git-controls">
    <View style={styles.row}>
      <GitCommit color={mobileColors.textMuted} size={18} />
      <Text style={styles.label}>{mobileText('settings.autogit.title')}</Text>
      <Text style={styles.detail}>{mobileText(preferences.settings.autoGit ? 'mobile.git.auto' : 'mobile.git.manual')}</Text>
      {manager.lastCommitId && <Text selectable style={styles.detail}>{manager.lastCommitId}</Text>}
    </View>
    <AutoGitSettings disabled={manager.busy} />
    {manager.status === 'committed' && <Text accessibilityLiveRegion="polite" style={styles.detail} testID="git-commit-success">{mobileText('mobile.git.localCommit')}</Text>}
    {!preferences.settings.autoGit && <>
      <MobileTextInput label={mobileText('mobile.git.commitMessage')} value={message} onChangeText={setMessage} editable={!manager.busy} style={touchControl} testID="git-commit-message" />
      <View style={styles.row}>
      <MobileButton disabled={manager.busy || !message.trim()} label={mobileText('mobile.git.commitLocal')} icon={<GitCommit size={16} color={mobileColors.text} />} onPress={() => { void manager.commit(message) }} style={touchControl} testID="git-commit-local" />
      <MobileButton disabled={manager.busy || !message.trim()} label={mobileText('mobile.git.commitAndSync')} onPress={() => { void manager.commit(message, true) }} style={touchControl} testID="git-commit-sync" />
      </View>
    </>}
    <MobileButton disabled={manager.busy} label={mobileText('mobile.sync.action')} icon={<ArrowClockwise size={16} color={mobileColors.text} />} onPress={() => { void manager.sync() }} style={touchControl} testID="git-sync-now" />
  </View>
}

const touchControl = { minHeight: 44 }

function AutoGitSettings({ disabled }: { disabled: boolean }) {
  const styles = useMobileStyles(createVaultManagerStyles)
  const preferences = useMobileSettings()
  const analytics = useMobileAnalytics()
  return <View style={styles.section}>
    <View style={styles.row}>
      <Text style={styles.detail}>{mobileText('settings.autogit.enable')}</Text>
      <Switch checked={preferences.settings.autoGit} disabled={disabled || !preferences.ready || preferences.saving}
        accessibilityLabel={mobileText('settings.autogit.enable')} testID="settings-auto-git"
        onCheckedChange={(autoGit) => { void preferences.update({ autoGit }).then(saved => {
          if (saved) analytics.capture({ name: 'mobile_setting_changed', setting: 'autoGit' })
        }) }} />
    </View>
    <Text style={styles.detail}>{mobileText('mobile.settings.autoGitForeground')}</Text>
  </View>
}
