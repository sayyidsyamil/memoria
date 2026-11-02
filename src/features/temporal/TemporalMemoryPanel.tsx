import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  temporalService,
  type TemporalAttribute,
  type TemporalAttributeType,
  type TemporalEvidence,
  type TemporalFact,
  type TemporalHistoryFact,
  type TemporalOverview,
  type TemporalQuery,
  type TemporalValue,
} from './temporalService'
import { changeCount, changeSummary, describeQueryResult, meetingLabel, readableDate, type MeetingTitles } from './temporalFormat'
import { useMeetingTitles } from './useMeetingTitles'
import './temporalMemory.css'

export interface TemporalMemoryPanelProps {
  vaultPath: string
  meetingId?: string
}

function displayValue(value: TemporalValue | undefined): string {
  if (value == null) return 'Not recorded'
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}

/** A date for people, with the exact value kept in the `datetime` attribute. Text that is not a date is shown as written. */
function TemporalDate({ value, time }: { value: string; time?: boolean }) {
  const date = readableDate(value, { time })
  return date ? <time dateTime={date.dateTime}>{date.label}</time> : <>{value}</>
}

/** Date attributes hold ISO calendar dates; everything else is shown as recorded. */
function Value({ value, type }: { value: TemporalValue | undefined; type?: TemporalAttributeType }) {
  return type === 'date' && typeof value === 'string' ? <TemporalDate value={value} /> : <>{displayValue(value)}</>
}

/** The meeting's title; the exact id stays available on hover for citations whose title is unknown. */
function MeetingName({ id, titles }: { id: string | null; titles: MeetingTitles }) {
  return typeof id === 'string' && id.trim() ? <span title={`Meeting ID: ${id}`}>{meetingLabel(id, titles)}</span> : <>{meetingLabel(id, titles)}</>
}

function Evidence({ evidence, titles }: { evidence: TemporalEvidence[]; titles: MeetingTitles }) {
  return <div className="temporal-evidence">{evidence.map((source, index) => <figure key={index}>
    <blockquote>{source.quote || 'No source quote recorded.'}</blockquote>
    <figcaption>{source.speaker || 'Speaker not recorded'} · <MeetingName id={source.meeting} titles={titles} />
      {source.audio_start != null && Number.isFinite(source.audio_start) && ` · Audio ${Math.floor(source.audio_start / 60)}:${String(Math.floor(source.audio_start % 60)).padStart(2, '0')}`}
    </figcaption>
  </figure>)}</div>
}

type QueryResult = { result: TemporalValue; type: TemporalQuery['type']; objectId: string; attribute: string; at: string }

function QueryHeading({ query }: { query: QueryResult }) {
  const { type, at } = query
  return <h4>{query.objectId} — {query.attribute} · {type === 'current' ? 'Current' : type === 'n_changes' ? 'Number of changes'
    : <>{type === 'as_of_valid' ? 'Valid at' : 'Value valid now, as known on'} <TemporalDate value={at} time /></>}</h4>
}

/** The answer as the value, its source quotes and when it was decided; a count as a sentence. Unfamiliar shapes stay inspectable. */
function QueryAnswer({ result, type, valueType, titles }: { result: TemporalValue; type: TemporalQuery['type']; valueType?: TemporalAttributeType; titles: MeetingTitles }) {
  const view = describeQueryResult(result, type)
  if (view.kind === 'unknown') {
    return typeof view.raw === 'object' && view.raw !== null ? <pre>{displayValue(view.raw)}</pre> : <p className="temporal-value">{displayValue(view.raw)}</p>
  }
  return <>
    <p className="temporal-value">{view.kind === 'changes' ? changeSummary(view.count) : view.value == null ? 'No value recorded' : <Value value={view.value} type={valueType} />}</p>
    {view.kind === 'value' && view.decidedAt && <p className="temporal-meta">Decided <TemporalDate value={view.decidedAt} time /></p>}
    {view.evidence.length > 0 && <Evidence evidence={view.evidence} titles={titles} />}
  </>
}

// A new scope remounts the ledger so late responses cannot leak across vaults or meetings.
export function TemporalMemoryPanel(props: TemporalMemoryPanelProps) {
  return <TemporalLedger key={JSON.stringify([props.vaultPath, props.meetingId])} {...props} />
}

function TemporalLedger({ vaultPath, meetingId }: TemporalMemoryPanelProps) {
  const [overview, setOverview] = useState<TemporalOverview | null>(null)
  const [busy, setBusy] = useState<string | null>('Loading tracked facts…')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const working = useRef(false)
  const mounted = useRef(false)
  const [objectId, setObjectId] = useState('')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState('object')
  const [attribute, setAttribute] = useState('')
  const [attributeType, setAttributeType] = useState<TemporalAttributeType>('text')
  const [enumValues, setEnumValues] = useState('')
  const [history, setHistory] = useState<{ objectId: string; attribute: string; facts: TemporalHistoryFact[] } | null>(null)
  const [edit, setEdit] = useState<{ fact: TemporalFact | TemporalHistoryFact; action: 'correct' | 'retract' } | null>(null)
  const [newValue, setNewValue] = useState('')
  const [reason, setReason] = useState('')
  const [queryObject, setQueryObject] = useState('')
  const [queryAttribute, setQueryAttribute] = useState('')
  const [queryType, setQueryType] = useState<TemporalQuery['type']>('current')
  const [queryAt, setQueryAt] = useState('')
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)

  useEffect(() => {
    mounted.current = true
    let canceled = false
    working.current = true
    temporalService.overview(vaultPath).then(result => {
      if (!canceled) setOverview(result)
    }).catch(error => {
      if (!canceled) setError(String(error instanceof Error ? error.message : error))
    }).finally(() => {
      if (!canceled) { working.current = false; setBusy(null) }
    })
    return () => { canceled = true; mounted.current = false }
  }, [vaultPath])
  // Declared after the ledger load so the ledger is requested first; titles only label the citations and never gate them.
  const { titles, reload: reloadTitles } = useMeetingTitles(vaultPath)

  async function run(status: string, action: () => Promise<void>) {
    if (working.current || !mounted.current) return
    working.current = true
    setBusy(status); setError(null); setMessage(null)
    try { await action() }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (mounted.current) { working.current = false; setBusy(null) } }
  }

  async function refresh() {
    const result = await temporalService.overview(vaultPath)
    if (mounted.current) setOverview(result)
  }

  async function mutate(action: () => Promise<unknown>, success: string) {
    await action()
    if (!mounted.current) return
    setEdit(null); setHistory(null); setQueryResult(null); setMessage(success)
    // Clear acted-on rows before reloading; a failed reload must not offer the same action again.
    setOverview(null)
    try { await refresh() }
    catch (error) { throw new Error(`${success} The updated ledger could not be loaded: ${error instanceof Error ? error.message : String(error)}`) }
  }

  function saveTrackedItem() {
    if (!overview || !objectId.trim() || !attribute.trim()) return
    const objects = overview.registry.objects
    const existing = objects.find(item => item.object_id === objectId.trim())
    const values = [...new Set(enumValues.split(',').map(value => value.trim()).filter(Boolean))]
    if ((!existing && (!label.trim() || !kind.trim())) || (attributeType === 'enum' && !values.length)) return
    const nextAttribute: TemporalAttribute = { name: attribute.trim(), type: attributeType,
      ...(attributeType === 'enum' && values.length ? { values } : {}) }
    const attributes = existing?.attributes ?? []
    const nextObject = { ...existing, object_id: objectId.trim(), label: existing?.label ?? label.trim(), kind: existing?.kind ?? kind.trim(),
      attributes: attributes.some(item => item.name === nextAttribute.name)
        ? attributes.map(item => item.name === nextAttribute.name ? nextAttribute : item)
        : [...attributes, nextAttribute] }
    const nextObjects = existing ? objects.map(item => item.object_id === nextObject.object_id ? nextObject : item) : [...objects, nextObject]
    void run('Saving tracked item…', () => mutate(() => temporalService.setRegistry(vaultPath, nextObjects), 'Tracked item saved.'))
  }

  function startEdit(fact: TemporalFact | TemporalHistoryFact, action: 'correct' | 'retract') {
    if (fact.retracted) return
    setEdit({ fact, action }); setReason(''); setNewValue(fact.value == null ? '' : displayValue(fact.value))
  }

  function submitEdit() {
    if (!edit || edit.fact.retracted || !reason.trim()) return
    const { fact, action } = edit
    void run(action === 'correct' ? 'Saving correction…' : 'Retracting fact…', async () => {
      if (action === 'retract') {
        await mutate(() => temporalService.retractFact(vaultPath, fact.fact_id, reason.trim()), 'Fact retracted.')
        return
      }
      const definition = overview?.registry.objects.find(item => item.object_id === fact.object_id)?.attributes.find(item => item.name === fact.attribute)
      const value = newValue.trim()
      if (!value) throw new Error('Enter a corrected value.')
      const type = definition?.type ?? (typeof fact.value === 'number' ? 'number' : 'text')
      if (type === 'number' && !Number.isFinite(Number(value))) throw new Error('Enter a finite number for the corrected value.')
      if (type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
        throw new Error('Enter a valid date in YYYY-MM-DD format.')
      }
      if (type === 'enum' && definition?.values?.length && !definition.values.includes(value)) {
        throw new Error(`Choose one of: ${definition.values.join(', ')}.`)
      }
      await mutate(() => temporalService.correctFact(vaultPath, fact.fact_id, type === 'number' ? Number(value) : value, reason.trim()), 'Correction saved.')
    })
  }

  function typeOfAttribute(objectId: string | undefined, name: string): TemporalAttributeType | undefined {
    return overview?.registry.objects.find(item => item.object_id === objectId)?.attributes.find(item => item.name === name)?.type
  }

  function factCard(fact: TemporalFact | TemporalHistoryFact, historical = false) {
    const validFrom = 'claim_from' in fact ? fact.claim_from : fact.valid_from
    const validTo = 'claim_to' in fact ? fact.claim_to : fact.valid_to
    const replaces = fact.correction?.replaced_fact_id ?? fact.corrects
    const changes = 'n_changes' in fact ? changeCount(fact.n_changes) : ''
    return <article className="temporal-card" key={fact.fact_id} aria-label={`${historical ? 'Historical fact' : 'Fact'}: ${fact.label} — ${fact.attribute}`}>
      <h4>{fact.label} <span>— {fact.attribute}</span></h4>
      <p className="temporal-value"><Value value={fact.value} type={typeOfAttribute(fact.object_id, fact.attribute)} /></p>
      <p className="temporal-meta">Valid from {validFrom ? <TemporalDate value={validFrom} /> : 'date not recorded'}{validTo && <> until <TemporalDate value={validTo} /></>}{changes && ` · ${changes}`}</p>
      {'decided_at' in fact && <p className="temporal-meta">Decided {fact.decided_at ? <TemporalDate value={fact.decided_at} time /> : 'date not recorded'}</p>}
      {historical && fact.tx_from && <p className="temporal-meta">Recorded <TemporalDate value={fact.tx_from} time />{fact.tx_to && <> until <TemporalDate value={fact.tx_to} time /></>}</p>}
      {fact.retracted && <p className="temporal-meta">Retracted</p>}
      {replaces != null && <p className="temporal-meta">Corrects fact #{replaces}</p>}
      {fact.correction && <p className="temporal-meta">Correction by {fact.correction.reviewer || 'reviewer not recorded'}: {fact.correction.reason}</p>}
      {fact.evidence.length ? <Evidence evidence={fact.evidence} titles={titles} /> : <p className="temporal-meta">No source evidence recorded.</p>}
      <div className="temporal-actions">
        {!historical && <Button variant="outline" disabled={!!busy} onClick={() => {
          void run('Loading fact history…', async () => {
            const facts = await temporalService.history(vaultPath, fact.object_id, fact.attribute)
            if (mounted.current) { setHistory({ objectId: fact.object_id, attribute: fact.attribute, facts }); setEdit(null) }
          })
        }}>History</Button>}
        <Button variant="outline" disabled={!!busy || fact.retracted} onClick={() => startEdit(fact, 'correct')}>Correct</Button>
        <Button variant="ghost" disabled={!!busy || fact.retracted} onClick={() => startEdit(fact, 'retract')}>Retract</Button>
      </div>
    </article>
  }

  const queryAttributes = overview?.registry.objects.find(item => item.object_id === queryObject)?.attributes ?? []
  const existingItem = overview?.registry.objects.find(item => item.object_id === objectId.trim())
  const hasEnumValues = enumValues.split(',').some(value => value.trim())
  const proposals = overview?.proposals.filter(proposal => !meetingId || proposal.meeting === meetingId) ?? []
  const facts = overview?.facts.filter(fact => !meetingId || fact.evidence.some(source => source.meeting === meetingId)) ?? []

  return <section className="temporal-memory" aria-label={meetingId ? 'Review tracked facts' : 'Tracked facts'} aria-busy={!!busy}>
    <header className="temporal-header"><div>
      <h2>{meetingId ? 'Review tracked facts' : 'Tracked facts'}</h2>
      <p>Follow specific values over time, with their source evidence and recorded changes.</p>
    </div><Button variant="outline" disabled={!!busy} onClick={() => { reloadTitles(); void run('Loading tracked facts…', refresh) }}>Refresh</Button></header>
    {busy && <p role="status" className="temporal-notice">{busy}</p>}
    {error && <p role="alert" className="temporal-error">{error}</p>}
    {message && <p role="status" className="temporal-notice">{message}</p>}
    {meetingId && <section className="temporal-section">
      <p>Extract suggestions from this reviewed meeting. Each suggestion needs your approval before it becomes a tracked fact.</p>
      <Button variant="outline" disabled={!!busy || !overview} onClick={() => {
        void run('Reading reviewed meeting…', async () => {
          const result = await temporalService.ingestReviewedMeeting(vaultPath, meetingId)
          if (!mounted.current) return
          setHistory(null); setQueryResult(null); setOverview(null)
          setMessage(`Meeting reviewed. ${Object.entries(result.counts).map(([name, count]) => `${name.replaceAll('_', ' ')}: ${count}`).join(' · ') || 'Suggestions are ready for review.'}`)
          await refresh()
        })
      }}>Find tracked fact suggestions</Button>
    </section>}
    {!meetingId && overview && <section className="temporal-section" aria-label="Tracked items setup">
      <h3>Tracked items setup</h3>
      <p>Name an item and an attribute to follow. Existing item labels and kinds are fixed; you can add or edit their attributes.</p>
      {overview.registry.objects.length > 0 && <ul className="temporal-registry">{overview.registry.objects.map(item => <li key={item.object_id}>
        <strong>{item.label}</strong> <span className="temporal-meta">{item.object_id} · {item.kind}</span>
        <div className="temporal-actions">{item.attributes.map(definition => <Button key={definition.name} variant="ghost" disabled={!!busy} onClick={() => {
          setObjectId(item.object_id); setLabel(item.label); setKind(item.kind); setAttribute(definition.name); setAttributeType(definition.type); setEnumValues(definition.values?.join(', ') ?? '')
        }}>Edit {definition.name} ({definition.type})</Button>)}</div>
      </li>)}</ul>}
      <form onSubmit={event => { event.preventDefault(); saveTrackedItem() }}>
        <fieldset disabled={!!busy} className="temporal-fields">
          <label>Object ID<Input required value={objectId} onChange={event => setObjectId(event.target.value)} placeholder="e.g. launch-project" /></label>
          <label>Item label<Input required disabled={!!existingItem} value={existingItem?.label ?? label} onChange={event => setLabel(event.target.value)} placeholder="e.g. Launch project" /></label>
          <label>Item kind<Input required disabled={!!existingItem} value={existingItem?.kind ?? kind} onChange={event => setKind(event.target.value)} /></label>
          <label>Attribute name<Input required value={attribute} onChange={event => setAttribute(event.target.value)} placeholder="e.g. launch_date" /></label>
          <label>Attribute type<select value={attributeType} onChange={event => setAttributeType(event.target.value as TemporalAttributeType)}>
            <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="enum">Enum</option>
          </select></label>
          {attributeType === 'enum' && <label>Allowed values (required, comma-separated)<Input required value={enumValues} onChange={event => setEnumValues(event.target.value)} placeholder="e.g. planned, active, complete" /></label>}
          <Button type="submit" variant="outline" disabled={!objectId.trim() || (!existingItem && (!label.trim() || !kind.trim())) || !attribute.trim() || (attributeType === 'enum' && !hasEnumValues)}>Save tracked item</Button>
        </fieldset>
      </form>
    </section>}
    {overview && !overview.check.ok && <section className="temporal-error" role="alert">
      <h3>Ledger checks need attention</h3>
      <ul>{overview.check.problems.map((problem, index) => <li key={index}>{displayValue(problem)}</li>)}</ul>
    </section>}
    {overview && <>
      <section className="temporal-section" aria-label="Fact proposals"><h3>Waiting for approval <span>({proposals.length})</span></h3>
        {!proposals.length && <p>No tracked fact suggestions waiting for review.</p>}
        {proposals.map(proposal => <article key={proposal.proposal_id} className="temporal-card" aria-label={`Proposal: ${proposal.label} — ${proposal.attribute}`}>
          <h4>{proposal.label} <span>— {proposal.attribute}</span></h4>
          <dl className="temporal-comparison"><div><dt>Current value</dt><dd><Value value={proposal.current_value} type={typeOfAttribute(proposal.object_id, proposal.attribute)} /></dd></div><div><dt>Proposed value</dt><dd><Value value={proposal.value} type={typeOfAttribute(proposal.object_id, proposal.attribute)} /></dd></div></dl>
          <Evidence evidence={[{ quote: proposal.quote, speaker: proposal.speaker, meeting: proposal.meeting }]} titles={titles} />
          <div className="temporal-actions">
            <Button variant="outline" disabled={!!busy} onClick={() => { void run('Accepting suggestion…', () => mutate(() => temporalService.acceptProposal(vaultPath, proposal.proposal_id), 'Suggestion accepted.')) }}>Accept suggestion</Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => { void run('Rejecting suggestion…', () => mutate(() => temporalService.rejectProposal(vaultPath, proposal.proposal_id), 'Suggestion rejected.')) }}>Reject suggestion</Button>
          </div>
        </article>)}
      </section>
      <section className="temporal-section" aria-label="Current tracked facts"><h3>Current facts</h3>
        {!facts.length && <p>No approved tracked facts{meetingId ? ' supported by this meeting' : ''} yet.</p>}
        {facts.map(fact => factCard(fact))}
      </section>
    </>}
    {history && <section className="temporal-section" aria-label="Fact history">
      <div className="temporal-header"><h3>History: {history.objectId} — {history.attribute}</h3><Button variant="ghost" disabled={!!busy} onClick={() => setHistory(null)}>Close history</Button></div>
      {!history.facts.length && <p>No fact history recorded.</p>}
      {history.facts.map(fact => factCard(fact, true))}
    </section>}
    {edit && <section className="temporal-section" aria-label={edit.action === 'correct' ? 'Correct fact' : 'Retract fact'}>
      <h3>{edit.action === 'correct' ? 'Correct' : 'Retract'} {edit.fact.label} — {edit.fact.attribute}</h3>
      <p>Recorded value: <Value value={edit.fact.value} type={typeOfAttribute(edit.fact.object_id, edit.fact.attribute)} />. A reason is required for this ledger change.</p>
      <form onSubmit={event => { event.preventDefault(); submitEdit() }}><fieldset disabled={!!busy} className="temporal-fields">
        {edit.action === 'correct' && <label>Corrected value<Input required value={newValue} onChange={event => setNewValue(event.target.value)} /></label>}
        <label>Reason (required)<Input required value={reason} onChange={event => setReason(event.target.value)} /></label>
        <div className="temporal-actions"><Button type="submit" variant="outline" disabled={!reason.trim() || (edit.action === 'correct' && !newValue.trim())}>{edit.action === 'correct' ? 'Save correction' : 'Confirm retraction'}</Button>
          <Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
      </fieldset></form>
    </section>}
    {!meetingId && overview && <section className="temporal-section" aria-label="Query tracked facts">
      <h3>Look up a tracked value</h3>
      <p>Valid time is when a fact applied. Recorded time is when the ledger knew it. A recorded-time lookup returns the value valid now, as known on the selected date.</p>
      <form onSubmit={event => {
        event.preventDefault()
        if (!queryObject || !queryAttribute || (queryType.startsWith('as_of') && !queryAt)) return
        void run('Looking up tracked value…', async () => {
          setQueryResult(null)
          const params: TemporalQuery = queryType === 'as_of_valid' ? { type: queryType, object_id: queryObject, attribute: queryAttribute, valid_at: queryAt }
            : queryType === 'as_of_tx' ? { type: queryType, object_id: queryObject, attribute: queryAttribute, tx_at: queryAt }
              : { type: queryType, object_id: queryObject, attribute: queryAttribute }
          const result = await temporalService.query(vaultPath, params)
          if (mounted.current) setQueryResult({ result, type: queryType, objectId: queryObject, attribute: queryAttribute, at: queryAt })
        })
      }}><fieldset disabled={!!busy} className="temporal-fields">
        <label>Query item<select required value={queryObject} onChange={event => { setQueryObject(event.target.value); setQueryAttribute(''); setQueryResult(null) }}><option value="">Choose an item</option>{overview.registry.objects.map(item => <option key={item.object_id} value={item.object_id}>{item.label}</option>)}</select></label>
        <label>Query attribute<select required value={queryAttribute} onChange={event => { setQueryAttribute(event.target.value); setQueryResult(null) }}><option value="">Choose an attribute</option>{queryAttributes.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
        <label>Time perspective<select value={queryType} onChange={event => { setQueryType(event.target.value as TemporalQuery['type']); setQueryResult(null) }}><option value="current">Current value</option><option value="as_of_valid">Past value (valid time)</option><option value="as_of_tx">Value valid now, as known on date</option><option value="n_changes">Number of changes</option></select></label>
        {queryType.startsWith('as_of') && <label>As of (ISO date or timestamp)<Input required value={queryAt} placeholder="2026-11-02 or 2026-11-02T10:00:00Z" onChange={event => { setQueryAt(event.target.value); setQueryResult(null) }} /></label>}
        <Button type="submit" variant="outline" disabled={!queryObject || !queryAttribute || (queryType.startsWith('as_of') && !queryAt.trim())}>Look up value</Button>
      </fieldset></form>
      {queryResult && <div className="temporal-query-result" role="status"><QueryHeading query={queryResult} />
        <QueryAnswer result={queryResult.result} type={queryResult.type} valueType={typeOfAttribute(queryResult.objectId, queryResult.attribute)} titles={titles} /></div>}
    </section>}
  </section>
}
