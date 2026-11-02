import { useEffect, useId, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { askLiveMeeting, warmLiveMeeting, type LiveAskResult } from './liveAskService'
import './liveAsk.css'

export interface LiveAskPanelProps { vaultPath: string; sessionText: string; enabled?: boolean }

// Changing vaults discards answers and prevents a late response entering another scope.
export function LiveAskPanel(props: LiveAskPanelProps) {
  return <LiveAskComposer key={props.vaultPath} {...props} />
}

function LiveAskComposer({ vaultPath, sessionText, enabled = true }: LiveAskPanelProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LiveAskResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [citation, setCitation] = useState<string | null>(null)
  const working = useRef(false)
  const warmed = useRef(0)
  const mounted = useRef(false)
  const job = useRef<string | null>(null)
  async function cancel() {
    const id = job.current
    job.current = null; working.current = false
    if (mounted.current) setBusy(false)
    if (id) await invoke('cancel_wiki_memory', { jobId: id })
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const id = job.current; job.current = null
      if (id) void invoke('cancel_wiki_memory', { jobId: id }).catch(failure => console.error('Live Ask cancellation failed', failure))
    }
  }, [])
  useEffect(() => {
    if (enabled) return
    const id = job.current; job.current = null; working.current = false
    setBusy(false)
    if (id) void invoke('cancel_wiki_memory', { jobId: id }).catch(failure => setError(`Cancellation failed: ${String(failure)}`))
  }, [enabled])

  // While a question is typed, the model reads the turns added since the last question, so the answer starts sooner.
  function warm() {
    if (!enabled || !sessionText.trim() || Date.now() - warmed.current < 15000) return
    warmed.current = Date.now()
    void warmLiveMeeting(vaultPath, sessionText).catch(() => undefined)
  }

  async function submit() {
    const nextQuestion = draft.trim()
    if (working.current || !mounted.current || !enabled || !nextQuestion) return
    // State alone cannot guard two submissions in the same React update batch.
    working.current = true
    const jobId = crypto.randomUUID()
    job.current = jobId
    setBusy(true); setError(null); setResult(null); setCitation(null); setQuestion(nextQuestion)
    try {
      const answer = await askLiveMeeting(vaultPath, nextQuestion, sessionText, jobId)
      if (mounted.current && job.current === jobId) setResult(answer)
    } catch (failure) {
      if (mounted.current && job.current === jobId) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (job.current === jobId) { job.current = null; working.current = false; if (mounted.current) setBusy(false) }
    }
  }

  return <section className="live-ask" aria-label="Live meeting assistant">
    <button type="button" className="live-ask-toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true">{open ? '▾' : '▸'}</span>Ask this meeting
    </button>
    {open && <div id={`${id}-body`} className="live-ask-body">
      <div className="live-ask-scroll" tabIndex={0} role="region" aria-label="Meeting answer and evidence">
        <p id={`${id}-notice`} className="live-ask-note">Approved decisions come from the record. What was said comes from this meeting's live transcript, which nobody has reviewed yet.</p>
        {question && <p className="live-ask-question">{question}</p>}
        {busy && <p role="status" className="live-ask-note">Asking this meeting…</p>}
        {error && <p role="alert" className="live-ask-error">Could not answer: {error}</p>}
        {result && <div className="live-ask-answer">
          {result.message && <p className="live-ask-note">{result.message}</p>}
          {result.needsReview?.map(source => <p className="live-ask-note" key={source.sourcePath}>{source.sourceTitle} needs review before it can be used as approved evidence.</p>)}
          {result.sections.map((section, sectionIndex) => <section key={sectionIndex}>
            <h3>{section.heading}</h3>
            {!section.items.length && <p className="live-ask-note">No supporting evidence found.</p>}
            {section.items.map((item, itemIndex) => <div className="live-ask-item" data-live={item.live || undefined} key={itemIndex}>
              <p>{item.text}</p>
              <div className="live-ask-citations">{[...new Set(item.citations)].map(citeId => {
                const evidence = result.citations.find(source => source.id === citeId)
                if (!evidence) return null
                const key = `${sectionIndex}-${itemIndex}-${citeId}`
                const expanded = citation === key
                const quoteId = `${id}-quote-${sectionIndex}-${itemIndex}-${item.citations.indexOf(citeId)}`
                return <div key={citeId} className="live-ask-citation">
                  <button type="button" aria-label={`Evidence ${evidence.id}: ${evidence.sourceTitle}, page ${evidence.page}`}
                    aria-expanded={expanded} aria-controls={quoteId} title={`${evidence.sourceTitle} · page ${evidence.page}`}
                    onClick={() => setCitation(current => current === key ? null : key)}>
                    {evidence.sourceTitle} · p.{evidence.page}
                  </button>
                  {expanded && <blockquote id={quoteId}><p>{evidence.quote}</p><footer>{evidence.sourceTitle} · page {evidence.page}<br />{evidence.sourcePath}</footer></blockquote>}
                </div>
              })}</div>
            </div>)}
          </section>)}
          {!result.message && !result.sections.length && !result.needsReview?.length && <p className="live-ask-note">No supporting evidence found.</p>}
          {result.warnings.map((warning, index) => <p key={index} className="live-ask-note">{warning}</p>)}
        </div>}
      </div>
      <form className="live-ask-composer" aria-label="Ask this meeting" onSubmit={event => { event.preventDefault(); void submit() }}>
        <input aria-label="Meeting question" aria-describedby={`${id}-notice`} value={draft} maxLength={2000} disabled={busy || !enabled}
          onChange={event => setDraft(event.target.value)} onFocus={warm} placeholder="Ask about this meeting…" />
        <button type="submit" disabled={busy || !enabled || !draft.trim()}>{busy ? 'Asking…' : 'Ask'}</button>
        {busy && <button type="button" onClick={() => { void cancel().catch(failure => setError(`Cancellation failed: ${String(failure)}`)) }}>Cancel asking</button>}
      </form>
    </div>}
  </section>
}
