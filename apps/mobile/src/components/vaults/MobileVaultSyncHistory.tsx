import { View } from 'react-native'
import { Text } from '../ui/text'
import { mobileText } from '../../i18n/mobileText'
import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import { createVaultManagerStyles } from './vaultManagerStyles'
import type { useMobileVaults } from '../../workspace/git/useMobileVaults'

type HistoryProps = Pick<ReturnType<typeof useMobileVaults>, 'syncHistory' | 'active' | 'linked'>

export function MobileVaultSyncHistory({ manager }: { manager: HistoryProps }) {
  const styles = useMobileStyles(createVaultManagerStyles)
  const { record, failed } = manager.syncHistory
  const pending = isPending(manager)
  if (!hasHistory(manager, pending)) return null
  return <View style={styles.section} testID="vault-sync-history">
    {pending && <Text style={styles.detail}>{mobileText('mobile.sync.pending')}</Text>}
    {record.lastSuccessAt !== null && <Text style={styles.detail} testID="vault-last-sync">{mobileText('mobile.sync.lastSuccess').replace('{time}', new Date(record.lastSuccessAt).toLocaleString())}</Text>}
    {record.lastCommitId && <Text style={styles.detail}>{mobileText('mobile.sync.lastCommit').replace('{commit}', record.lastCommitId)}</Text>}
    {record.error && <Text style={styles.detail}>{mobileText(record.error === 'provider'
      ? 'mobile.vaults.folderUnavailable' : `mobile.sync.${record.error}` as Parameters<typeof mobileText>[0])}</Text>}
    {failed && <Text style={styles.error}>{mobileText('mobile.sync.historyFailed')}</Text>}
  </View>
}

function hasHistory({ syncHistory: { record, failed } }: HistoryProps, pending: boolean) {
  return [failed, record.error, record.lastSuccessAt !== null, record.lastCommitId, pending].some(Boolean)
}

function isPending(manager: HistoryProps) {
  return manager.syncHistory.record.status === 'pending' && Boolean(manager.active.git || manager.linked)
}
