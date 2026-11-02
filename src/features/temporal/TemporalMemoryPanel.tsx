import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CaretDown, CheckCircle, Quotes } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Chip, EmptyState, type Tone } from '../../components/memoriaUi'
import { announceMemoryChanged } from '../../hooks/useWorkspaceSummary'
import {
  temporalService,
  type TemporalAttribute,
  type TemporalCorrection,
  type TemporalEvidence,
  type TemporalFact,
  type TemporalHistoryFact,
  type TemporalOverview,
  type TemporalProposal,
  type TemporalValue,
} from './temporalService'
import { attributeLabel, changedTimes, formatValue, ingestSummary, isCalendarDay, labelUnit, localDay, plainLedgerError } from './temporalFormat'
import { buildBoard, isCorrection, retractionOf, reviewerName, type BoardItem, type BoardRow, type CommitmentTone } from './temporalBoard'
import { Quote, TemporalDate, type OpenMoment } from './TemporalEvidence'
import { TrackedItemsSetup } from './TrackedItemsSetup'
import { TrackedValueLookup } from './TrackedValueLookup'
import { isCalendarDate } from './trackedItemRules'
import { useMeetingTitles } from './useMeetingTitles'
import './temporalMemory.css'

export interface TemporalMemoryPanelProps {
  vaultPath: string
  meetingId?: string
  /** Opens a meeting's recording at the moment a quote was said. */
  onOpenMoment?: OpenMoment
}

type AnyFact = TemporalFact | TemporalHistoryFact
type EditMode = 'correct' | 'retract'
type Place = 'top' | 'edit' | 'lookup' | 'setup' | `proposal-${number}`
const STATE_TONES: Record<CommitmentTone, Tone> = { overdue: 'red', 'due-today': 'orange', 'due-soon': 'orange', open: 'neutral', done: 'green', cancelled: 'neutral' }

const slotKey = (objectId: string, attribute: string) => `${objectId}\u0000${attribute}`
const quoteKey = (fact: TemporalFact) => isCorrection(fact) || !fact.evidence.length ? null
  : JSON.stringify([fact.evidence[0].quote, fact.evidence[0].speaker, fact.evidence[0].meeting, fact.evidence[0].audio_start ?? null])

/** A write that succeeded but whose reload failed: reported at the top, because the row it came from may be gone. */
class ReloadError extends Error {}

/** The ledger's overview, or a plain error when it answered in a shape the board cannot read. */
function checkedOverview(value: TemporalOverview | null | undefined): TemporalOverview {
  if (!value || !Array.isArray(value.registry?.objects) || !Array.isArray(value.facts) || !Array.isArray(value.proposals)) {
    throw new Error('The decision ledger answered in a form this version cannot read. Refresh to try again.')
  }
  return { ...value, check: value.check ?? { ok: true, problems: [] } }
}

/** The reasons behind corrected values. The overview names the fact a correction replaced; only its history says why. */
async function correctionReasons(vaultPath: string, facts: readonly TemporalFact[]): Promise<Map<number, TemporalCorrection>> {
  const found = new Map<number, TemporalCorrection>()
  for (const fact of facts) if (fact.correction) found.set(fact.fact_id, fact.correction)
  const slots = new Map(facts.filter(fact => isCorrection(fact) && !fact.correction).map(fact => [slotKey(fact.object_id, fact.attribute), fact]))
  const histories = await Promise.allSettled([...slots.values()].map(fact => temporalService.history(vaultPath, fact.object_id, fact.attribute)))
  for (const history of histories) {
    if (history.status !== 'fulfilled' || !Array.isArray(history.value)) continue
    for (const entry of history.value) if (entry?.correction) found.set(entry.fact_id, entry.correction)
  }
  return found
}

/** The value a person typed, in the form the ledger stores for the attribute, or the reason it cannot be stored. */
function typedValue(text: string, definition: TemporalAttribute | undefined, previous: TemporalValue): { value: TemporalValue } | { problem: string } {
  const value = text.trim()
  if (!value) return { problem: 'Enter a value.' }
  const type = definition?.type ?? (typeof previous === 'number' ? 'number' : 'text')
  if (type === 'number') {
    // Separators and a unit may be typed as they are shown ("RM 280,000"); the ledger keeps the number.
    const digits = value.replace(/[^\d.-]/g, '')
    const amount = digits ? Number(digits) : Number.NaN
    return Number.isFinite(amount) ? { value: amount } : { problem: 'Enter a number, for example 280,000.' }
  }
  if (type === 'date' && !isCalendarDate(value)) return { problem: 'Enter a valid date in YYYY-MM-DD format.' }
  if (type === 'enum' && definition?.values?.length && !definition.values.includes(value)) return { problem: `Choose one of: ${definition.values.join(', ')}.` }
  return { value }
}

function editableText(value: TemporalValue): string {
  if (value == null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** A text box for most values; a list when the attribute allows only certain values. */
function ValueInput({ label, definition, value, onChange, autoFocus = false }: { label: string; definition?: TemporalAttribute; value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  const allowed = definition?.type === 'enum' ? definition.values ?? [] : []
  const choices = allowed.length ? [...allowed, ...(value && !allowed.includes(value) ? [value] : [])] : null
  return <label>{label}{choices
    ? <select autoFocus={autoFocus} value={value} onChange={event => onChange(event.target.value)}>{choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select>
    : <Input autoFocus={autoFocus} required value={value} inputMode={definition?.type === 'number' ? 'decimal' : undefined} placeholder={definition?.type === 'date' ? 'YYYY-MM-DD' : undefined} onChange={event => onChange(event.target.value)} />}
  </label>
}

function Problem({ text }: { text: string | null }) {
  return text ? <p role="alert" className="board-problem">{text}</p> : null
}

/** "Corrected by you: …": a corrected value is proved by the person's reason, not by the quote it replaced. */
function CorrectionNote({ correction }: { correction?: TemporalCorrection }) {
  return <p className="board-evidence board-corrected">
    <CheckCircle size={14} weight="fill" aria-hidden="true" />
    <span>Corrected by {reviewerName(correction?.reviewer)}{correction?.reason ? <>: <span className="board-reason">{correction.reason}</span></> : null}</span>
  </p>
}

// A new scope remounts the ledger so late responses cannot leak across vaults or meetings.
export function TemporalMemoryPanel(props: TemporalMemoryPanelProps) {
  return <TemporalLedger key={JSON.stringify([props.vaultPath, props.meetingId])} {...props} />
}

function TemporalLedger({ vaultPath, meetingId, onOpenMoment }: TemporalMemoryPanelProps) {
  const ids = useId()
  const [overview, setOverview] = useState<TemporalOverview | null>(null)
  const [corrections, setCorrections] = useState<ReadonlyMap<number, TemporalCorrection>>(() => new Map())
  const [busy, setBusy] = useState<string | null>('Loading decisions…')
  const [error, setError] = useState<{ text: string; place: Place } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [history, setHistory] = useState<{ key: string; facts: TemporalHistoryFact[] } | null>(null)
  const [edit, setEdit] = useState<{ fact: AnyFact; mode: EditMode; value: string; reason: string } | null>(null)
  const [proposalEdit, setProposalEdit] = useState<{ id: number; value: string } | null>(null)
  const [folds, setFolds] = useState({ lookup: false, setup: false })
  const working = useRef(false)
  const mounted = useRef(false)
  const version = useRef(0)

  useEffect(() => {
    mounted.current = true
    let canceled = false
    working.current = true
    const loading = ++version.current
    temporalService.overview(vaultPath).then(checkedOverview).then(result => {
      if (canceled) return
      setOverview(result)
      void correctionReasons(vaultPath, result.facts).then(found => { if (!canceled && loading === version.current) setCorrections(found) })
    }).catch(failure => {
      if (!canceled) setError({ text: String(failure instanceof Error ? failure.message : failure), place: 'top' })
    }).finally(() => {
      if (!canceled) { working.current = false; setBusy(null) }
    })
    return () => { canceled = true; mounted.current = false }
  }, [vaultPath])
  // Declared after the ledger load so the ledger is requested first; titles only label the citations and never gate them.
  const { titles, dates, reload: reloadTitles } = useMeetingTitles(vaultPath)

  async function run(status: string, action: () => Promise<void>, place: Place = 'top') {
    if (working.current || !mounted.current) return
    working.current = true
    setBusy(status); setError(null); setMessage(null)
    try { await action() }
    catch (failure) {
      if (mounted.current) setError({ text: plainLedgerError(failure instanceof Error ? failure.message : String(failure)), place: failure instanceof ReloadError ? 'top' : place })
    }
    finally { if (mounted.current) { working.current = false; setBusy(null) } }
  }

  async function refresh() {
    const loading = ++version.current
    const result = checkedOverview(await temporalService.overview(vaultPath))
    if (!mounted.current || loading !== version.current) return
    setOverview(result)
    void correctionReasons(vaultPath, result.facts).then(found => { if (mounted.current && loading === version.current) setCorrections(found) })
  }

  /** Writes, then reloads. If the reload fails, what was acted on is dropped so that the same action is not offered again. */
  async function mutate(action: () => Promise<unknown>, success: string, forget: (current: TemporalOverview) => TemporalOverview) {
    await action()
    if (!mounted.current) return
    setEdit(null); setHistory(null); setProposalEdit(null); setMessage(success)
    announceMemoryChanged()
    try { await refresh() }
    catch (failure) {
      setOverview(current => current && forget(current))
      throw new ReloadError(`${success} The updated ledger could not be loaded: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
  }

  const objects = overview?.registry.objects ?? []
  const definitionOf = (objectId: string | undefined, name: string) => objects.find(item => item.object_id === objectId)?.attributes.find(item => item.name === name)
  const itemOf = (objectId: string | undefined, fallback: string) => {
    const attributes = objects.find(item => item.object_id === objectId)?.attributes ?? []
    return { ...labelUnit(objects.find(item => item.object_id === objectId)?.label ?? fallback, attributes.some(item => item.type === 'number')), multi: attributes.length > 1 }
  }
  const withoutProposal = (id: number) => (current: TemporalOverview) => ({ ...current, proposals: current.proposals.filter(item => item.proposal_id !== id) })
  const withoutFact = (id: number) => (current: TemporalOverview) => ({ ...current, facts: current.facts.filter(item => item.fact_id !== id) })
  /** In a meeting, only its own quotes can be played; elsewhere any quote opens its meeting. */
  const momentFor = (source: TemporalEvidence): OpenMoment | undefined => onOpenMoment && (!meetingId || source.meeting === meetingId) ? onOpenMoment : undefined
  const errorAt = (place: Place) => error?.place === place ? error.text : null
  const show = (fact: Pick<AnyFact, 'object_id' | 'attribute' | 'value'>, unit: string | null) => {
    const type = definitionOf(fact.object_id, fact.attribute)?.type
    return type === 'date' && isCalendarDay(fact.value) ? <TemporalDate value={fact.value} /> : formatValue(fact.value, type, unit)
  }

  function review(proposal: TemporalProposal, decision: 'accept' | 'reject' | 'edit') {
    const place: Place = `proposal-${proposal.proposal_id}`
    const forget = withoutProposal(proposal.proposal_id)
    if (decision === 'reject') {
      void run('Rejecting suggestion…', () => mutate(() => temporalService.rejectProposal(vaultPath, proposal.proposal_id), 'Suggestion rejected.', forget), place)
      return
    }
    if (decision === 'accept') {
      void run('Accepting suggestion…', () => mutate(() => temporalService.acceptProposal(vaultPath, proposal.proposal_id), 'Suggestion accepted.', forget), place)
      return
    }
    if (proposalEdit?.id !== proposal.proposal_id) return
    const typed = typedValue(proposalEdit.value, definitionOf(proposal.object_id, proposal.attribute), proposal.value)
    if ('problem' in typed) { setError({ text: typed.problem, place }); return }
    void run('Accepting suggestion…', () => mutate(() => temporalService.acceptProposal(vaultPath, proposal.proposal_id, { value: typed.value }), 'Suggestion accepted with your edit.', forget), place)
  }

  function startEdit(fact: AnyFact) {
    if (fact.retracted) return
    setError(null)
    setEdit({ fact, mode: 'correct', value: editableText(fact.value), reason: '' })
  }

  function submitEdit() {
    if (!edit || edit.fact.retracted || !edit.reason.trim()) return
    const { fact, mode } = edit
    const reason = edit.reason.trim()
    if (mode === 'retract') {
      void run('Retracting value…', () => mutate(() => temporalService.retractFact(vaultPath, fact.fact_id, reason), 'Value retracted.', withoutFact(fact.fact_id)), 'edit')
      return
    }
    const typed = typedValue(edit.value, definitionOf(fact.object_id, fact.attribute), fact.value)
    if ('problem' in typed) { setError({ text: typed.problem, place: 'edit' }); return }
    void run('Saving correction…', () => mutate(() => temporalService.correctFact(vaultPath, fact.fact_id, typed.value, reason), 'Correction saved.', withoutFact(fact.fact_id)), 'edit')
  }

  function toggleHistory(fact: TemporalFact) {
    const key = slotKey(fact.object_id, fact.attribute)
    if (history?.key === key) { setHistory(null); return }
    void run('Loading history…', async () => {
      const facts = await temporalService.history(vaultPath, fact.object_id, fact.attribute)
      if (mounted.current) { setHistory({ key, facts: Array.isArray(facts) ? facts : [] }); setEdit(null) }
    })
  }

  function editForm(fact: AnyFact, title: string, unit: string | null): ReactNode {
    if (edit?.fact.fact_id !== fact.fact_id) return null
    const correcting = edit.mode === 'correct'
    return <section className="board-edit" aria-label={correcting ? 'Correct fact' : 'Retract fact'}>
      <p className="board-edit-title">{correcting ? 'Correct' : 'Retract'} {title}. Recorded value: <strong>{show(fact, unit)}</strong>.</p>
      <form onSubmit={event => { event.preventDefault(); submitEdit() }}><fieldset disabled={!!busy} className="board-edit-fields">
        {correcting && <ValueInput autoFocus label="Corrected value" definition={definitionOf(fact.object_id, fact.attribute)} value={edit.value} onChange={value => setEdit({ ...edit, value })} />}
        <label>Reason (required)<Input autoFocus={!correcting} required value={edit.reason} placeholder={correcting ? 'e.g. The chair changed the owner' : 'e.g. This was never agreed'} onChange={event => setEdit({ ...edit, reason: event.target.value })} /></label>
        <Problem text={errorAt('edit')} />
        <div className="board-edit-actions">
          <Button type="submit" size="sm" disabled={!edit.reason.trim() || (correcting && !edit.value.trim())}>{correcting ? 'Save correction' : 'Confirm retraction'}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setEdit(null); setError(null) }}>Cancel</Button>
          <Button type="button" size="sm" variant="ghost" className="board-edit-switch" onClick={() => { setError(null); setEdit({ ...edit, mode: correcting ? 'retract' : 'correct' }) }}>{correcting ? 'Retract instead' : 'Correct instead'}</Button>
        </div>
      </fieldset></form>
    </section>
  }

  function historyList(row: BoardRow, item: BoardItem, title: string, id: string): ReactNode {
    if (history?.key !== slotKey(row.fact.object_id, row.fact.attribute)) return null
    const entries = history.facts.map((entry, index) => ({ entry, index }))
      .sort((a, b) => (b.entry.decided_at ?? b.entry.claim_from ?? '').localeCompare(a.entry.decided_at ?? a.entry.claim_from ?? '') || b.index - a.index)
      .map(({ entry }) => entry)
    return <section id={id} className="board-history" aria-label={`History: ${title}`}>
      <div className="board-history-head"><h5>History</h5><Button size="xs" variant="ghost" disabled={!!busy} onClick={() => setHistory(null)}>Close history</Button></div>
      {!entries.length && <p className="board-muted">No history recorded.</p>}
      <ol>{entries.map(entry => {
        const withdrawn = retractionOf(entry)
        const current = entry.fact_id === row.fact.fact_id
        const corrected = isCorrection(entry)
        // A correction takes over the replaced value's dates, so a date here would claim the person decided it then.
        const decided = corrected ? null : entry.decided_at ?? entry.claim_from
        return <li key={entry.fact_id} data-current={current || undefined} data-withdrawn={withdrawn ? true : undefined}>
          <div className="board-history-line">
            <span className="board-history-value">{show(entry, item.unit)}</span>
            <span className="board-history-meta">
              {current ? 'Now' : withdrawn ? (withdrawn.corrected ? 'Replaced by a correction' : 'Retracted') : 'Earlier'}
              {decided && <> · decided <TemporalDate value={decided} time /></>}
              {entry.claim_to && <> · until <TemporalDate value={entry.claim_to} /></>}
            </span>
            {!withdrawn && !current && <Button size="xs" variant="ghost" disabled={!!busy} aria-label={`Correct this earlier value of ${title}`} onClick={() => startEdit(entry)}>Correct</Button>}
          </div>
          {withdrawn && !withdrawn.corrected && withdrawn.reason && <p className="board-muted">Reason: {withdrawn.reason}</p>}
          {corrected ? <CorrectionNote correction={entry.correction ?? corrections.get(entry.fact_id)} />
            : entry.evidence.length ? entry.evidence.map((source, index) => <Quote key={index} source={source} titles={titles} onOpenMoment={momentFor(source)} />)
              : <p className="board-muted">No source quote recorded.</p>}
          {editForm(entry, title, item.unit)}
        </li>
      })}</ol>
    </section>
  }

  function rowView(item: BoardItem, row: BoardRow, single: boolean, quoted: boolean) {
    const { fact, attribute } = row
    const title = single ? item.title : `${item.title} ${attributeLabel(attribute.name).toLowerCase()}`
    const corrected = isCorrection(fact)
    const changed = changedTimes(fact.n_changes)
    const historyOpen = history?.key === slotKey(fact.object_id, fact.attribute)
    const historyId = `${ids}-history-${fact.fact_id}`
    return <div className="board-row" key={fact.fact_id}>
      {single ? <h4 className="board-row-label">{item.title}</h4> : <span className="board-row-label">{attributeLabel(attribute.name)}</span>}
      <div className="board-row-body">
        <div className="board-value-line">
          <span className="board-value">{show(fact, item.unit)}</span>
          <span className="board-row-actions">
            {(changed || corrected) && <Button size="xs" variant="ghost" className="board-link" aria-expanded={historyOpen} aria-controls={historyOpen ? historyId : undefined}
              aria-label={`${changed ? `C${changed.slice(1)}` : 'History'}: history of ${title}`} disabled={!!busy} onClick={() => toggleHistory(fact)}>
              {changed || 'History'}<CaretDown size={11} aria-hidden="true" data-open={historyOpen || undefined} />
            </Button>}
            <Button size="xs" variant="ghost" aria-label={`Correct ${title}`} disabled={!!busy || !!fact.retracted} onClick={() => startEdit(fact)}>Correct</Button>
          </span>
        </div>
        {corrected ? <CorrectionNote correction={fact.correction ?? corrections.get(fact.fact_id)} />
          : !quoted ? null
            : fact.evidence.length ? <Quote source={fact.evidence[0]} titles={titles} onOpenMoment={momentFor(fact.evidence[0])} line />
              : <p className="board-muted">No source quote recorded.</p>}
        {editForm(fact, title, item.unit)}
        {historyOpen && historyList(row, item, title, historyId)}
      </div>
    </div>
  }

  function card(item: BoardItem) {
    const single = item.kind !== 'commitment' && item.rows.length === 1
    // Values set by the same sentence ("I will own it and finish by 5 October") share one quote, under the last of them.
    const quoted = item.rows.map((row, index) => {
      const next = item.rows[index + 1]
      return !next || quoteKey(row.fact) === null || quoteKey(row.fact) !== quoteKey(next.fact)
    })
    return <li key={item.objectId}>
      <article className="board-card" data-tone={item.state?.tone} data-single={single || undefined} aria-label={item.title}>
        {!single && <header className="board-card-head"><h4>{item.title}</h4>{item.state?.label && <Chip tone={STATE_TONES[item.state.tone]} dot={item.state.tone === 'overdue'}>{item.state.label}</Chip>}</header>}
        <div className="board-rows">{item.rows.map((row, index) => rowView(item, row, single, quoted[index]))}</div>
      </article>
    </li>
  }

  function proposalCard(proposal: TemporalProposal) {
    const { title, unit, multi } = itemOf(proposal.object_id, proposal.label)
    const definition = definitionOf(proposal.object_id, proposal.attribute)
    const heading = multi ? `${title} · ${attributeLabel(proposal.attribute)}` : title
    const editing = proposalEdit?.id === proposal.proposal_id ? proposalEdit : null
    const same = proposal.current_value != null && JSON.stringify(proposal.current_value) === JSON.stringify(proposal.value)
    const source: TemporalEvidence = { quote: proposal.quote, speaker: proposal.speaker, meeting: proposal.meeting }
    const slot = { object_id: proposal.object_id ?? '', attribute: proposal.attribute }
    return <li key={proposal.proposal_id}>
      <article className="board-card board-proposal" aria-label={`Suggestion: ${heading}`}>
        <div className="board-proposal-main">
          <div className="board-proposal-text">
            <h4>{heading}</h4>
            {!editing && <p className="board-value">{show({ ...slot, value: proposal.value }, unit)}
              {proposal.current_value != null && <span className="board-was">{same ? 'same as now' : <>now {show({ ...slot, value: proposal.current_value }, unit)}</>}</span>}</p>}
          </div>
          {!editing && <div className="board-proposal-actions">
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setError(null); setProposalEdit({ id: proposal.proposal_id, value: editableText(proposal.value) }) }}>Edit</Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => review(proposal, 'reject')}>Reject</Button>
            <Button size="sm" disabled={!!busy} onClick={() => review(proposal, 'accept')}>Accept</Button>
          </div>}
        </div>
        {editing && <form className="board-edit" aria-label={`Edit suggestion: ${heading}`} onSubmit={event => { event.preventDefault(); review(proposal, 'edit') }}>
          <fieldset disabled={!!busy} className="board-edit-fields">
            <ValueInput autoFocus label="Value" definition={definition} value={editing.value} onChange={value => setProposalEdit({ ...editing, value })} />
            <div className="board-edit-actions">
              <Button type="submit" size="sm" disabled={!editing.value.trim()}>Save and accept</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setProposalEdit(null); setError(null) }}>Cancel</Button>
            </div>
          </fieldset>
        </form>}
        <Quote source={source} titles={titles} onOpenMoment={momentFor(source)} />
        <Problem text={errorAt(`proposal-${proposal.proposal_id}`)} />
      </article>
    </li>
  }

  function fold(name: 'lookup' | 'setup', title: string, children: ReactNode) {
    const id = `${ids}-${name}`
    const open = folds[name]
    return <section className="board-fold" aria-labelledby={`${id}-toggle`}>
      <h3><button type="button" id={`${id}-toggle`} className="board-fold-toggle" aria-expanded={open} aria-controls={id} onClick={() => setFolds(current => ({ ...current, [name]: !current[name] }))}>
        <CaretDown size={13} aria-hidden="true" data-open={open || undefined} />{title}
      </button></h3>
      <div id={id} className="board-fold-body" hidden={!open}>{children}<Problem text={errorAt(name)} /></div>
    </section>
  }

  // In the order the meetings were held, so the changes read as they happened; within a meeting, the order it was read
  // in. Any order can be accepted: the service re-proposes a suggestion that an earlier meeting's approval made stale.
  const meetingDate = (proposal: TemporalProposal) => (proposal.meeting && dates.get(proposal.meeting)) || ''
  const proposals = (overview?.proposals.filter(proposal => !meetingId || proposal.meeting === meetingId) ?? [])
    .map((proposal, index) => ({ proposal, index }))
    .sort((a, b) => meetingDate(a.proposal).localeCompare(meetingDate(b.proposal)) || a.index - b.index)
    .map(({ proposal }) => proposal)
  const facts = overview?.facts.filter(fact => !meetingId || fact.evidence.some(source => source.meeting === meetingId)) ?? []
  const sections = overview ? buildBoard(objects, facts, localDay()) : []

  return <section className="temporal-memory" aria-label={meetingId ? 'Decisions from this meeting' : 'Decision board'} aria-busy={!!busy}>
    <header className="temporal-header"><div>
      <h2>{meetingId ? 'Decisions from this meeting' : 'Decisions and commitments'}</h2>
      <p>{meetingId ? 'Each suggestion waits for your approval before it joins the board.' : 'What was decided and who owes what, each with the words that set it.'}</p>
    </div><div className="temporal-status">
      {/* One quiet line for progress and results, so that the list never jumps while you work through it. */}
      <p role="status">{busy ?? message ?? ''}</p>
      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { reloadTitles(); void run('Loading decisions…', refresh) }}>Refresh</Button>
    </div></header>
    {error?.place === 'top' && <p role="alert" className="temporal-error">{error.text}</p>}
    {meetingId && <section className="temporal-section board-ingest">
      <p>Read the reviewed transcript for decisions and commitments.</p>
      <Button variant="outline" disabled={!!busy || !overview} onClick={() => {
        void run('Reading reviewed meeting…', async () => {
          const result = await temporalService.ingestReviewedMeeting(vaultPath, meetingId)
          if (!mounted.current) return
          setHistory(null); setEdit(null); setProposalEdit(null)
          setMessage(ingestSummary(result.counts))
          announceMemoryChanged()
          await refresh()
        })
      }}>Find decisions and commitments</Button>
    </section>}
    {overview && !overview.check.ok && <section className="temporal-error" role="alert">
      <h3>Ledger checks need attention</h3>
      <ul>{overview.check.problems.map((problem, index) => <li key={index}>{typeof problem === 'object' ? JSON.stringify(problem) : String(problem)}</li>)}</ul>
    </section>}
    {proposals.length > 0 && <section className="board-section board-review" aria-labelledby={`${ids}-review`}>
      <h3 id={`${ids}-review`}>Needs review <span className="board-count">({proposals.length})</span></h3>
      <p className="board-muted">Nothing joins the board until you accept it.</p>
      <ul className="board-list">{proposals.map(proposalCard)}</ul>
    </section>}
    {sections.map(section => <section key={section.kind} className="board-section" aria-labelledby={`${ids}-${section.kind}`}>
      <h3 id={`${ids}-${section.kind}`}>{section.title} <span className="board-count">{section.items.length}</span></h3>
      <ul className="board-list">{section.items.map(card)}</ul>
    </section>)}
    {overview && !sections.length && (meetingId
      ? <p className="board-muted board-empty-line">{proposals.length ? 'Nothing from this meeting is approved yet.' : 'Nothing from this meeting is on the board yet.'}</p>
      : <EmptyState icon={<Quotes size={20} />} title={proposals.length ? 'Nothing approved yet' : 'No decisions yet'}>
        {proposals.length ? 'Accept a suggestion above and it appears here with the words that prove it.' : 'Open a meeting, then Decisions › Find decisions and commitments. What you approve appears here.'}
      </EmptyState>)}
    {!meetingId && objects.length > 0 && fold('lookup', 'Look up a past value', <TrackedValueLookup objects={objects} disabled={!!busy} titles={titles} onOpenMoment={onOpenMoment}
      onLookup={(params, showResult) => { void run('Looking up value…', async () => {
        const result = await temporalService.query(vaultPath, params)
        if (mounted.current) showResult({ result, type: params.type, objectId: params.object_id, attribute: params.attribute, at: params.type === 'as_of_valid' ? params.valid_at : params.type === 'as_of_tx' ? params.tx_at : '' })
      }, 'lookup') }} />)}
    {!meetingId && overview && fold('setup', 'Tracked items', <TrackedItemsSetup overview={overview} disabled={!!busy}
      onSave={next => { void run('Saving tracked item…', () => mutate(() => temporalService.setRegistry(vaultPath, next), 'Tracked item saved.', current => current), 'setup') }} />)}
  </section>
}
