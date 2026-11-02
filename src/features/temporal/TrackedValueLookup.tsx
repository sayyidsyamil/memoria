import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Quote, TemporalDate, type OpenMoment } from './TemporalEvidence'
import { attributeLabel, changeSummary, describeQueryResult, formatValue, itemLabel, labelUnit, type MeetingTitles } from './temporalFormat'
import type { TemporalAttributeType, TemporalObject, TemporalQuery, TemporalValue } from './temporalService'

export type LookupResult = { result: TemporalValue; type: TemporalQuery['type']; objectId: string; attribute: string; at: string }

function inspectable(value: TemporalValue | undefined): string {
  if (value == null) return 'Not recorded'
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}

/** The tracked item's label without a unit in brackets; never its internal id. */
function ItemName({ id, objects }: { id: string; objects: readonly TemporalObject[] }) {
  return <span className="temporal-item">{itemLabel(id, objects)}</span>
}

function LookupHeading({ query, objects }: { query: LookupResult; objects: readonly TemporalObject[] }) {
  const { type, at } = query
  return <h4><ItemName id={query.objectId} objects={objects} /> — {attributeLabel(query.attribute)} · {type === 'current' ? 'Current' : type === 'n_changes' ? 'Number of changes'
    : <>{type === 'as_of_valid' ? 'Valid at' : 'Value valid now, as known on'} <TemporalDate value={at} time /></>}</h4>
}

/** The answer as the value, its source quotes and when it was decided; a count as a sentence. Unfamiliar shapes stay inspectable. */
function LookupAnswer({ query, valueType, unit, titles, onOpenMoment }: { query: LookupResult; valueType?: TemporalAttributeType; unit: string | null; titles: MeetingTitles; onOpenMoment?: OpenMoment }) {
  const view = describeQueryResult(query.result, query.type)
  if (view.kind === 'unknown') {
    return typeof view.raw === 'object' && view.raw !== null ? <pre>{inspectable(view.raw)}</pre> : <p className="temporal-value">{inspectable(view.raw)}</p>
  }
  return <>
    <p className="temporal-value">{view.kind === 'changes' ? changeSummary(view.count) : view.value == null ? 'No value recorded'
      : valueType === 'date' && typeof view.value === 'string' ? <TemporalDate value={view.value} /> : formatValue(view.value, valueType, unit)}</p>
    {view.kind === 'value' && view.decidedAt && <p className="temporal-meta">Decided <TemporalDate value={view.decidedAt} time /></p>}
    {view.evidence.map((source, index) => <Quote key={index} source={source} titles={titles} onOpenMoment={onOpenMoment} />)}
  </>
}

/**
 * Looks a tracked value up at another time. Valid time is when a value applied; recorded time is when the ledger knew it.
 */
export function TrackedValueLookup({ objects, disabled, titles, onOpenMoment, onLookup }: {
  objects: readonly TemporalObject[]
  disabled: boolean
  titles: MeetingTitles
  onOpenMoment?: OpenMoment
  /** Resolves with the ledger's answer; failures are reported by the caller. */
  onLookup: (params: TemporalQuery, show: (result: LookupResult) => void) => void
}) {
  const [queryObject, setQueryObject] = useState('')
  const [queryAttribute, setQueryAttribute] = useState('')
  const [queryType, setQueryType] = useState<TemporalQuery['type']>('current')
  const [queryAt, setQueryAt] = useState('')
  const [queryResult, setQueryResult] = useState<LookupResult | null>(null)
  const queryAttributes = objects.find(item => item.object_id === queryObject)?.attributes ?? []
  const resultObject = queryResult ? objects.find(item => item.object_id === queryResult.objectId) : undefined
  const resultType = resultObject?.attributes.find(item => item.name === queryResult?.attribute)?.type

  return <>
    <p>Valid time is when a value applied. Recorded time is when the ledger knew it. A recorded-time lookup returns the value valid now, as known on the selected date.</p>
    <form onSubmit={event => {
      event.preventDefault()
      if (!queryObject || !queryAttribute || (queryType.startsWith('as_of') && !queryAt)) return
      setQueryResult(null)
      const params: TemporalQuery = queryType === 'as_of_valid' ? { type: queryType, object_id: queryObject, attribute: queryAttribute, valid_at: queryAt }
        : queryType === 'as_of_tx' ? { type: queryType, object_id: queryObject, attribute: queryAttribute, tx_at: queryAt }
          : { type: queryType, object_id: queryObject, attribute: queryAttribute }
      onLookup(params, setQueryResult)
    }}><fieldset disabled={disabled} className="temporal-fields">
      <label>Query item<select required value={queryObject} onChange={event => { setQueryObject(event.target.value); setQueryAttribute(''); setQueryResult(null) }}><option value="">Choose an item</option>{objects.map(item => <option key={item.object_id} value={item.object_id}>{item.label}</option>)}</select></label>
      <label>Query attribute<select required value={queryAttribute} onChange={event => { setQueryAttribute(event.target.value); setQueryResult(null) }}><option value="">Choose an attribute</option>{queryAttributes.map(item => <option key={item.name} value={item.name}>{attributeLabel(item.name)}</option>)}</select></label>
      <label>Time perspective<select value={queryType} onChange={event => { setQueryType(event.target.value as TemporalQuery['type']); setQueryResult(null) }}><option value="current">Current value</option><option value="as_of_valid">Past value (valid time)</option><option value="as_of_tx">Value valid now, as known on date</option><option value="n_changes">Number of changes</option></select></label>
      {queryType.startsWith('as_of') && <label>As of (ISO date or timestamp)<Input required value={queryAt} placeholder="2026-11-02 or 2026-11-02T10:00:00Z" onChange={event => { setQueryAt(event.target.value); setQueryResult(null) }} /></label>}
      <Button type="submit" variant="outline" disabled={!queryObject || !queryAttribute || (queryType.startsWith('as_of') && !queryAt.trim())}>Look up value</Button>
    </fieldset></form>
    {queryResult && <div className="temporal-query-result" role="status"><LookupHeading query={queryResult} objects={objects} />
      <LookupAnswer query={queryResult} valueType={resultType} unit={resultObject ? labelUnit(resultObject.label, resultType === 'number').unit : null} titles={titles} onOpenMoment={onOpenMoment} /></div>}
  </>
}
