import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ArrowSquareOut, MagnifyingGlass } from '@phosphor-icons/react'
import { Avatar, Chip, EmptyState, SectionLabel } from './memoriaUi'
import { Button } from './ui/button'
import { kindTone } from '../lib/knowledgeKinds'
import { dayLabel, highlightParts, plural } from '../lib/format'
import { clock, speakerTone } from '../lib/speakers'
import './memorySearch.css'

interface Line { meetingId: string; title: string; created?: string; reviewed: boolean; speaker: string; label: string; at: number; text: string }
interface ClaimHit { id: string; title: string; pageTitle?: string; kind: string; statement: string; sourcePath: string; sourceTitle: string; knowledgePath: string; moment?: { meetingId: string; at: number | null } | null }
interface Outcome { query: string; words: string[]; lines: Line[]; claims: ClaimHit[]; meetings: number; speakers: string[] }
const RANGES = [{ id: 'all', label: 'All time', days: 0 }, { id: '30', label: 'Last 30 days', days: 30 }, { id: '90', label: 'Last 90 days', days: 90 }]

function Marked({ text, words }: { text: string; words: string[] }) {
  return <>{highlightParts(text, words).map((part, index) => part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</>
}

export function MemorySearch({ vaultPath, active = true, onOpenMoment, onOpenPage }: {
  vaultPath: string; active?: boolean; onOpenMoment: (meetingId: string, at: number) => void; onOpenPage: (path: string, title: string) => void
}) {
  const [query, setQuery] = useState('')
  const [speaker, setSpeaker] = useState('')
  const [range, setRange] = useState('all')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [speakers, setSpeakers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef(0)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { if (active) field.current?.focus() }, [active])
  useEffect(() => {
    const text = query.trim()
    if (!text) { latest.current++; setOutcome(null); setBusy(false); setError(''); return }
    const id = ++latest.current
    const timer = setTimeout(async () => {
      setBusy(true); setError('')
      const days = RANGES.find(item => item.id === range)?.days ?? 0
      try {
        const result = await invoke<Outcome>('wiki_memory', { request: { action: 'search', vaultPath, query: text, ...(speaker ? { speaker } : {}),
          ...(days ? { since: new Date(Date.now() - days * 86400000).toISOString() } : {}) } })
        if (id !== latest.current) return
        setOutcome(result)
        if (!speaker && Array.isArray(result.speakers)) setSpeakers(result.speakers.filter(name => !/^unknown/i.test(name)).slice(0, 6))
      } catch (failure) { if (id === latest.current) setError(failure instanceof Error ? failure.message : String(failure)) }
      finally { if (id === latest.current) setBusy(false) }
    }, 250)
    return () => clearTimeout(timer)
  }, [query, speaker, range, vaultPath])
  const lines = outcome?.lines ?? []
  const claims = outcome?.claims ?? []
  const words = outcome?.words ?? []
  return <section className="search" aria-label="Search meetings">
    <label className="search-field"><MagnifyingGlass size={18} aria-hidden="true" />
      <input ref={field} aria-label="Search meetings and approved knowledge" placeholder="Search what was said, decided or committed…" value={query} maxLength={500} onChange={event => setQuery(event.target.value)} /></label>
    <div className="search-filters" role="group" aria-label="Search filters">
      {speakers.map(name => <button key={name} type="button" className="search-chip" aria-pressed={speaker === name} onClick={() => setSpeaker(current => current === name ? '' : name)}>{name}</button>)}
      {RANGES.map(item => <button key={item.id} type="button" className="search-chip" aria-pressed={range === item.id} onClick={() => setRange(item.id)}>{item.label}</button>)}
    </div>
    {error && <p role="alert" className="search-error">{error}</p>}
    {outcome && <p className="search-meta" role="status">{busy ? 'Searching…' : `${plural(lines.length, 'line')} · ${plural(outcome.meetings, 'meeting')} searched${claims.length ? ` · ${plural(claims.length, 'approved claim')}` : ''}`}</p>}
    <div className="search-results">
      {lines.map((line, index) => <button key={`${line.meetingId}-${line.at}-${index}`} type="button" className="search-line" onClick={() => onOpenMoment(line.meetingId, line.at)}>
        <Avatar label={line.label} tone={speakerTone(line.speaker, [])} size={34} />
        <span className="search-line-main">
          <span className="search-line-head"><strong>{line.title}</strong><span>{dayLabel(line.created)}</span><span>{line.label}</span>{!line.reviewed && <Chip>Draft</Chip>}</span>
          <span className="search-line-text"><Marked text={line.text} words={words} /></span>
        </span>
        <span className="search-time">{clock(line.at)}</span>
      </button>)}
      {claims.length > 0 && <div className="search-claims">
        <SectionLabel>Approved knowledge</SectionLabel>
        {claims.map(claim => <div key={claim.id} className="search-claim">
          <div className="search-claim-head"><Chip tone={kindTone(claim.kind)}>{claim.kind}</Chip><strong>{claim.pageTitle || claim.title}</strong>
            {claim.moment?.at != null && <Button type="button" variant="ghost" size="sm" className="search-time" onClick={() => onOpenMoment(claim.moment!.meetingId, claim.moment!.at!)}>{clock(claim.moment.at)}</Button>}
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Open knowledge page ${claim.pageTitle || claim.title}`} title="Open knowledge page" onClick={() => onOpenPage(claim.knowledgePath, claim.pageTitle || claim.title)}><ArrowSquareOut size={14} /></Button></div>
          <p><Marked text={claim.statement} words={words} /></p>
          <span className="search-claim-source">{claim.sourceTitle}</span>
        </div>)}
      </div>}
      {outcome && !busy && !lines.length && !claims.length && <EmptyState icon={<MagnifyingGlass size={20} />} title="No matches">Nothing in your transcripts or approved knowledge matches “{query.trim()}”. Search covers saved transcript text, including drafts.</EmptyState>}
      {!outcome && !busy && !error && <EmptyState icon={<MagnifyingGlass size={20} />} title="Search every meeting">Search by what was said or by who said it. A result opens the meeting at that moment.</EmptyState>}
    </div>
  </section>
}
