import { useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ArrowSquareOut, ListChecks } from '@phosphor-icons/react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { openNoteInNewWindow } from '../utils/openNoteWindow'
import { Checkbox } from './ui/checkbox'
import { Textarea } from './ui/textarea'
import { Chip, EmptyState, StateButton } from './memoriaUi'
import { startMemoryJob } from '../lib/memoryJob'
import { kindTone } from '../lib/knowledgeKinds'
import { announceMemoryChanged } from '../hooks/useWorkspaceSummary'
import './memoryReview.css'

interface Claim { title: string; kind: string; statement: string; quote: string; evidenceId: string; page: number; targetPath: string | null; accepted?: boolean }
interface Proposal { id: string; status?: string; sourcePath: string; sourceTitle: string; claims: Claim[]; retrieval: string; warning?: string }
const PROGRESS: Record<string, string> = {
  list: 'Loading saved reviews…', compile: 'Reading your source and preparing changes… You can close this window while it runs.',
  apply: 'Saving reviewed knowledge…', reject: 'Rejecting this proposal…',
  undo: 'Restoring the previous knowledge…',
}
const STATUS_CHIPS: Record<string, { label: string; tone: 'green' | 'orange' | 'neutral' }> = {
  applied: { label: 'Saved', tone: 'green' }, undone: { label: 'Undone', tone: 'neutral' },
  stale: { label: 'Outdated — source or knowledge changed', tone: 'orange' }, rejected: { label: 'Rejected', tone: 'neutral' },
}

export function MemoryReview({ vaultPath, sourcePath, autoOpen = false, hideTrigger = false, inline = false, buildOnOpen = true, initialHistory = false, triggerIcon, badge }: {
  vaultPath: string; sourcePath?: string; autoOpen?: boolean; hideTrigger?: boolean
  /** Render the review in place instead of in a dialog. */
  inline?: boolean
  /** When false, opening only lists saved reviews and never starts a model build. */
  buildOnOpen?: boolean
  initialHistory?: boolean
  triggerIcon?: ReactNode
  badge?: number
}) {
  const [open, setOpen] = useState(false)
  const [operation, setOperation] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(initialHistory)
  const [rebuildSource, setRebuildSource] = useState<string | null>(null)
  const working = useRef(false)
  const cancel = useRef<(() => Promise<void>) | null>(null)
  const [stage, setStage] = useState('')
  const launched = useRef(false)
  const [selectedReview, setSelectedReview] = useState<string | null>(null)
  useEffect(() => {
    if (!autoOpen || launched.current) return
    launched.current = true
    setOpen(true)
    void run(sourcePath && buildOnOpen ? 'compile' : 'list')
    // These props are fixed for an import handoff; keep one build per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(action: string, id?: string, source = sourcePath) {
    if (working.current) return
    working.current = true
    setOperation(action); setError(null); setSuccess(null); setRebuildSource(null)
    try {
      if (action === 'apply') {
        const proposal = proposals.find(proposal => proposal.id === id)
        if (!proposal) throw new Error('Review is no longer available')
        await invoke('wiki_memory', { request: { action: 'review', vaultPath, id,
          edits: proposal.claims.map(claim => ({ statement: claim.statement, accepted: claim.accepted !== false })) } })
      }
      if (action === 'compile') {
        const job = startMemoryJob({ action, vaultPath, sourcePath: source, id }, setStage)
        cancel.current = job.cancel
        setStage('Starting local knowledge build…')
        await job.promise
      } else if (action !== 'list') await invoke('wiki_memory', { request: { action, vaultPath, sourcePath: source, id } })
      const saved = await invoke<Proposal[]>('wiki_memory', { request: { action: 'list', vaultPath } })
      setProposals(sourcePath ? saved.filter(proposal => proposal.sourcePath === sourcePath) : saved)
      if (action === 'apply') setSuccess('Changes saved to your knowledge. Existing text was preserved.')
      if (action === 'reject') setSuccess('Proposal rejected. Your knowledge was not changed.')
      if (action === 'undo') setSuccess('Changes undone. Previous knowledge restored.')
      // In place, keep the saved claims on screen instead of an empty "nothing waiting" state.
      if (inline && (action === 'apply' || action === 'undo' || action === 'reject')) setShowHistory(true)
      if (action !== 'list') announceMemoryChanged()
    } catch (error) {
      setError(String(error))
      // A stale review can only be replaced by compiling its source again, even when opened from the global list.
      const stale = action === 'apply' && /compile (it )?again/i.test(String(error)) ? proposals.find(proposal => proposal.id === id) : undefined
      if (stale) setRebuildSource(stale.sourcePath)
    }
    finally { working.current = false; setOperation(null); cancel.current = null }
  }

  async function openEvidence(proposal: Proposal) {
    try { await openNoteInNewWindow(`${vaultPath}/${proposal.sourcePath}`, vaultPath, proposal.sourceTitle) }
    catch (error) { setError(`Could not open source: ${String(error)}`) }
  }
  const pending = proposals.filter(proposal => proposal.status === 'pending')
  function editClaim(id: string, index: number, patch: Partial<Claim>) {
    setProposals(current => current.map(proposal => proposal.id === id ? { ...proposal,
      claims: proposal.claims.map((claim, position) => position === index ? { ...claim, ...patch } : claim) } : proposal))
  }
  const available = showHistory ? proposals : pending
  const current = available.find(proposal => proposal.id === selectedReview) ?? available[0]
  const visible = current ? [current] : []
  const hasHistory = proposals.some(proposal => proposal.status !== 'pending')
  const canSave = current?.status === 'pending' && current.claims.some(claim => claim.accepted !== false) && !current.claims.some(claim => claim.accepted !== false && !claim.statement.trim())

  const trigger = !hideTrigger && !inline && (sourcePath
    ? <Button className="min-h-[44px] w-full whitespace-normal" size="sm" variant="outline" onClick={() => {
      setOpen(true); if (!working.current) void run('compile')
    }}>{operation === 'compile' ? 'Preparing knowledge…' : 'Build knowledge'}</Button>
    : <Button className="workspace-row" variant="ghost" onClick={() => {
      setOpen(true); if (!working.current) void run('list')
    }}>{triggerIcon ?? <ListChecks size={16} />}<span>Review knowledge</span>{!!badge && <span className="workspace-row-count" data-attention="true">{badge}</span>}</Button>)

  const content = <>
    {(!inline || available.length > 1 || hasHistory) && <div className="knowledge-review-toolbar"><span>{showHistory ? 'Completed & pending' : 'Waiting for review'} <span className="text-muted-foreground">{available.length}</span></span>{available.length > 1 && <select aria-label="Choose source to review" value={current?.id ?? ''} onChange={event => setSelectedReview(event.target.value)}>{available.map(proposal => <option value={proposal.id} key={proposal.id}>{proposal.sourceTitle}</option>)}</select>}{hasHistory && <button onClick={() => setShowHistory(value => !value)}>{showHistory ? 'Hide completed reviews' : 'Show completed reviews'}</button>}</div>}
    {operation && <div className="knowledge-review-message space-y-2"><p role="status" className="text-sm">{operation === 'compile' ? stage : PROGRESS[operation]}</p>
      {operation === 'compile' && <Button variant="outline" onClick={() => { setStage('Cancelling…'); void cancel.current?.().catch(error => setError(String(error))) }}>Cancel build</Button>}
    </div>}
    {error && <div role="alert" className="knowledge-review-message space-y-2 text-sm"><p className="break-words text-destructive">{error}</p>
      {rebuildSource ? <Button variant="outline" disabled={Boolean(operation)} onClick={() => { void run('compile', undefined, rebuildSource) }}>Rebuild this review</Button>
        : <Button variant="outline" disabled={Boolean(operation)} onClick={() => { void run(sourcePath && buildOnOpen ? 'compile' : 'list') }}>Try again</Button>}</div>}
    {success && <p role="status" className="knowledge-review-message text-sm">{success}</p>}
    <div className="knowledge-review-body">
      {!operation && visible.length === 0 && !error && (inline && sourcePath
        ? <EmptyState icon={<ListChecks size={20} />} title="No outcomes proposed yet" action={<Button disabled={Boolean(operation)} onClick={() => { void run('compile') }}>Build knowledge</Button>}>Memoria reads this reviewed transcript and suggests decisions, commitments and people. Nothing is saved until you approve it.</EmptyState>
        : <div className="space-y-2 py-4">
          <p className="font-medium">No changes waiting for review</p>
          <p className="text-sm text-muted-foreground">Choose Import files, then Import & build knowledge.</p>
        </div>)}
      {visible.map(proposal => <section key={proposal.id} className="knowledge-review-proposal">
        <div className="knowledge-review-source">
          <h3 className="break-words">{proposal.sourceTitle}</h3>
          <p>{proposal.claims.length} suggestions · {proposal.claims.filter(claim => !claim.targetPath).length} new pages · {proposal.claims.filter(claim => claim.targetPath).length} updates</p>
          {proposal.status !== 'pending' && STATUS_CHIPS[proposal.status ?? ''] && <Chip tone={STATUS_CHIPS[proposal.status ?? ''].tone} dot>{STATUS_CHIPS[proposal.status ?? ''].label}</Chip>}
        </div>
        {proposal.claims.length === 0 && <p className="text-sm">No supported additions were found in this source.</p>}
        {proposal.claims.map((claim, index) => <article key={index} className="knowledge-claim" data-included={claim.accepted === false ? 'false' : 'true'}>
          <div className="knowledge-claim-head">
            <Chip tone={kindTone(claim.kind)}>{claim.kind}</Chip>
            <Chip>{claim.targetPath ? 'Adds to existing page' : 'New page'}</Chip>
            {proposal.status === 'pending' && <label className="knowledge-claim-include"><Checkbox checked={claim.accepted !== false} disabled={Boolean(operation)} onCheckedChange={value => editClaim(proposal.id, index, { accepted: value === true })} />Include this suggestion</label>}
          </div>
          <h4>{claim.title}</h4>
          {proposal.status === 'pending'
            ? <label className="block"><span className="sr-only">Reviewed statement</span><Textarea aria-label={`Statement: ${claim.title}`} value={claim.statement} disabled={Boolean(operation) || claim.accepted === false} maxLength={1200} onChange={event => editClaim(proposal.id, index, { statement: event.target.value })} /></label>
            : <p className="knowledge-claim-statement">{claim.statement}</p>}
          {claim.targetPath && <p className="knowledge-claim-destination">Destination: {claim.targetPath}. Existing text stays unchanged.</p>}
          <details className="knowledge-review-evidence" open>
            <summary>Source evidence · page {claim.page}</summary>
            <blockquote>{claim.quote}</blockquote>
            <Button variant="ghost" size="sm" onClick={() => { void openEvidence(proposal) }}><ArrowSquareOut size={13} />Open source document</Button>
          </details>
        </article>)}
        <details className="knowledge-review-details"><summary>Processing details</summary><p>{proposal.retrieval}</p>{proposal.warning && <p className="break-words">{proposal.warning}</p>}</details>
        {proposal.status === 'applied' && <Button variant="outline" disabled={Boolean(operation)} onClick={() => { void run('undo', proposal.id) }}>Undo saved changes</Button>}
      </section>)}
    </div>
    <footer className="knowledge-review-footer"><span>{current?.status === 'pending' ? 'Nothing is added until you save.' : inline ? 'Approved knowledge appears under All approved.' : 'Nothing is added until you save.'}</span>{current?.status === 'pending'
      ? <div className="flex gap-2"><Button disabled={Boolean(operation)} variant="ghost" onClick={() => { void run('reject', current.id) }}>Skip source</Button>
        <StateButton disabled={!canSave} status={operation === 'apply' ? 'working' : 'idle'} labels={{ idle: 'Save changes', working: 'Saving…', done: 'Saved' }} onClick={() => { void run('apply', current.id) }} /></div>
      : inline ? null : <Button variant="ghost" onClick={() => setOpen(false)}>Done</Button>}</footer>
  </>

  if (inline) return <section className="knowledge-review-inline" aria-label="Review knowledge">{content}</section>
  return <>
    {trigger}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="knowledge-review-dialog">
        <DialogHeader className="knowledge-review-header"><DialogTitle>Review knowledge</DialogTitle><DialogDescription>
          Check the suggestions. Save what belongs in your knowledge.
        </DialogDescription></DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  </>
}
