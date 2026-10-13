import type { HistoryEntry, LedgerFact } from '../../lib/ledgerApi'
import { PencilSimple } from '@phosphor-icons/react'
import { correctionOf, correctionSummary, wasCorrectedAway } from '../../lib/ledgerCorrection'
import { attributeLabel, changeLabel, findAttribute, formatDate, formatValue } from '../../lib/ledgerFormat'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { useLedger } from './ledgerContext'
import { Busy, ErrorNotice, QuoteBlock } from './ui'
import { useFactHistory } from './useFactHistory'

export function HistoryDialog({ fact, onClose }: { fact: LedgerFact; onClose: () => void }) {
  const { data, meetingLabel } = useLedger()
  const { entries, error } = useFactHistory(fact.object_id, fact.attribute)
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
            {(entries ?? []).flatMap((entry) => {
              const before = valid[valid.findIndex((e) => e.fact_id === entry.fact_id) - 1]
              const correction = correctionOf(entry, entries)
              const corrected = correction ? entries?.find((e) => e.fact_id === correction.replacedFactId) : undefined
              const replaces = !entry.retracted && !correction && before && before.value !== entry.value ? before : null
              const isCurrent = entry.fact_id === fact.fact_id
              const steps = []
              if (correction) {
                steps.push(
                  <li key={`correction-${entry.fact_id}`} aria-label="Correction" className="flex flex-wrap items-center gap-2 border-l-2 border-dashed border-primary/60 pl-4 text-sm text-foreground">
                    <PencilSimple size={15} className="shrink-0 text-muted-foreground" />
                    <span>{correctionSummary(correction)}</span>
                    {corrected ? <span className="text-muted-foreground">Was <span className="line-through">{show(corrected.value)}</span>, now {show(entry.value)}.</span> : null}
                  </li>,
                )
              }
              steps.push(
                <li key={entry.fact_id} className={`grid gap-2 border-l-2 pl-4 ${isCurrent ? 'border-primary' : 'border-border'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-base font-semibold ${entry.retracted ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{show(entry.value)}</span>
                    {isCurrent ? <Badge>Current</Badge> : null}
                    <Badge variant="outline">{correction ? 'Corrected' : changeLabel(entry.change_type)}</Badge>
                    {entry.claim_from ? <span className="text-xs text-muted-foreground">from {formatDate(entry.claim_from)}</span> : null}
                  </div>
                  {replaces ? <div className="text-sm text-muted-foreground">Replaced <span className="line-through">{show(replaces.value)}</span></div> : null}
                  {entry.retracted ? <div className="text-sm text-muted-foreground">{wasCorrectedAway(entry) ? 'Set aside by the correction below.' : `Removed by ${entry.retracted.by}: ${entry.retracted.reason}`}</div> : null}
                  {entry.evidence.map((e, i) => <QuoteBlock key={i} evidence={e} meetingLabel={meetingLabel(e.meeting)} />)}
                  {entry.evidence.length === 0 ? <div className="text-xs text-muted-foreground">No quote stored.</div> : null}
                </li>,
              )
              return steps
            })}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  )
}
