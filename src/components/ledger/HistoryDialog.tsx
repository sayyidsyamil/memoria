import { useEffect, useState } from 'react'
import type { HistoryEntry, LedgerFact } from '../../lib/ledgerApi'
import { attributeLabel, changeLabel, findAttribute, formatDate, formatValue } from '../../lib/ledgerFormat'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { useLedger } from './ledgerContext'
import { Busy, ErrorNotice, QuoteBlock } from './ui'

function useHistory(objectId: string, attribute: string) {
  const { api } = useLedger()
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api.factHistory(objectId, attribute).then((h) => { if (!cancelled) setEntries(h) }, (e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [api, objectId, attribute])
  return { entries, error }
}

export function HistoryDialog({ fact, onClose }: { fact: LedgerFact; onClose: () => void }) {
  const { data, meetingLabel } = useLedger()
  const { entries, error } = useHistory(fact.object_id, fact.attribute)
  const spec = findAttribute(data.registry, fact.object_id, fact.attribute)
  const show = (value: HistoryEntry['value']) => formatValue(value, spec, data.registry.people)
  const valid = (entries ?? []).filter((e) => !e.retracted)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>History: {fact.label} &middot; {attributeLabel(fact.attribute)}</DialogTitle>
          <DialogDescription>Oldest first. Each value stays valid until a later meeting replaces it.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {error ? <ErrorNotice message={error} /> : null}
          {!entries && !error ? <Busy label="Loading history…" /> : null}
          <ol className="m-0 grid list-none gap-4 p-0">
            {(entries ?? []).map((entry) => {
              const before = valid[valid.findIndex((e) => e.fact_id === entry.fact_id) - 1]
              const replaces = !entry.retracted && before && before.value !== entry.value ? before : null
              const isCurrent = entry.fact_id === fact.fact_id
              return (
                <li key={entry.fact_id} className={`grid gap-2 border-l-2 pl-4 ${isCurrent ? 'border-primary' : 'border-border'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-base font-semibold ${entry.retracted ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{show(entry.value)}</span>
                    {isCurrent ? <Badge>Current</Badge> : null}
                    <Badge variant="outline">{changeLabel(entry.change_type)}</Badge>
                    {entry.claim_from ? <span className="text-xs text-muted-foreground">from {formatDate(entry.claim_from)}</span> : null}
                  </div>
                  {replaces ? <div className="text-sm text-muted-foreground">Replaced <span className="line-through">{show(replaces.value)}</span></div> : null}
                  {entry.retracted ? <div className="text-sm text-muted-foreground">Removed by {entry.retracted.by}: {entry.retracted.reason}</div> : null}
                  {entry.evidence.map((e, i) => <QuoteBlock key={i} evidence={e} meetingLabel={meetingLabel(e.meeting)} />)}
                  {entry.evidence.length === 0 ? <div className="text-xs text-muted-foreground">No quote stored.</div> : null}
                </li>
              )
            })}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  )
}
