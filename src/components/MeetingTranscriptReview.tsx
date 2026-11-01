import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { CaretUpDown, ListChecks, Warning, X } from '@phosphor-icons/react'
import { Button } from './ui/button'
import { startMemoryJob } from '../lib/memoryJob'
import { applySource, type PreparedSource } from '../lib/sourceImport'
import { announceMemoryChanged } from '../hooks/useWorkspaceSummary'
import { clock, speakerLabel, speakerOrder, speakerTone } from '../lib/speakers'
import { Avatar, Chip, EmptyState, PillTabList, PillTabPanel, PillTabsRoot, SectionLabel, StateButton } from './memoriaUi'
import { MeetingPlayer, type PlayerHandle } from './MeetingPlayer'
import { MeetingSummary, type Mark } from './MeetingSummary'
import { MemoryAsk } from './MemoryAsk'
import './meetingReview.css'

interface Turn { start: number; end: number; speaker: string; text: string }
interface Profile { id: string; name: string }
export interface TranscriptDraft {
  gaps?: { start: number; end: number; reason: string }[]
  segments: Turn[]; duration: number; warnings: string[]; text: string
  profiles?: Profile[]
  speakerMatches?: Record<string, Profile>
}
export type MeetingTab = 'transcript' | 'summary' | 'ask'

/** Collapsible metadata block: open when it needs attention, folded away when it does not. */
function Fold({ title, count, defaultOpen, aside, children }: { title: string; count: number; defaultOpen: boolean; aside?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return <details className="review-fold" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span className="mui-label">{title} · {count}</span>{!open && aside}</summary>{children}
  </details>
}

const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function MeetingTranscriptReview({ vaultPath, sessionId, originalPath, title, created, liveText = '', initialDraft = null, transcriptPath, outcomesStatus, initialTab = 'transcript', initialSeek, initialMarks, draggable = true, onBrief, onClose }: {
  vaultPath: string; sessionId: string; originalPath: string; title: string; created?: string; liveText?: string; initialDraft?: TranscriptDraft | null; transcriptPath?: string
  outcomesStatus?: 'approved' | 'needs-review' | 'not-built'; initialTab?: MeetingTab; initialSeek?: number; initialMarks?: Mark[]
  /** The HUD review window is dragged by its header; the workspace dialog is not. */
  draggable?: boolean
  /** Offered only where the briefs view exists (the workspace, not the HUD window). */
  onBrief?: (topic: string) => void
  onClose: () => Promise<void>
}) {
  const [draft, setDraft] = useState<TranscriptDraft | null>(() => initialDraft ?? (liveText.trim() ? { segments: [], duration: 0, warnings: ['Live draft: no verified speaker labels or word timestamps.'], text: liveText } : null))
  const [turns, setTurns] = useState<Turn[]>(() => initialDraft?.segments ?? (liveText.trim() ? [{ start: 0, end: 0, speaker: 'unassigned', text: liveText }] : []))
  const [refined, setRefined] = useState(!!initialDraft)
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialDraft?.speakerMatches ?? {}).map(([speaker, profile]) => [speaker, profile.name])))
  const [profileIds, setProfileIds] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialDraft?.speakerMatches ?? {}).map(([speaker, profile]) => [speaker, profile.id])))
  const [marks, setMarks] = useState<Mark[]>(() => initialMarks ?? [])
  const [remember, setRemember] = useState(true)
  const [name, setName] = useState(title)
  const [notice, setNotice] = useState(() => initialDraft ? '' : liveText.trim() ? 'Your live transcript is ready to review. Refinement is optional.' : 'Recording saved. Create a transcript when you are ready.')
  const [stage, setStage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [time, setTime] = useState(initialSeek ?? 0)
  const [playing, setPlaying] = useState(false)
  const cancel = useRef<(() => Promise<void>) | null>(null)
  const publication = useRef<PreparedSource | null>(null)
  const profilesSaved = useRef(false)
  const player = useRef<PlayerHandle>(null)
  const rows = useRef<(HTMLElement | null)[]>([])
  const [outcomeSource, setOutcomeSource] = useState<string | null>(transcriptPath ?? null)
  // A build starts only for a transcript saved in this session; resumed meetings just list saved outcomes.
  const [buildNow, setBuildNow] = useState(false)
  const [tab, setTab] = useState<MeetingTab>(() => initialTab !== 'transcript' && transcriptPath ? initialTab : 'transcript')
  const meetingTitle = name.trim() || title
  const audioUrl = convertFileSrc(originalPath)
  useEffect(() => { if (initialSeek !== undefined) player.current?.seek(initialSeek, false) }, [initialSeek])

  async function persistReview(reviewedPath = outcomeSource) {
    return invoke('wiki_memory', { request: { action: 'save_meeting', vaultPath, record: {
      id: sessionId, title: meetingTitle, status: reviewedPath ? 'transcript-reviewed' : 'needs-review',
      audioPath: originalPath.slice(vaultPath.replace(/\/$/, '').length + 1), turns, names,
      draft: draft ? { ...draft, segments: turns } : null, profileIds,
      marks: marks.map(mark => ({ ...(mark.id ? { id: mark.id } : {}), at: mark.at, label: mark.label })),
      transcriptPath: reviewedPath,
    } } })
  }
  async function closeReview() {
    setBusy(true); setError('')
    try { await persistReview(); announceMemoryChanged(); await onClose() }
    catch (failure) { setError(String(failure)); setBusy(false) }
  }
  function invalidate() { publication.current = null; setOutcomeSource(null); setBuildNow(false); setTab('transcript') }
  function seekTo(at: number) { setTab('transcript'); window.setTimeout(() => player.current?.seek(at), 0) }

  async function transcribe() {
    setBusy(true); setError(''); setNotice(''); setStage('Refining words and speakers locally…')
    const job = startMemoryJob<TranscriptDraft>({ action: 'transcribe', vaultPath, sessionId, audioPath: originalPath }, setStage)
    cancel.current = job.cancel
    try {
      const result = await job.promise
      setDraft(result); setTurns(result.segments); setRefined(true)
      publication.current = null; profilesSaved.current = false; setOutcomeSource(null); setBuildNow(false)
      setNames(Object.fromEntries(Object.entries(result.speakerMatches ?? {}).map(([speaker, profile]) => [speaker, profile.name])))
      setProfileIds(Object.fromEntries(Object.entries(result.speakerMatches ?? {}).map(([speaker, profile]) => [speaker, profile.id])))
      setNotice(result.segments.length ? 'Your transcript is ready. Name speakers once; all their lines update.' : 'No readable speech detected.')
    } catch (failure) { setError(String(failure)); setNotice('Your original recording is saved.') }
    finally { setBusy(false); cancel.current = null }
  }

  async function save() {
    setBusy(true); setError(''); setNotice('')
    try {
      if (refined && remember && !profilesSaved.current) {
        // Remembering voices is optional: a failure here must never block saving the evidence.
        try {
          const result = await invoke<{ skipped: string[] }>('wiki_memory', { request: { action: 'save_voice_profiles', vaultPath, sessionId,
            assignments: Object.entries(names).filter(([, value]) => value.trim()).map(([speaker, value]) => ({ speaker, name: value, profileId: profileIds[speaker] })) } })
          profilesSaved.current = true
          if (result.skipped.length) setNotice('Some voices had too little clean speech to remember. Their names are still saved in this transcript.')
        } catch (failure) {
          setError(`Voice memory could not be saved: ${String(failure)}. Transcript saving can continue.`)
        }
      }
      const order = speakerOrder(turns.map(turn => turn.speaker))
      const text = turns.map(turn => refined ? `[${clock(turn.start)}] ${speakerLabel(turn.speaker, names, order)}: ${turn.text}` : turn.text).join('\n\n')
      const bytes = new TextEncoder().encode(text)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const relative = originalPath.slice(vaultPath.replace(/\/$/, '').length + 1)
      publication.current ??= { id: crypto.randomUUID(), title: `${meetingTitle} — reviewed transcript`, filename: `transcript-${sessionId}.txt`, bytes,
        sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
        pages: [`[Listen to meeting audio](<${relative}>)\n\nReviewed by the user. ${refined ? 'Draft generated with MOSS-Transcribe-Diarize and edited in review; speaker labels and audio-clock timestamps remain approximate.' : 'Live draft edited in review; no verified speaker labels or timestamps.'}\n\n${text}`] }
      const path = await applySource(publication.current, vaultPath)
      await persistReview(path)
      announceMemoryChanged()
      setOutcomeSource(path); setBuildNow(true); setTab('summary')
    } catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }

  const speakers = [...new Set(turns.map(turn => turn.speaker))]
  const order = speakerOrder(speakers)
  const words = (speaker: string) => turns.filter(turn => turn.speaker === speaker).reduce((total, turn) => total + (turn.text.trim() ? turn.text.trim().split(/\s+/).length : 0), 0)
  const totalWords = speakers.reduce((total, speaker) => total + words(speaker), 0) || 1
  const reviewed = !!outcomeSource
  const active = useMemo(() => {
    if (!refined || (!playing && time <= 0)) return -1
    let index = -1
    turns.forEach((turn, position) => { if (turn.start <= time + 0.05) index = position })
    return index
  }, [turns, time, playing, refined])
  useEffect(() => { if (playing && active >= 0) rows.current[active]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }, [active, playing])
  const startedAt = created && !Number.isNaN(new Date(created).getTime()) ? longDate.format(new Date(created)) : ''
  const meta = [startedAt, draft?.duration ? clock(draft.duration) : '', refined ? `${order.length || 'No'} identified speaker${order.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
  const fallbackLength = Math.max(draft?.duration ?? 0, turns.length ? turns[turns.length - 1].end : 0)

  return <PillTabsRoot value={tab} onValueChange={value => setTab(value as MeetingTab)} className="meeting-review" asChild>
    <main>
      <header className="review-header" onMouseDown={event => { if (draggable && event.button === 0 && !(event.target as HTMLElement).closest('input, button, select, textarea')) void getCurrentWindow().startDragging() }}>
        <div className="review-heading">
          <p className="review-eyebrow">{reviewed ? 'Reviewed meeting' : 'Meeting ended'}</p>
          <h1 className="sr-only">Review transcript</h1>
          <input className="review-title" aria-label="Meeting title" value={name} maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} onBlur={() => { if (!name.trim()) setName(title) }} />
          {meta && <p className="review-meta">{meta}</p>}
        </div>
        <Button variant="ghost" disabled={busy} onClick={() => { void closeReview() }}>Save & close</Button>
      </header>
      <div className="review-tabbar">
        <PillTabList label="Meeting sections" value={tab} onSelect={value => setTab(value as MeetingTab)} tabs={[
          { value: 'transcript', label: 'Transcript' },
          { value: 'summary', label: 'Summary', disabled: !reviewed, attention: reviewed && outcomesStatus === 'needs-review' },
          { value: 'ask', label: 'Ask', disabled: !reviewed },
        ]} />
        <Chip tone={reviewed ? 'green' : 'orange'} dot>{reviewed ? 'Transcript reviewed' : 'Draft — check before saving'}</Chip>
      </div>

      {error && <p role="alert" className="review-global-error">{error}</p>}

      <PillTabPanel value="transcript" className="review-body">
        {notice && !busy && <p role="status" className="review-status">{notice}</p>}
        {busy && cancel.current && <div className="review-processing"><p role="status">{stage}</p><Button variant="outline" size="sm" onClick={() => { void cancel.current?.() }}>Cancel processing</Button></div>}
        {marks.length > 0 && <section className="review-marks" aria-label="Marked moments"><Fold title="Marked moments" count={marks.length} defaultOpen={false}>
          {marks.map((mark, index) => <div key={mark.id ?? `${mark.at}-${index}`} className="review-mark">
            <button type="button" className="review-time" aria-label={`Play from ${clock(mark.at)}`} onClick={() => player.current?.seek(mark.at)}>{clock(mark.at)}</button>
            <input aria-label={`Label for moment at ${clock(mark.at)}`} placeholder="Add a label" value={mark.label} maxLength={120} disabled={busy}
              onChange={event => setMarks(previous => previous.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} />
            <Button variant="ghost" size="icon-sm" aria-label={`Remove moment at ${clock(mark.at)}`} onClick={() => setMarks(previous => previous.filter((_, position) => position !== index))}><X size={14} /></Button>
          </div>)}
        </Fold></section>}
        {!draft && <EmptyState icon={<ListChecks size={20} />} title={busy ? 'Preparing your transcript' : 'Your recording is saved'}>{busy ? 'You can keep working in the workspace while this finishes.' : 'No live transcript is available. You can create one from the saved audio.'}</EmptyState>}
        {!busy && !refined && <div className="review-actions"><Button variant="outline" onClick={() => { void transcribe() }}>{draft ? 'Refine transcript and speakers' : 'Create transcript'}</Button></div>}
        {draft && <>
          {!!draft.gaps?.length && <div role="alert" className="review-notice" data-tone="warn"><Warning size={16} aria-hidden="true" /><div><p><strong>{draft.gaps.length} passage needs audio review</strong></p>{draft.gaps.map(gap => <p key={gap.start}>{clock(gap.start)}–{clock(gap.end)} · No transcript was accepted for this interval.</p>)}</div></div>}
          {refined && speakers.length > 0 && <section className="review-speakers" aria-label="Meeting speakers">
            <Fold title="Speakers" count={speakers.length} defaultOpen={speakers.some(speaker => !names[speaker]?.trim())}
              aside={<span className="review-fold-avatars">{speakers.map(speaker => <Avatar key={speaker} label={speakerLabel(speaker, names, order)} tone={speakerTone(speaker, order)} size={22} />)}</span>}>
            <div className="review-section-head"><span />
              <label className="review-remember"><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)} />Remember named voices in this workspace</label></div>
            {speakers.map(speaker => {
              const share = Math.round(words(speaker) / totalWords * 100)
              return <div key={speaker} className="review-speaker" data-tone={speakerTone(speaker, order)}>
                <Avatar label={speakerLabel(speaker, names, order)} tone={speakerTone(speaker, order)} size={30} />
                <div className="review-speaker-fields">
                  <label htmlFor={`speaker-${speaker}`} className="sr-only">{speakerLabel(speaker, undefined, order)}</label>
                  <select id={`speaker-${speaker}`} aria-label={`Name ${speaker}`} disabled={busy}
                    value={profileIds[speaker] || (names[speaker] ? 'new' : '')} onChange={event => {
                      const profile = draft.profiles?.find(candidate => candidate.id === event.target.value)
                      setProfileIds(previous => ({ ...previous, [speaker]: profile?.id ?? '' }))
                      setNames(previous => ({ ...previous, [speaker]: profile?.name ?? '' }))
                      profilesSaved.current = false; invalidate()
                      if (event.target.value === 'new') setNames(previous => ({ ...previous, [speaker]: ' ' }))
                    }}>
                    <option value="">{speakerLabel(speaker, undefined, order)} · not named yet</option>
                    {draft.profiles?.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    <option value="new">Add a name…</option>
                  </select>
                  {names[speaker] && !profileIds[speaker] && <input aria-label={`New name for ${speaker}`} placeholder="Speaker name" value={names[speaker].trimStart()} maxLength={100} disabled={busy}
                    onChange={event => { setNames(previous => ({ ...previous, [speaker]: event.target.value || ' ' })); profilesSaved.current = false; invalidate() }} />}
                </div>
                <span className="review-share-bar" aria-hidden="true"><i style={{ width: `${share}%` }} /></span>
                <span className="review-share">{share}%</span>
              </div>
            })}
            </Fold>
          </section>}
          <SectionLabel className="review-transcript-label">Transcript</SectionLabel>
          {turns.length === 0 && <p className="review-status">No readable speech was detected. Listen to the recording to check the audio.</p>}
          <div className="review-turns">{turns.map((turn, index) => <article key={index} ref={element => { rows.current[index] = element }} className="review-turn" data-active={active === index || undefined} data-tone={speakerTone(turn.speaker, order)}>
            <Avatar label={speakerLabel(turn.speaker, names, order)} tone={speakerTone(turn.speaker, order)} size={32} />
            <div className="review-turn-body">
              <div className="review-turn-head">
                {refined ? <label className="review-turn-speaker"><span className="sr-only">Speaker for turn {index + 1}</span>
                  <select aria-label={`Speaker for turn ${index + 1}`} disabled={busy} value={turn.speaker} onChange={event => {
                    setTurns(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, speaker: event.target.value } : item)); invalidate()
                  }}>{speakers.map(speaker => <option key={speaker} value={speaker}>{speakerLabel(speaker, names, order)}</option>)}</select>
                  <CaretUpDown size={11} aria-hidden="true" /></label> : <strong className="review-turn-speaker">Live transcript</strong>}
                {refined && <button type="button" className="review-time" aria-label={`Play from ${clock(turn.start)}`} onClick={() => player.current?.seek(turn.start)}>{clock(turn.start)}</button>}
              </div>
              <textarea aria-label={`Transcript turn ${index + 1}`} value={turn.text} rows={Math.max(1, Math.ceil(turn.text.length / 88) + (turn.text.match(/\n/g)?.length ?? 0))} disabled={busy} onChange={event => {
                setTurns(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item)); invalidate()
              }} />
            </div>
          </article>)}</div>
          <details className="review-details"><summary>Transcript details</summary>{draft.warnings.map(warning => <p key={warning}>{warning}</p>)}<p>Voice matches are suggestions. Unknown and ambiguous voices stay unnamed.</p></details>
        </>}
      </PillTabPanel>

      <PillTabPanel value="summary" className="review-body review-summary">
        <MeetingSummary vaultPath={vaultPath} sourcePath={outcomeSource} title={meetingTitle} turns={turns} names={names} marks={marks} buildNow={buildNow} onSeek={seekTo} onBrief={onBrief} />
      </PillTabPanel>
      <PillTabPanel value="ask" forceMount hidden={tab !== 'ask'} className="review-ask">
        {reviewed
          ? <MemoryAsk vaultPath={vaultPath} scope={outcomeSource ? [outcomeSource] : undefined} placeholder="Ask about this meeting…" onOpenMoment={(_, at) => seekTo(at)} />
          : <EmptyState icon={<ListChecks size={20} />} title="Review the transcript first">Questions are answered from approved knowledge, so save the reviewed transcript and approve its outcomes first.</EmptyState>}
      </PillTabPanel>

      <footer className="review-footer" hidden={tab !== 'transcript'}>
        <MeetingPlayer ref={player} src={audioUrl} fallbackDuration={fallbackLength} marks={marks} showControls={tab === 'transcript'}
          onTime={(next, isPlaying) => { setTime(next); setPlaying(isPlaying) }}
          onMark={refined || marks.length ? () => setMarks(previous => [...previous, { at: Math.round(time * 10) / 10, label: '' }].sort((a, b) => a.at - b.at)) : undefined}
          onOpenAudio={() => { void invoke('open_vault_file_external', { path: originalPath, vaultPath }).catch(failure => setError(String(failure))) }} />
        {reviewed
          ? <Button variant="outline" onClick={() => setTab('summary')}>Open summary</Button>
          : <StateButton status={busy && !cancel.current ? 'working' : 'idle'} disabled={busy || !turns.some(turn => turn.text.trim())} labels={{ idle: 'Save reviewed transcript', working: 'Saving…', done: 'Saved' }} onClick={() => { void save() }} />}
      </footer>
    </main>
  </PillTabsRoot>
}
