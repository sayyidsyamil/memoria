import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Microphone, ArrowRight, ListChecks } from '@phosphor-icons/react'
import { SourceIntake } from './SourceIntake'
import { MemoryReview } from './MemoryReview'
import { WorkspaceMemoryHub } from './WorkspaceMemoryHub'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { useWorkspaceSummary } from '../hooks/useWorkspaceSummary'
import './workspaceActions.css'

export function WorkspaceActions({ vaultPath }: { vaultPath: string }) {
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const { summary, refresh } = useWorkspaceSummary(vaultPath)
  async function start() {
    setStarting(true); setError('')
    try { await invoke('open_meeting_hud', { vaultPath }) }
    catch (error) { setError(String(error)); setMeetingOpen(true) }
    finally { setStarting(false) }
  }
  return (
    <div className="workspace-actions shrink-0 border-b border-border px-3 py-3" aria-label="Workspace actions">
      <Button className="workspace-start" disabled={starting} onClick={() => { void start() }}><Microphone size={18} weight="fill" />{starting ? 'Opening meeting…' : 'Start meeting'}<ArrowRight className="ml-auto opacity-75" size={15} /></Button>
      <div className="workspace-rows">
        <SourceIntake key={vaultPath} vaultPath={vaultPath} />
        <MemoryReview key={`memory-${vaultPath}`} vaultPath={vaultPath} triggerIcon={<ListChecks size={16} />} badge={summary?.pendingReviews} />
      </div>
      <WorkspaceMemoryHub key={`hub-${vaultPath}`} vaultPath={vaultPath} summary={summary} onChanged={() => { void refresh() }} onStartMeeting={() => { void start() }} />
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
