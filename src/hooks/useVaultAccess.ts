import { useEffect, useSyncExternalStore } from 'react'
import {
  canWritePath,
  checkVaultAccess,
  getVaultAccess,
  isViewOnly,
  subscribeVaultAccess,
  type VaultAccessState,
} from '../lib/sharing/vaultAccess'

/** What the user may do in this page's vault (TOL-237); a shared vault's access is checked once. */
export function useVaultAccess(): VaultAccessState {
  const access = useSyncExternalStore(subscribeVaultAccess, getVaultAccess)
  useEffect(() => {
    void checkVaultAccess()
  }, [])
  return access
}

/** True when the note at `path` (or, with none, the vault) was shared with the user to view only. */
export function useSharedReadOnly(path: string | null): boolean {
  const access = useVaultAccess()
  return path ? !canWritePath(access, path) : isViewOnly(access)
}
