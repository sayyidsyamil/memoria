import type { MobileMetrics } from '../../ui/mobileMetrics'
import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native'
import { GitBranch, GithubLogo, Globe, LockKey, X } from 'phosphor-react-native'
import { Button } from '../ui/button'
import { Text } from '../ui/text'
import { mobileText } from '../../i18n/mobileText'
import { MobileButton } from '../../ui/MobileButton'
import { MobileIconButton } from '../../ui/MobileIconButton'
import { MobilePanel, MobileToolbar, MobileToolbarSpacer, MobileToolbarTitle } from '../../ui/MobilePanel'
import { MobileTextInput } from '../../ui/MobileTextInput'

import { filterGitHubRepositories } from '../../workspace/git/githubRepositorySearch'
import type { GitHubRepository } from '../../workspace/git/githubAuth'
import type { useGitHubAccount } from '../../workspace/git/useGitHubAccount'
import { useMobileModalDismiss } from '../../workspace/useMobileModalDismiss'

type Props = { account: ReturnType<typeof useGitHubAccount>; disabled: boolean; clone: (url: string) => Promise<void> }

export function MobileGitHubRepositories({ account, clone, disabled }: Props) {
  const { mobileColors, styles } = useMobileStyles(createThemeStyles)
  const [open, setOpen] = useState(false)
  useMobileModalDismiss(() => setOpen(false), open)
  const [query, setQuery] = useState('')
  const repositories = useMemo(() => filterGitHubRepositories(account.repositories, query), [account.repositories, query])
  const choose = (repository: GitHubRepository) => {
    setOpen(false)
    void clone(repository.clone_url)
  }
  return <>
    <MobileButton disabled={disabled} label={mobileText('mobile.vaults.loadRepositories')}
      icon={<GithubLogo size={16} color={mobileColors.text} />}
      onPress={() => { setOpen(true); void account.loadRepositories() }} />
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <MobilePanel style={styles.panel} accessibilityViewIsModal testID="github-repository-picker">
          <MobileToolbar>
            <MobileToolbarTitle title={mobileText('mobile.vaults.repositories')} /><MobileToolbarSpacer />
            <MobileIconButton accessibilityLabel={mobileText('window.close')} onPress={() => setOpen(false)}><X size={18} color={mobileColors.textMuted} /></MobileIconButton>
          </MobileToolbar>
          <View style={styles.search}>
            <MobileTextInput label={mobileText('mobile.vaults.searchRepositories')} value={query} onChangeText={setQuery}
              autoCorrect={false} autoCapitalize="none" testID="github-repository-search" />
          </View>
          {account.error && <Text accessibilityRole="alert" style={styles.error}>{mobileText(account.error)}</Text>}
          <FlatList data={repositories} keyExtractor={(repository) => `${repository.id}`} keyboardShouldPersistTaps="handled"
            style={styles.list} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
            renderItem={({ item }) => <RepositoryRow repository={item} disabled={disabled} onPress={() => choose(item)} />}
            ListEmptyComponent={account.busy ? <ActivityIndicator color={mobileColors.primary} /> : <Text style={styles.empty}>{mobileText('command.noMatches')}</Text>}
            ListFooterComponent={account.hasMore ? <MobileButton disabled={account.busy} label={mobileText('mobile.vaults.more')} onPress={() => { void account.loadRepositories(true) }} /> : null}
          />
        </MobilePanel>
      </KeyboardAvoidingView>
    </Modal>
  </>
}

function RepositoryRow({ repository, disabled, onPress }: { repository: GitHubRepository; disabled: boolean; onPress: () => void }) {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  const VisibilityIcon = repository.private ? LockKey : Globe
  const visibilityLabel = mobileText(repository.private ? 'mobile.vaults.privateRepository' : 'mobile.vaults.publicRepository')
  const [owner, name] = repository.full_name.split('/')
  return <Button variant="ghost" disabled={disabled} accessibilityLabel={`${repository.full_name}, ${visibilityLabel}`}
    style={styles.repository} onPress={onPress} testID={`github-repository-${repository.id}`}>
    <GitBranch size={20} color={mobileColors.textMuted} />
    <View style={styles.identity}>
      <Text numberOfLines={1} style={styles.name}>{name ?? owner}</Text>
      <Text numberOfLines={1} style={styles.owner}>{owner}</Text>
    </View>
    <VisibilityIcon size={16} color={mobileColors.textMuted} />
  </Button>
}

function createThemeStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const styles = StyleSheet.create({
    backdrop: { flex: 1, padding: metrics.size(24), backgroundColor: mobileColors.overlay, alignItems: 'center', justifyContent: 'center' },
    panel: { width: '100%', maxWidth: 560, height: '85%', maxHeight: 640, borderRadius: 8, overflow: 'hidden' },
    search: { padding: metrics.size(16) },
    list: { flex: 1 },
    repository: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: metrics.size(12), minHeight: 64, height: 'auto', paddingHorizontal: metrics.size(16), paddingVertical: metrics.size(10), borderRadius: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: mobileColors.border },
    identity: { flex: 1, minWidth: 0, gap: metrics.size(4) },
    name: { color: mobileColors.text, fontSize: metrics.size(15), fontWeight: '500' },
    owner: { color: mobileColors.textMuted, fontSize: metrics.size(12) },
    empty: { color: mobileColors.textMuted, textAlign: 'center', padding: metrics.size(24) },
    error: { color: mobileColors.danger, paddingHorizontal: metrics.size(16), paddingBottom: metrics.size(12) },
  })
  return { mobileColors, styles }
}
