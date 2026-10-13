import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { createLedgerApi } from '../lib/ledgerApi'
import { prettyMeetingId } from '../lib/ledgerFormat'
import type { VaultEntry } from '../types'
import { MEMORIA_OPEN_LEDGER_EVENT, type OpenLedgerEventDetail } from '../utils/memoriaWorkflow'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { AskTab } from './ledger/AskTab'
import { meetingIdForNote } from './ledger/ingestNote'
import { LedgerContext, type LedgerContextValue, type LedgerTab } from './ledger/ledgerContext'
import { MeetingsTab } from './ledger/MeetingsTab'
import { NowTab } from './ledger/NowTab'
import { PrepareTab } from './ledger/PrepareTab'
import { ReviewTab } from './ledger/ReviewTab'
import { SetupTab } from './ledger/SetupTab'
import { Busy, ErrorNotice } from './ledger/ui'
import { useLedgerData } from './ledger/useLedgerData'

interface LedgerPanelProps {
  vaultPath: string
  entries: VaultEntry[]
  onSaveNote: (title: string, markdown: string) => Promise<void> | void
}

const TABS: { id: LedgerTab; label: string }[] = [
  { id: 'now', label: 'Now' },
  { id: 'review', label: 'To review' },
  { id: 'ask', label: 'Ask' },
  { id: 'prepare', label: 'Prepare' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'setup', label: 'Setup' },
]

function readNote(path: string): Promise<string> {
  return isTauri() ? invoke<string>('get_note_content', { path }) : mockInvoke<string>('get_note_content', { path })
}

export function LedgerPanel({ vaultPath, entries, onSaveNote }: LedgerPanelProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<LedgerTab>('now')
  const [notice, setNotice] = useState<string | null>(null)
  const api = useMemo(() => createLedgerApi(vaultPath), [vaultPath])
  const { data, loading, error, refresh } = useLedgerData(api, open)

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenLedgerEventDetail | undefined>).detail
      setTab(detail?.tab ?? 'now')
      setNotice(null)
      setOpen(true)
    }
    window.addEventListener(MEMORIA_OPEN_LEDGER_EVENT, onOpen)
    return () => window.removeEventListener(MEMORIA_OPEN_LEDGER_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const meetingLabel = useCallback((meetingId: string | null | undefined) => {
    if (!meetingId) return 'an unknown meeting'
    const entry = entries.find((e) => meetingIdForNote(e.path, vaultPath) === meetingId)
    return entry?.title ?? prettyMeetingId(meetingId)
  }, [entries, vaultPath])

  const context = useMemo<LedgerContextValue | null>(() => data && {
    api, data, entries, vaultPath, refresh, goToTab: setTab, notify: setNotice, meetingLabel, saveNote: onSaveNote, readNote,
  }, [api, data, entries, vaultPath, refresh, meetingLabel, onSaveNote])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(88vh,760px)] flex-col gap-3 sm:max-w-[1040px]" aria-describedby="ledger-description">
        <div>
          <DialogTitle>Decisions &amp; commitments</DialogTitle>
          <DialogDescription id="ledger-description">What your meetings decided and who promised what, each backed by the words that were said.</DialogDescription>
        </div>
        {error && !data ? <ErrorNotice message={error} onRetry={() => void refresh()} /> : null}
        {!data && !error ? <Busy label="Starting the decision engine…" /> : null}
        {context ? (
          <LedgerContext.Provider value={context}>
            <Tabs value={tab} onValueChange={(v) => setTab(v as LedgerTab)} className="flex min-h-0 flex-1 flex-col gap-3">
              <TabsList className="self-start">
                {TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id}>
                    {t.label}
                    {t.id === 'review' && data && data.proposals.length > 0 ? <Badge aria-label={`${data.proposals.length} waiting`} className="ml-1.5 h-5 min-w-5 px-1.5">{data.proposals.length}</Badge> : null}
                  </TabsTrigger>
                ))}
              </TabsList>
              {error ? <ErrorNotice message={error} onRetry={() => void refresh()} /> : null}
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <TabsContent value="now"><NowTab /></TabsContent>
                <TabsContent value="review"><ReviewTab /></TabsContent>
                <TabsContent value="ask"><AskTab /></TabsContent>
                <TabsContent value="prepare"><PrepareTab /></TabsContent>
                <TabsContent value="meetings"><MeetingsTab /></TabsContent>
                <TabsContent value="setup"><SetupTab /></TabsContent>
              </div>
            </Tabs>
          </LedgerContext.Provider>
        ) : null}
        {loading && data ? <span className="sr-only" role="status">Refreshing</span> : null}
        {notice ? <div role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">{notice}</div> : null}
      </DialogContent>
    </Dialog>
  )
}
