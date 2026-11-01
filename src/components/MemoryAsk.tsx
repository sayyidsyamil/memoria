import { useEffect, useRef, useState } from 'react'
import { ArrowSquareOut, ArrowUp, Check, Sparkle } from '@phosphor-icons/react'
import { invoke } from '@tauri-apps/api/core'
import { startMemoryJob } from '../lib/memoryJob'
import { Button } from './ui/button'
import { openNoteInNewWindow } from '../utils/openNoteWindow'
import { MemoryReview } from './MemoryReview'
import { SectionLabel, StateButton } from './memoriaUi'
import { announceMemoryChanged } from '../hooks/useWorkspaceSummary'
import { clock } from '../lib/speakers'
import './memoryAsk.css'

interface Moment { meetingId: string; meetingTitle: string; at: number | null }
interface Evidence { id: string; sourcePath: string; sourceTitle: string; page: number; quote: string; moment?: Moment | null }
interface Result {
  sections: { heading: string; items: { text: string; citations: string[] }[] }[]
  citations: Evidence[]
  message?: string
  warnings: string[]
  needsReview?: { sourcePath: string; sourceTitle: string }[]
}
export type AskMode = 'ask' | 'brief'
interface Entry {
  id: string; question: string; mode: AskMode; status: 'working' | 'done' | 'error'; stage: string
  result?: Result; error?: string; briefId: string; prepared: string; savedPath?: string; saving?: boolean
}

function citeLabel(evidence: Evidence) {
  const title = evidence.moment?.meetingTitle ?? evidence.sourceTitle
  return { title: title.length > 28 ? `${title.slice(0, 27)}…` : title, where: evidence.moment?.at != null ? clock(evidence.moment.at) : `p.${evidence.page}` }
}

export function MemoryAsk({ vaultPath, briefOnly = false, active = false, scope, placeholder, mode: controlledMode, onModeChange, seed, onSaved, onOpenMoment }: {
  vaultPath: string; briefOnly?: boolean
  /** Focus the composer when this becomes true (for tabs that stay mounted). */
  active?: boolean
  /** Restrict answers to these reviewed source pages (for example one meeting). */
  scope?: string[]; placeholder?: string
  mode?: AskMode; onModeChange?: (mode: AskMode) => void
  /** Prefills the composer whenever the nonce changes. */
  seed?: { text: string; nonce: number }
  onSaved?: () => void
  /** Called when a citation points at a moment in a meeting transcript. */
  onOpenMoment?: (meetingId: string, at: number) => void
}) {
  const [thread, setThread] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [localMode, setLocalMode] = useState<AskMode>('ask')
  const [openCitation, setOpenCitation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancel = useRef<(() => Promise<void>) | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { if (active) field.current?.focus() }, [active])
  const mode: AskMode = briefOnly ? 'brief' : controlledMode ?? localMode
  const busy = thread.some(entry => entry.status === 'working')
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [thread])
  useEffect(() => { if (seed) setDraft(seed.text) }, [seed])
  const patch = (id: string, changes: Partial<Entry>) => setThread(previous => previous.map(entry => entry.id === id ? { ...entry, ...changes } : entry))
  function chooseMode(next: AskMode) { setLocalMode(next); onModeChange?.(next) }

  async function submit() {
    const question = draft.trim()
    if (busy || !question) return
    const id = crypto.randomUUID()
    setThread(previous => [...previous, { id, question, mode, status: 'working', stage: 'Starting local memory request…', briefId: crypto.randomUUID(), prepared: new Date().toISOString() }])
    setDraft(''); setError(null); setOpenCitation(null)
    const job = startMemoryJob<Result>({ action: mode, question, vaultPath, ...(scope ? { scope } : {}) }, stage => patch(id, { stage }))
    cancel.current = job.cancel
    try { patch(id, { status: 'done', result: await job.promise, prepared: new Date().toISOString() }) }
    catch (failure) { patch(id, { status: 'error', error: String(failure) }) }
    finally { cancel.current = null }
  }
  async function saveBrief(entry: Entry) {
    if (!entry.result) return
    patch(entry.id, { saving: true }); setError(null)
    try {
      const saved = await invoke<{ pagePath: string }>('wiki_memory', { request: { action: 'save_brief', vaultPath, id: entry.briefId, topic: entry.question, result: entry.result, prepared: entry.prepared } })
      patch(entry.id, { saving: false, savedPath: saved.pagePath }); onSaved?.(); announceMemoryChanged()
    } catch (failure) { patch(entry.id, { saving: false }); setError(String(failure)) }
  }
  const openPage = (path: string, title: string) => { void openNoteInNewWindow(`${vaultPath}/${path}`, vaultPath, title).catch(failure => setError(String(failure))) }

  function answer(entry: Entry) {
    const result = entry.result
    if (!result) return null
    const isBrief = entry.mode === 'brief'
    const filled = result.sections.filter(section => section.items.length)
    const empty = result.sections.filter(section => !section.items.length)
    const canSave = isBrief && !result.needsReview?.length && filled.length > 0
    return <>
      {result.message && <p className="chat-note">{result.message}</p>}
      {result.needsReview?.map(source => <div key={source.sourcePath} className="chat-stale"><p>{source.sourceTitle} needs review</p><MemoryReview vaultPath={vaultPath} sourcePath={source.sourcePath} /></div>)}
      {canSave && <div className="chat-brief-head"><SectionLabel>Brief preview</SectionLabel>
        {entry.savedPath
          ? <Button variant="outline" size="sm" onClick={() => openPage(entry.savedPath!, `Brief — ${entry.question}`)}><Check size={14} weight="bold" />Open saved brief</Button>
          : <StateButton size="sm" variant="outline" status={entry.saving ? 'working' : 'idle'} labels={{ idle: 'Save cited brief', working: 'Saving…', done: 'Saved' }} onClick={() => { void saveBrief(entry) }} />}
      </div>}
      {result.sections.length > 0 && <div className="chat-document">
        {(isBrief ? filled : result.sections).map((section, sectionIndex) => <section key={section.heading} className="chat-section">
          {(isBrief || result.sections.length > 1) && <h3>{section.heading}</h3>}
          {section.items.length === 0 && <p className="chat-none">No supporting evidence found</p>}
          {section.items.map((item, index) => {
            const cites = item.citations.map(id => result.citations.find(evidence => evidence.id === id)).filter((evidence): evidence is Evidence => !!evidence)
            const key = `${entry.id}-${sectionIndex}-${index}`
            const shown = cites.find(evidence => openCitation === `${key}-${evidence.id}`)
            return <div key={index} className="chat-item">
              <p>{item.text}</p>
              {cites.length > 0 && <div className="chat-cites">{cites.map(evidence => {
                const label = citeLabel(evidence)
                return <button key={evidence.id} type="button" className="chat-cite" aria-expanded={shown?.id === evidence.id}
                  aria-label={`Evidence ${evidence.id}: ${evidence.sourceTitle}, page ${evidence.page}`} title={`${evidence.sourceTitle} · page ${evidence.page}`}
                  onClick={() => setOpenCitation(current => current === `${key}-${evidence.id}` ? null : `${key}-${evidence.id}`)}>
                  <span>{label.title}</span><b>{label.where}</b></button>
              })}</div>}
              {shown && <blockquote className="chat-evidence"><p>{shown.quote}</p>
                <footer><span>{shown.sourceTitle} · page {shown.page}</span><span className="chat-evidence-actions">
                  {shown.moment?.at != null && onOpenMoment && <Button type="button" variant="ghost" size="sm" onClick={() => onOpenMoment(shown.moment!.meetingId, shown.moment!.at!)}>Go to {clock(shown.moment.at)} in the transcript</Button>}
                  <Button type="button" variant="ghost" size="sm" onClick={() => openPage(shown.sourcePath, shown.sourceTitle)}><ArrowSquareOut size={13} />Open source</Button></span></footer></blockquote>}
            </div>
          })}
        </section>)}
        {isBrief && empty.length > 0 && filled.length > 0 && <p className="chat-none">Nothing recorded in approved knowledge for: {empty.map(section => section.heading).join(', ')}.</p>}
      </div>}
      {result.warnings.map(warning => <p key={warning} className="chat-note">{warning}</p>)}
    </>
  }

  return <section className="chat" aria-label="Reviewed knowledge assistant">
    <div className="chat-thread" aria-live="polite">
      {thread.length === 0 && <div className="chat-intro"><span className="chat-mark" aria-hidden="true"><Sparkle size={18} weight="fill" /></span>
        <p>{scope ? 'Ask about this meeting.' : 'Ask about your meetings.'} Answers use only approved knowledge, and every claim links to the exact quote. Each question is answered fresh.</p></div>}
      {thread.map(entry => <div key={entry.id} className="chat-turn">
        <div className="chat-question"><p>{entry.question}</p></div>
        <div className="chat-answer"><span className="chat-mark" aria-hidden="true"><Sparkle size={15} weight="fill" /></span>
          <div className="chat-body">
            {entry.status === 'working' && <div className="chat-working"><p role="status">{entry.stage}</p><Button type="button" variant="outline" size="sm" onClick={() => { patch(entry.id, { stage: 'Cancelling…' }); void cancel.current?.().catch(failure => setError(String(failure))) }}>Cancel</Button></div>}
            {entry.status === 'error' && <p role="alert" className="chat-error">{entry.error}</p>}
            {entry.status === 'done' && answer(entry)}
          </div></div>
      </div>)}
      {error && <p role="alert" className="chat-error">{error}</p>}
      <div ref={end} />
    </div>
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); void submit() }}>
      <input ref={field} aria-label="Question or meeting topic" value={draft} maxLength={2000} onChange={event => setDraft(event.target.value)}
        placeholder={placeholder ?? (mode === 'brief' ? 'Meeting or project to brief…' : 'Ask about your meetings…')} />
      {!briefOnly && <div className="chat-mode" role="group" aria-label="Response type">
        <button type="button" aria-pressed={mode === 'ask'} onClick={() => chooseMode('ask')}>Answer</button>
        <button type="button" aria-pressed={mode === 'brief'} onClick={() => chooseMode('brief')}>Brief</button></div>}
      {mode === 'brief'
        ? <Button type="submit" className="chat-send-label" disabled={busy || !draft.trim()}>Create brief</Button>
        : <button type="submit" className="chat-send" aria-label="Ask" disabled={busy || !draft.trim()}><ArrowUp size={16} weight="bold" /></button>}
    </form>
  </section>
}
