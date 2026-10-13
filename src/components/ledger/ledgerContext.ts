import { createContext, useContext } from 'react'
import type { LedgerApi, LedgerFact, LedgerRegistry, MeetingSummary, Proposal } from '../../lib/ledgerApi'
import type { VaultEntry } from '../../types'

export interface LedgerData {
  registry: LedgerRegistry
  facts: LedgerFact[]
  proposals: Proposal[]
  meetings: MeetingSummary[]
}

export type LedgerTab = 'now' | 'review' | 'ask' | 'prepare' | 'meetings' | 'setup'

export interface LedgerContextValue {
  api: LedgerApi
  data: LedgerData
  entries: VaultEntry[]
  vaultPath: string
  refresh: () => Promise<void>
  goToTab: (tab: LedgerTab) => void
  notify: (message: string) => void
  meetingLabel: (meetingId: string | null | undefined) => string
  saveNote: (title: string, markdown: string) => Promise<void> | void
  readNote: (path: string) => Promise<string>
}

export const LedgerContext = createContext<LedgerContextValue | null>(null)

export function useLedger(): LedgerContextValue {
  const value = useContext(LedgerContext)
  if (!value) throw new Error('useLedger must be used inside the decision ledger panel')
  return value
}
