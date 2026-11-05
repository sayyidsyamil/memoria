import { useEffect, useSyncExternalStore } from 'react'
import { getSharing, scheduleSharingLoad, subscribeSharing, type SharingState } from '../lib/sharing/sharingStore'

/** The share records this page knows (TOL-237); the first read starts shortly after startup. */
export function useSharing(): SharingState {
  const sharing = useSyncExternalStore(subscribeSharing, getSharing)
  useEffect(() => scheduleSharingLoad(), [])
  return sharing
}
