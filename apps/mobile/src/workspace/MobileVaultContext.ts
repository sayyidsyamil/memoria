import { createContext } from 'react'
import type { VaultSyncState } from './git/useMobileVaults'
import type { SyncPhase } from './syncLedgerModel'

export const MobileVaultControlsContext = createContext<{
  rootUri?: string
  git: boolean
  linked?: boolean
  busy: boolean
  status: VaultSyncState
  lastSuccessAt?: number | null
  lastFailureAt?: number | null
  phase?: SyncPhase
  pendingNotePaths?: ReadonlySet<string>
  historyAvailable?: boolean
  open: () => Promise<void>
  sync: () => Promise<void>
} | null>(null)

export const MobileVaultDisplayContext = createContext<{ source: string; rootUri?: string | null } | null>(null)

export const MobileVaultPickerContext = createContext<{
  choices: { id: string; label: string; selected: boolean; select: () => Promise<unknown> }[]
  disabled: boolean
  manage: () => void
} | null>(null)
