import { useCallback, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Microphone, ArrowRight, ListChecks } from '@phosphor-icons/react'
import { MemoryReview } from './MemoryReview'
import { WorkspaceMemoryHub, type MemoryHubHandle } from './WorkspaceMemoryHub'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { useWorkspaceSummary } from '../hooks/useWorkspaceSummary'
import { useStartupMemoryHub } from '../hooks/useStartupMemoryHub'
import { useTrackedSummary } from '../features/temporal/useTrackedSummary'
import './workspaceActions.css'

/**
 * The sidebar's Memoria section: Start meeting, then one list of places (Decisions, Meetings, Ask, Briefs, Search, Review).
 * `hasMeetingNotes` lets the app open on Decisions as soon as the vault is read, before the counts arrive.
 */
export function WorkspaceActions({ vaultPath, hasMeetingNotes = false }: { vaultPath: string; hasMeetingNotes?: boolean }) {
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const { summary, refresh } = useWorkspaceSummary(vaultPath)
  const tracked = useTrackedSummary(vaultPath)
  const hub = useRef<MemoryHubHandle>(null)
  const openDecisions = useCallback(() => hub.current?.open('facts'), [])
  const holdsMemory = hasMeetingNotes || (summary?.meetings ?? 0) > 0 || (tracked?.items ?? 0) > 0 || (tracked?.facts ?? 0) > 0 ? true
    : summary && tracked ? false : undefined
  useStartupMemoryHub(holdsMemory, openDecisions, vaultPath)
  async function start(replay = false) {
    setStarting(true); setError('')
    try { await invoke('open_meeting_hud', { vaultPath, ...(replay ? { replay: true } : {}) }) }
    catch (error) { setError(String(error)); setMeetingOpen(true) }
    finally { setStarting(false) }
  }
  return (
    <div className="workspace-actions shrink-0 border-b border-border px-3 py-3" aria-label="Workspace actions">
      <Button className="workspace-start" disabled={starting} onClick={() => { void start() }}><Microphone size={18} weight="fill" />{starting ? 'Opening meeting…' : 'Start meeting'}<ArrowRight className="ml-auto opacity-75" size={15} /></Button>
      <WorkspaceMemoryHub ref={hub} key={`hub-${vaultPath}`} vaultPath={vaultPath} summary={summary} decisionsWaiting={tracked?.suggestions} onChanged={() => { void refresh() }} onStartMeeting={() => { void start() }} onReplayMeeting={() => { void start(true) }}>
        <MemoryReview key={`memory-${vaultPath}`} vaultPath={vaultPath} triggerIcon={<ListChecks size={16} />} triggerLabel="Review" badge={summary?.pendingReviews} />
      </WorkspaceMemoryHub>
      <Dialog open={meetingOpen} onOpenChange={setMeetingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Meeting could not start</DialogTitle>
            <DialogDescription>{error}</DialogDescription>
          </DialogHeader>
          <Button onClick={() => setMeetingOpen(false)}>Close</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
