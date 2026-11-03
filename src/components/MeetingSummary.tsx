import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ListChecks } from '@phosphor-icons/react'
import { Avatar, Chip, EmptyState, SectionLabel } from './memoriaUi'
import { MemoryReview } from './MemoryReview'
import { Button } from './ui/button'
import { MEMORY_CHANGED_EVENT } from '../hooks/useWorkspaceSummary'
import { kindTone } from '../lib/knowledgeKinds'
import { clock, speakerLabel, speakerOrder, speakerTone } from '../lib/speakers'
import { plural } from '../lib/format'
import { openNoteInNewWindow } from '../utils/openNoteWindow'
import './meetingSummary.css'

interface Turn { start: number; end: number; speaker: string; text: string }
export interface Mark { id?: string; at: number; label: string }
interface Claim {
  id: string; title: string; kind: string; statement: string; quote: string; sourcePath: string; sourceTitle: string; page: number
  pageTitle?: string; status: string; moment?: { meetingId: string; meetingTitle: string; at: number | null } | null
}
const SECTIONS = [
  { kind: 'Decision', heading: 'Decisions', one: 'decision', many: 'decisions' },
  { kind: 'Commitment', heading: 'Commitments', one: 'commitment', many: 'commitments' },
  { kind: 'Project', heading: 'Projects', one: 'project', many: 'projects' },
  { kind: 'Person', heading: 'People', one: 'person', many: 'people' },
  { kind: 'Organization', heading: 'Organizations', one: 'organization', many: 'organizations' },
  { kind: 'Topic', heading: 'Topics', one: 'topic', many: 'topics' },
  { kind: 'Meeting', heading: 'Meetings', one: 'meeting note', many: 'meeting notes' },
]

export function MeetingSummary({ vaultPath, sourcePath, title, turns, names, marks, buildNow, decisionsOnBoard = 0, onSeek, onBrief }: {
  vaultPath: string; sourcePath: string | null; title: string; turns: Turn[]; names: Record<string, string>; marks: Mark[]
  /** True right after the transcript was saved in this session: start building outcomes. */
  buildNow: boolean
  /** Approved values on the decision board that this meeting's words set. */
  decisionsOnBoard?: number
  onSeek: (at: number) => void
  /** Offered only where the briefs view exists. */
  onBrief?: (topic: string) => void
}) {
  const [data, setData] = useState<{ claims: Claim[]; pending: number } | null>(null)
  const [error, setError] = useState('')
  const [forced, setForced] = useState<'build' | 'history' | null>(null)
  const [sawPending, setSawPending] = useState(false)
  const load = useCallback(async () => {
    if (!sourcePath) return
    try {
      const [claims, proposals] = await Promise.all([
        invoke<Claim[]>('wiki_memory', { request: { action: 'approved', vaultPath } }),
        invoke<{ sourcePath: string; status?: string }[]>('wiki_memory', { request: { action: 'list', vaultPath } }),
      ])
      const pending = Array.isArray(proposals) ? proposals.filter(proposal => proposal.sourcePath === sourcePath && proposal.status === 'pending').length : 0
      setData({ claims: Array.isArray(claims) ? claims.filter(claim => claim.sourcePath === sourcePath) : [], pending })
      if (pending) setSawPending(true)
      setError('')
    } catch (failure) { setError(String(failure)) }
  }, [vaultPath, sourcePath])
  useEffect(() => {
    const update = () => { void load() }
    update()
    window.addEventListener(MEMORY_CHANGED_EVENT, update)
    return () => window.removeEventListener(MEMORY_CHANGED_EVENT, update)
  }, [load])
  const order = useMemo(() => speakerOrder(turns.map(turn => turn.speaker)), [turns])
  const claims = useMemo(() => data?.claims ?? [], [data])
  const moments = useMemo(() => {
    // One row per second: the user's own mark wins; outcomes said at the same moment are counted, not repeated.
    const rows = new Map<number, { at: number; label: string; extra: number; tone: ReturnType<typeof kindTone> }>()
    const add = (at: number, label: string, tone: ReturnType<typeof kindTone>) => {
      const key = Math.round(at)
      const row = rows.get(key)
      if (row) row.extra += 1; else rows.set(key, { at, label, extra: 0, tone })
    }
    marks.forEach(mark => add(mark.at, mark.label || 'Marked moment', 'orange'))
    claims.forEach(claim => { if (claim.moment?.at != null) add(claim.moment.at, claim.pageTitle || claim.title, kindTone(claim.kind)) })
    return [...rows.values()].sort((a, b) => a.at - b.at).slice(0, 8).map(row => ({ ...row, label: row.extra ? `${row.label} +${row.extra}` : row.label }))
  }, [marks, claims])
  const share = useMemo(() => {
    const words = new Map<string, number>()
    for (const turn of turns) words.set(turn.speaker, (words.get(turn.speaker) ?? 0) + (turn.text.trim() ? turn.text.trim().split(/\s+/).length : 0))
    const total = [...words.values()].reduce((sum, value) => sum + value, 0) || 1
    return [...words].map(([speaker, count]) => ({ speaker, label: speakerLabel(speaker, names, order), percent: Math.round(count / total * 100) })).sort((a, b) => b.percent - a.percent)
  }, [turns, names, order])

  if (!sourcePath) return <EmptyState icon={<ListChecks size={20} />} title="Review the transcript first">Save the reviewed transcript and Memoria will propose decisions, commitments and people for you to approve.</EmptyState>
  const reviewing = forced !== null || !!data?.pending || (buildNow && !sawPending)
  if (reviewing) return <div className="summary-review">
    {forced && <div className="summary-review-bar"><Button variant="ghost" size="sm" onClick={() => { setForced(null); void load() }}>← Back to summary</Button></div>}
    <MemoryReview key={`${forced ?? 'auto'}-${sourcePath}`} inline vaultPath={vaultPath} sourcePath={sourcePath} autoOpen
      buildOnOpen={forced === 'build' || (buildNow && !data?.pending && forced !== 'history')} initialHistory={forced === 'history'} />
  </div>
  if (!data) return <p className="summary-loading" role="status">{error || 'Loading summary…'}</p>
  // Its decisions already on the board: building knowledge stays possible, as a choice rather than the next step.
  if (!claims.length && decisionsOnBoard > 0) return <EmptyState icon={<ListChecks size={20} />} title="Decisions accepted"
    action={<Button variant="outline" onClick={() => setForced('build')}>Build knowledge</Button>}>This meeting's decisions and commitments are on the Decisions tab. Building knowledge from it is optional; nothing is saved until you approve it.</EmptyState>
  if (!claims.length) return <EmptyState icon={<ListChecks size={20} />} title="No approved outcomes yet"
    action={<Button onClick={() => setForced('build')}>Build knowledge</Button>}>Memoria reads the reviewed transcript and suggests decisions, commitments and people. Nothing is saved until you approve it.</EmptyState>

  const counts = SECTIONS.map(section => ({ section, total: claims.filter(claim => claim.kind === section.kind).length })).filter(item => item.total)
  const changed = claims.filter(claim => claim.status === 'needs-review').length
  const topic = claims.find(claim => claim.kind === 'Project' || claim.kind === 'Topic')?.pageTitle || title
  return <div className="summary">
    <div className="summary-main">
      <header className="summary-overview"><div><h2>Meeting outcomes</h2>
        <p className="summary-lead">{plural(claims.length, 'approved outcome')}</p></div>
        {onBrief && <Button size="sm" onClick={() => onBrief(topic)}>Create brief</Button>}
      </header>
      {changed > 0 && <Chip tone="orange" dot title="A source file changed after approval. Re-review before relying on it.">{changed} source{changed === 1 ? '' : 's'} changed — needs review</Chip>}
      {counts.map(({ section }) => <section key={section.kind} className="summary-section" aria-label={section.heading}>
        <SectionLabel>{section.heading}</SectionLabel>
        <ul>{claims.filter(claim => claim.kind === section.kind).map(claim => <li key={claim.id} className="summary-item" data-tone={kindTone(claim.kind)}>
          <span className="summary-dot" aria-hidden="true" />
          <div className="summary-item-body">
            <p>{claim.statement}</p>
            <details><summary>Quote</summary><blockquote>{claim.quote}</blockquote></details>
          </div>
          {claim.moment?.at != null
            ? <button type="button" className="summary-time" aria-label={`Play from ${clock(claim.moment.at)}`} onClick={() => onSeek(claim.moment!.at!)}>{clock(claim.moment.at)}</button>
            : <button type="button" className="summary-time" aria-label={`Open source, page ${claim.page}`} onClick={() => { void openNoteInNewWindow(`${vaultPath}/${claim.sourcePath}`, vaultPath, claim.sourceTitle).catch(() => undefined) }}>p.{claim.page}</button>}
        </li>)}</ul>
      </section>)}
      <div className="summary-bar">
        <p>Approved by you.</p>
        <Button variant="ghost" size="sm" onClick={() => setForced('history')}>Review or undo</Button>
      </div>
    </div>
    <aside className="summary-side" aria-label="Meeting details">
      <section><SectionLabel>Key moments</SectionLabel>
        {moments.length ? moments.map((moment, index) => <button key={index} type="button" className="summary-moment" data-tone={moment.tone} onClick={() => onSeek(moment.at)}><b>{clock(moment.at)}</b><span>{moment.label}</span></button>)
          : <p className="summary-muted">Press Mark moment while recording to save moments here.</p>}</section>
      {share.length > 1 && <section><SectionLabel>Share of words</SectionLabel>
        {share.map(item => <div key={item.speaker} className="summary-share" data-tone={speakerTone(item.speaker, order)}>
          <Avatar label={item.label} tone={speakerTone(item.speaker, order)} size={24} /><span className="summary-share-name">{item.label}</span>
          <span className="summary-share-bar" aria-hidden="true"><i style={{ width: `${item.percent}%` }} /></span><span className="summary-share-percent">{item.percent}%</span></div>)}</section>}
    </aside>
  </div>
}
