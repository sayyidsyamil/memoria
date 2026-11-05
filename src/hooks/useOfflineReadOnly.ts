import { hasOfflineRead } from '../lib/offline/offlineMode'
import { useNetworkStatus } from './useNetworkStatus'

/** Web only: true while the network is gone, so the open note can be read but not edited. */
export function useOfflineReadOnly(): boolean {
  const { isOffline } = useNetworkStatus()
  return isOffline && hasOfflineRead()
}
