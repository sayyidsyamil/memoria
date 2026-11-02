import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ArrowSquareOut, FileText, MagnifyingGlass, Microphone, Quotes, SealCheck, Trash, Waveform } from '@phosphor-icons/react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { MeetingTranscriptReview, type MeetingTab, type TranscriptDraft } from './MeetingTranscriptReview'
import { MemoryAsk, type AskMode } from './MemoryAsk'
import { MemorySearch } from './MemorySearch'
import { Avatar, Chip, EmptyState, LifecycleRail, PillTabList, PillTabPanel, PillTabsRoot, SectionLabel, type RailState } from './memoriaUi'
import { openNoteInNewWindow } from '../utils/openNoteWindow'
import { kindTone } from '../lib/knowledgeKinds'
import { dayLabel, plural, whenLabel } from '../lib/format'
import { clock, identifiedSpeakers, speakerLabel, speakerOrder, speakerTone } from '../lib/speakers'
import type { WorkspaceSummary } from '../hooks/useWorkspaceSummary'
import './workspaceMemoryHub.css'
import { meetingService } from '../features/meetings/meetingService'
import type { MeetingRecord } from '../features/meetings/meetingTypes'
import { TemporalMemoryPanel } from '../features/temporal/TemporalMemoryPanel'
import { RecordingRecovery } from '../features/meetings/RecordingRecovery'

export type HubView = 'meetings' | 'search' | 'ask' | 'approved' | 'briefs' | 'facts'
type Meeting = MeetingRecord
interface Approved {
  id: string; title: string; kind: string; statement: string; quote: string; sourcePath: string
  sourceTitle: string; page: number; knowledgePath: string; pageTitle?: string; status: string; approvedAt?: string
  moment?: { meetingId: string; meetingTitle: string; at: number | null } | null
}
interface Brief { id: string; topic: string; pagePath: string; created: string }

function participants(meeting: Meeting) {
  const turns = meeting.turns ?? []
  if (!turns.length) return 'No transcript'
  const order = speakerOrder(turns.map(turn => turn.speaker))
  const identified = identifiedSpeakers(turns.map(turn => turn.speaker), meeting.names)
  if (!identified.length) return 'Speaker not identified'
  const named = identified.filter(speaker => meeting.names?.[speaker]?.trim()).map(speaker => speakerLabel(speaker, meeting.names, order))
  if (named.length) return named.slice(0, 3).join(', ') + (named.length > 3 ? ` +${named.length - 3}` : '')
  return `${identified.length} speaker${identified.length === 1 ? '' : 's'}`
}
function progress(meeting: Meeting): { label: string; state: RailState }[] {
  // A saved reviewed transcript is the source of truth; the status text can lag behind it.
  const reviewed = !!meeting.transcriptPath
  const approved = meeting.outcomesStatus === 'approved'
  return [
    { label: 'Recorded', state: 'done' },
    { label: 'Transcript reviewed', state: reviewed ? 'done' : 'current' },
    { label: 'Outcomes approved', state: approved ? 'done' : reviewed ? 'current' : 'todo' },
  ]
}
function nextAction(meeting: Meeting): { label: string; tab: MeetingTab } {
  if (!meeting.transcriptPath) return { label: 'Review transcript', tab: 'transcript' }
  if (meeting.outcomesStatus !== 'approved') return { label: 'Review outcomes', tab: 'summary' }
  return { label: 'Open meeting', tab: 'summary' }
}
/** One avatar per meeting (first identified speaker), with a count when more people spoke. Keeps titles aligned. */
function LeadAvatar({ meeting }: { meeting: Meeting }) {
  const speakers = (meeting.turns ?? []).map(turn => turn.speaker)
  const order = speakerOrder(speakers)
  const identified = identifiedSpeakers(speakers, meeting.names)
  const first = identified[0]
  return <span className="hub-lead"><Avatar label={first ? speakerLabel(first, meeting.names, order) : 'Unknown speaker'} tone={first ? speakerTone(first, order) : 'neutral'} size={34} />
    {identified.length > 1 && <span className="hub-lead-count" aria-hidden="true">{identified.length}</span>}</span>
}

export function WorkspaceMemoryHub({ vaultPath, summary, onChanged, onStartMeeting, onReplayMeeting }: {
  vaultPath: string; summary?: WorkspaceSummary | null; onChanged?: () => void; onStartMeeting?: () => void; onReplayMeeting?: () => void
}) {
  const [view, setView] = useState<HubView | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [approved, setApproved] = useState<Approved[]>([])
  const [briefs, setBriefs] = useState<Brief[]>([])
  const [loaded, setLoaded] = useState<Partial<Record<HubView, boolean>>>({})
  const [meeting, setMeeting] = useState<(Meeting & { initialTab: MeetingTab; initialSeek?: number }) | null>(null)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [busy, setBusy] = useState(false)
  const [resuming, setResuming] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [askMode, setAskMode] = useState<AskMode>('ask')
  const [seed, setSeed] = useState<{ text: string; nonce: number } | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<Meeting | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const loadVersion = useRef(0)
  const load = useCallback(async (next: HubView) => {
    if (next !== 'meetings' && next !== 'approved' && next !== 'briefs') return
    const version = ++loadVersion.current
    setBusy(true); setError('')
    try {
      const result = next === 'meetings' ? await meetingService.list(vaultPath) : await invoke('wiki_memory', { request: { action: next, vaultPath } })
      if (version !== loadVersion.current) return
      if (!Array.isArray(result)) throw new Error('This view could not be loaded. Close it and try again.')
      if (next === 'meetings') setMeetings([...(result as Meeting[])].sort((a, b) => (b.created ?? '').localeCompare(a.created ?? '') || a.id.localeCompare(b.id)))
      if (next === 'approved') setApproved(result as Approved[])
      if (next === 'briefs') setBriefs([...(result as Brief[])].sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id)))
      setLoaded(previous => ({ ...previous, [next]: true }))
    } catch (failure) { if (version === loadVersion.current) setError(String(failure)) }
    finally { if (version === loadVersion.current) setBusy(false) }
  }, [vaultPath])
  function open(next: HubView) { if (next === view) return; ++loadVersion.current; setBusy(false); setError(''); setView(next); setSearch(''); setKind('all'); void load(next) }
  async function resume(id: string, tab: MeetingTab, at?: number) {
    setResuming(id); setError('')
    try {
      const current = await meetingService.get(vaultPath, id)
      if (!current.audioPath) throw new Error('This meeting has no recording to open. Use its document instead.')
      if (!current.draft) current.draft = await invoke<TranscriptDraft | undefined>('wiki_memory', { request: { action: 'meeting_draft', vaultPath, sessionId: id } })
      // Saved reviewed turns take precedence; an unreviewed (e.g. recovered) meeting keeps its draft's own segments.
      if (current.draft && current.turns?.length) current.draft.segments = current.turns
      if (current.draft) current.draft.speakerMatches = Object.fromEntries(Object.entries(current.names ?? {}).map(([speaker, name]) => [speaker, { id: current.profileIds?.[speaker] ?? '', name }]))
      setMeeting({ ...current, initialTab: tab, initialSeek: at })
    } catch (failure) { setError(String(failure)) }
    finally { setResuming(null) }
  }
  const text = search.trim().toLowerCase()
  async function deleteMeeting() {
    if (!deleteTarget || deleting) return
    setDeleting(true); setDeleteError('')
    try {
      await meetingService.delete(vaultPath, deleteTarget.id)
      setMeetings(previous => previous.filter(item => item.id !== deleteTarget.id))
      setDeleteTarget(null)
      await load('meetings'); onChanged?.()
    } catch (failure) { setDeleteError(String(failure)) }
    finally { setDeleting(false) }
  }
  const matches = (value: string) => value.toLowerCase().includes(text)
  const shownMeetings = meetings.filter(item => matches(`${item.title} ${participants(item)}`))
  const kinds = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of approved) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [approved])
  const groups = useMemo(() => {
    const byPage = new Map<string, Approved[]>()
    for (const item of approved) {
      if ((kind !== 'all' && item.kind !== kind) || !`${item.pageTitle ?? ''} ${item.title} ${item.statement} ${item.sourceTitle}`.toLowerCase().includes(text)) continue
      byPage.set(item.knowledgePath, [...(byPage.get(item.knowledgePath) ?? []), item])
    }
    return [...byPage.values()]
  }, [approved, kind, text])
  const changed = approved.filter(item => item.status === 'needs-review').length
  const count = (known: number | undefined, fallback: number, ready?: boolean) => known ?? (ready ? fallback : undefined)
  const tabs = [
    { value: 'meetings', label: 'Meetings', count: count(summary?.meetings, meetings.length, loaded.meetings) },
    { value: 'search', label: 'Search' },
    { value: 'ask', label: 'Ask' },
    { value: 'approved', label: 'Approved', count: count(summary?.approved, approved.length, loaded.approved), attention: (summary?.sourceChanged ?? changed) > 0 },
    { value: 'briefs', label: 'Briefs', count: count(summary?.briefs, briefs.length, loaded.briefs) },
    { value: 'facts', label: 'Tracked facts' },
  ]
  const row = (icon: ReactNode, label: string, target: HubView, value?: number, attention = false) => <Button variant="ghost" className="workspace-row" onClick={() => open(target)}>
    {icon}<span>{label}</span>{!!value && <span className="workspace-row-count" data-attention={attention || undefined}>{value}</span>}
  </Button>
  const openPage = (path: string, title: string) => { void openNoteInNewWindow(`${vaultPath}/${path}`, vaultPath, title).catch(failure => setError(String(failure))) }
  const openMoment = (id: string, at: number) => { void resume(id, 'transcript', at) }
  const current = view ?? 'meetings'
  return <>
    <nav className="memory-hub-navigation" aria-label="Meeting memory">
      <p className="workspace-group-label">Memory</p>
      {row(<Waveform size={16} />, 'Meetings', 'meetings', summary?.meetings)}
      {row(<MagnifyingGlass size={16} />, 'Search', 'search')}
      {row(<Quotes size={16} />, 'Ask', 'ask')}
      {row(<SealCheck size={16} />, 'All approved', 'approved', summary?.approved, (summary?.sourceChanged ?? 0) > 0)}
      {row(<FileText size={16} />, 'Briefs', 'briefs', summary?.briefs)}
      {row(<SealCheck size={16} />, 'Tracked facts', 'facts')}
    </nav>
    <Dialog open={!!view && !meeting} onOpenChange={value => { if (!value) setView(null) }}>
      <DialogContent className="hub-dialog" onOpenAutoFocus={event => event.preventDefault()}>
        <DialogTitle className="sr-only">Meeting memory</DialogTitle>
        <DialogDescription className="sr-only">Meetings, search, questions, approved knowledge and saved briefs.</DialogDescription>
        <PillTabsRoot value={current} onValueChange={value => open(value as HubView)} className="hub-root">
          <header className="hub-header">
            <PillTabList label="Memory sections" value={current} tabs={tabs} onSelect={value => open(value as HubView)} />
            {(view === 'meetings' || view === 'approved') && <label className="hub-search"><MagnifyingGlass size={14} aria-hidden="true" />
              <input aria-label={view === 'approved' ? 'Search approved knowledge' : 'Search meetings'} placeholder={view === 'approved' ? 'Filter claims and sources' : 'Filter meetings and people'} value={search} onChange={event => setSearch(event.target.value)} /></label>}
          </header>
          {error && <p role="alert" className="hub-error">{error}</p>}
          <div className="hub-page-heading" hidden={current === 'facts'}>
            <div><h1>{tabs.find(item => item.value === current)?.label}</h1>
              <p>{current === 'meetings' ? 'Your recordings and reviewed outcomes' : current === 'search' ? 'Find a statement and return to its source' : current === 'ask' ? 'Answers from knowledge you have approved' : current === 'approved' ? 'Accepted claims with their original evidence' : 'Context for your next conversation'}</p></div>
            {current === 'meetings' && <div className="flex gap-2">
              {onReplayMeeting && <Button size="sm" variant="outline" onClick={() => { setView(null); onReplayMeeting() }}>Replay audio test</Button>}
              {meetings.length > 0 && onStartMeeting && <Button size="sm" onClick={() => { setView(null); onStartMeeting() }}><Microphone size={16} />Start meeting</Button>}
            </div>}
          </div>
          <div className="hub-body" data-view={current}>
            {busy && !loaded[current] && <p role="status" className="hub-loading">Loading {current === 'approved' ? 'approved knowledge' : current}…</p>}
            <PillTabPanel value="meetings">
              <RecordingRecovery vaultPath={vaultPath} active={current === 'meetings' && !!view} onRecovered={record => { void resume(record.id, 'transcript'); void load('meetings'); onChanged?.() }} />
              {shownMeetings.map(item => {
                const next = nextAction(item)
                return <article key={item.id} className="hub-meeting">
                  <LeadAvatar meeting={item} />
                  <div className="hub-meeting-main">
                    <h3 title={item.title}>{item.title}</h3>
                    <p className="hub-meta">{[whenLabel(item.created), item.draft?.duration ? clock(item.draft.duration) : '', participants(item)].filter(Boolean).join(' · ')}</p>
                    <LifecycleRail label="Meeting progress" steps={progress(item)} />
                  </div>
                  <div className="hub-meeting-actions">
                    <Button size="sm" variant={next.label === 'Open meeting' ? 'outline' : 'default'} disabled={resuming === item.id} onClick={() => { void resume(item.id, next.tab) }}>{resuming === item.id ? 'Opening…' : next.label}</Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Open document for ${item.title}`} title="Open meeting document" onClick={() => openPage(item.pagePath, item.title)}><ArrowSquareOut size={15} /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete meeting ${item.title}`} title="Delete meeting" onClick={() => { setDeleteError(''); setDeleteTarget(item) }}><Trash size={16} /></Button>
                  </div>
                </article>
              })}
              {!busy && loaded.meetings && !meetings.length && <EmptyState icon={<Microphone size={20} />} title="No meetings yet" action={onStartMeeting && <Button onClick={() => { setView(null); onStartMeeting() }}>Start meeting</Button>}>Recordings, reviewed transcripts and approved outcomes appear here after you end a meeting.</EmptyState>}
              {!busy && !!meetings.length && !shownMeetings.length && <p className="hub-muted">No meetings match “{search}”.</p>}
            </PillTabPanel>
            <PillTabPanel value="facts"><TemporalMemoryPanel vaultPath={vaultPath} /></PillTabPanel>
            <PillTabPanel value="search" forceMount hidden={view !== 'search'}>
              <MemorySearch vaultPath={vaultPath} active={view === 'search'} onOpenMoment={openMoment} onOpenPage={openPage} />
            </PillTabPanel>
            <PillTabPanel value="ask" forceMount hidden={view !== 'ask'} className="hub-ask">
              <MemoryAsk vaultPath={vaultPath} active={view === 'ask'} mode={askMode} onModeChange={setAskMode} seed={seed} onOpenMoment={openMoment} onSaved={() => { void load('briefs'); onChanged?.() }} />
            </PillTabPanel>
            <PillTabPanel value="approved">
              {!!approved.length && <div className="hub-sticky">
                <div role="group" aria-label="Knowledge type" className="hub-filters">
                  <button type="button" className="hub-filter" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>All <span>{approved.length}</span></button>
                  {kinds.map(([name, total]) => <button key={name} type="button" className="hub-filter" aria-pressed={kind === name} onClick={() => setKind(name)}>{name} <span>{total}</span></button>)}
                </div>
              </div>}
              {groups.map(items => <section key={items[0].knowledgePath} className="hub-page">
                <header>
                  <h3>{items[0].pageTitle || items[0].title}</h3>
                  <Chip tone={kindTone(items[0].kind)}>{items[0].kind}</Chip>
                  <Button size="icon-sm" variant="ghost" className="hub-page-open" aria-label={`Open knowledge page ${items[0].pageTitle || items[0].title}`} title="Open knowledge page" onClick={() => openPage(items[0].knowledgePath, items[0].pageTitle || items[0].title)}><ArrowSquareOut size={15} /></Button>
                </header>
                <ul className="hub-claims">
                  {items.map(item => <li key={item.id} className="hub-claim">
                    <p>{item.statement}</p>
                    <div className="hub-claim-meta">
                      {item.moment?.at != null && <button type="button" className="hub-moment" aria-label={`Open ${item.moment.meetingTitle} at ${clock(item.moment.at)}`} onClick={() => openMoment(item.moment!.meetingId, item.moment!.at!)}>{item.moment.meetingTitle} · {clock(item.moment.at)}</button>}
                      {item.status === 'needs-review' && <Chip tone="orange" dot title="The source file changed after approval. Re-review before relying on this claim.">Source changed — needs review</Chip>}
                      {item.approvedAt && <span>Approved {whenLabel(item.approvedAt)}</span>}
                    </div>
                    <details><summary>Source · {item.sourceTitle} · page {item.page}</summary>
                      <blockquote>{item.quote}</blockquote>
                      <Button size="sm" variant="ghost" onClick={() => openPage(item.sourcePath, item.sourceTitle)}><ArrowSquareOut size={13} />Open source</Button>
                    </details>
                  </li>)}
                </ul>
              </section>)}
              {!busy && loaded.approved && !approved.length && <EmptyState icon={<SealCheck size={20} />} title="Nothing approved yet">Approve suggestions from a meeting or an imported document. They are listed here with their exact source quote.</EmptyState>}
              {!busy && !!approved.length && !groups.length && <p className="hub-muted">No approved claims match this filter.</p>}
            </PillTabPanel>
            <PillTabPanel value="briefs" className="hub-briefs">
              <section className="hub-saved">
                <div className="hub-saved-head"><SectionLabel>Saved briefs{loaded.briefs ? ` · ${briefs.length}` : ''}</SectionLabel>
                  <Button size="sm" onClick={() => { setAskMode('brief'); open('ask') }}>New brief</Button></div>
                {briefs.map(item => <article key={item.id} className="hub-brief">
                  <FileText size={18} aria-hidden="true" />
                  <div><h3>{item.topic}</h3><p className="hub-meta">{dayLabel(item.created)} · {whenLabel(item.created).split(', ').pop()}</p></div>
                  <Button size="sm" variant="outline" onClick={() => openPage(item.pagePath, `Brief — ${item.topic}`)}>Open saved brief</Button>
                </article>)}
                {loaded.briefs && !briefs.length && <EmptyState icon={<FileText size={20} />} title="No saved briefs yet" action={<Button onClick={() => { setAskMode('brief'); open('ask') }}>Create a brief</Button>}>A brief is a cited document for your next meeting, built only from approved knowledge.</EmptyState>}
              </section>
            </PillTabPanel>
          </div>
          <footer className="hub-footer">
            <span>{busy && !loaded[current] ? 'Loading…' : view === 'approved'
              ? `${plural(approved.length, 'approved claim')} across ${plural(new Set(approved.map(item => item.knowledgePath)).size, 'page')}${changed ? ` · ${changed} ${changed === 1 ? 'needs' : 'need'} review` : ''}`
               : view === 'facts' ? 'Tracked values and their evidence history' : view === 'briefs' ? plural(briefs.length, 'saved brief') : view === 'search' ? 'Keyword search over saved transcripts and approved claims' : view === 'ask' ? 'Answers use approved knowledge only' : plural(meetings.length, 'meeting')}</span>
            <Button variant="ghost" onClick={() => setView(null)}>Done</Button>
          </footer>
        </PillTabsRoot>
      </DialogContent>
    </Dialog>
    <Dialog open={!!meeting} onOpenChange={value => { if (!value) setMeeting(null) }}><DialogContent className="memory-hub-meeting" showCloseButton={false} onOpenAutoFocus={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}><DialogTitle className="sr-only">Meeting record</DialogTitle><DialogDescription className="sr-only">Transcript, summary and questions for one meeting.</DialogDescription>{meeting && <MeetingTranscriptReview key={`${meeting.id}-${meeting.initialSeek ?? ''}`} vaultPath={vaultPath} sessionId={meeting.id} originalPath={`${vaultPath}/${meeting.audioPath}`} title={meeting.title} created={meeting.created} draggable={false} initialDraft={meeting.draft} initialMarks={meeting.marks} transcriptPath={meeting.transcriptPath ?? undefined} outcomesStatus={meeting.outcomesStatus} initialTab={meeting.initialTab} initialSeek={meeting.initialSeek}
      onBrief={topic => { setMeeting(null); setAskMode('brief'); setSeed({ text: topic, nonce: Date.now() }); setView('ask') }}
      onClose={async () => { setMeeting(null); await load('meetings'); onChanged?.() }} />}</DialogContent></Dialog>
    <Dialog open={!!deleteTarget} onOpenChange={value => { if (!value && !deleting) setDeleteTarget(null) }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!deleting}>
        <DialogTitle>Delete meeting?</DialogTitle>
        <DialogDescription>Remove “{deleteTarget?.title}” from Meetings and delete its generated meeting document. Original audio, sources, and approved knowledge are kept.</DialogDescription>
        {deleteError && <p role="alert" className="hub-error">{deleteError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="destructive" disabled={deleting} onClick={() => { void deleteMeeting() }}>{deleting ? 'Deleting…' : 'Delete meeting'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>
}
