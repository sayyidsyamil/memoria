import { useMemo, useState } from 'react'
import { ClockCounterClockwise, PencilSimple, Quotes, Trash } from '@phosphor-icons/react'
import type { LedgerFact } from '../../lib/ledgerApi'
import { attributeLabel, findAttribute, formatDate, formatValue } from '../../lib/ledgerFormat'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { EvidenceDialog } from './EvidenceDialog'
import { FixDialog, RemoveDialog } from './FixDialogs'
import { HistoryDialog } from './HistoryDialog'
import { useLedger } from './ledgerContext'
import { EmptyState, selectClass } from './ui'

type Open = { kind: 'evidence' | 'history' | 'fix' | 'remove'; fact: LedgerFact } | null

function groupByItem(facts: LedgerFact[]): { objectId: string; label: string; kind: string; rows: LedgerFact[] }[] {
  const groups = new Map<string, { objectId: string; label: string; kind: string; rows: LedgerFact[] }>()
  for (const fact of facts) {
    const group = groups.get(fact.object_id) ?? { objectId: fact.object_id, label: fact.label, kind: fact.kind, rows: [] }
    group.rows.push(fact)
    groups.set(fact.object_id, group)
  }
  return [...groups.values()]
}

function OpenStatusRow() {
  return (
    <div className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 border-t border-border px-4 py-2.5">
      <div className="text-xs font-medium text-muted-foreground">Status</div>
      <div className="text-sm text-foreground">open <span className="text-xs text-muted-foreground">· not marked done or cancelled yet</span></div>
    </div>
  )
}

function NowEmpty() {
  const { data, goToTab } = useLedger()
  if (data.registry.objects.length === 0) {
    return (
      <EmptyState title="Nothing is tracked yet" action={<Button onClick={() => goToTab('setup')}>Set up tracked items</Button>}>
        Tracked items are the things your team decides and promises, such as a date or an owner. Load the sample setup to try it in one click.
      </EmptyState>
    )
  }
  if (data.meetings.length === 0) {
    return <EmptyState title="No meetings added yet" action={<Button onClick={() => goToTab('meetings')}>Add a meeting</Button>}>Add a meeting note and Memoria will list the decisions and promises it finds, each with the words that prove it.</EmptyState>
  }
  return (
    <EmptyState title="No decisions recorded yet" action={data.proposals.length ? <Button onClick={() => goToTab('review')}>Review {data.proposals.length} suggestion{data.proposals.length === 1 ? '' : 's'}</Button> : undefined}>
      Memoria found nothing it could confirm in your meetings. Suggestions that need your approval appear under &ldquo;To review&rdquo;.
    </EmptyState>
  )
}

function FactRow({ fact, onOpen }: { fact: LedgerFact; onOpen: (kind: NonNullable<Open>['kind']) => void }) {
  const { data, meetingLabel } = useLedger()
  const spec = findAttribute(data.registry, fact.object_id, fact.attribute)
  const value = formatValue(fact.value, spec, data.registry.people)
  const name = `${fact.label} ${attributeLabel(fact.attribute)}`
  const source = fact.evidence[0]?.meeting
  const corrected = (fact.corrects ?? null) !== null || Boolean(fact.correction)
  return (
    <div className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
      <div className="text-xs font-medium text-muted-foreground">{attributeLabel(fact.attribute)}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{value}</span>
          {fact.n_changes > 0 || corrected ? (
            <button type="button" aria-label={`History: ${name}`} onClick={() => onOpen('history')}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-accent">
              <ClockCounterClockwise size={12} /> {fact.n_changes > 0 ? `changed ${fact.n_changes} ${fact.n_changes === 1 ? 'time' : 'times'}` : 'corrected'}
            </button>
          ) : null}
          {fact.evidence.length === 0 ? <Badge variant="outline">No evidence</Badge> : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {fact.valid_from ? `since ${formatDate(fact.valid_from)}` : ''}{source ? ` · from ${meetingLabel(source)}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" aria-label={`Evidence: ${name}`} onClick={() => onOpen('evidence')}><Quotes size={14} /> Evidence</Button>
        <Button size="sm" variant="ghost" aria-label={`Fix: ${name}`} onClick={() => onOpen('fix')}><PencilSimple size={14} /> Fix</Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Remove: ${name}`} title="Remove" onClick={() => onOpen('remove')}><Trash size={14} /></Button>
      </div>
    </div>
  )
}

export function NowTab() {
  const { data, meetingLabel } = useLedger()
  const [meeting, setMeeting] = useState('')
  const [open, setOpen] = useState<Open>(null)
  const meetingIds = useMemo(() => {
    const used = new Set(data.facts.flatMap((f) => f.evidence.map((e) => e.meeting)))
    return data.meetings.map((m) => m.meeting_id).filter((id) => used.has(id))
  }, [data.facts, data.meetings])
  const shown = meeting ? data.facts.filter((f) => f.evidence.some((e) => e.meeting === meeting)) : data.facts
  const groups = groupByItem(shown)
  const close = () => setOpen(null)
  const valueText = open ? formatValue(open.fact.value, findAttribute(data.registry, open.fact.object_id, open.fact.attribute), data.registry.people) : ''

  if (data.facts.length === 0) return <NowEmpty />
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor="now-meeting" className="text-sm text-muted-foreground">Show</label>
        <select id="now-meeting" className={`${selectClass} max-w-xs`} value={meeting} onChange={(e) => setMeeting(e.target.value)}>
          <option value="">Everything recorded</option>
          {meetingIds.map((id) => <option key={id} value={id}>Only from {meetingLabel(id)}</option>)}
        </select>
      </div>
      {groups.length === 0 ? <p className="text-sm text-muted-foreground">Nothing was recorded from that meeting.</p> : null}
      {groups.map((group) => (
        <Card key={group.objectId} className="gap-0 overflow-hidden py-0">
          <div className="flex items-center gap-2 bg-muted/40 px-4 py-2">
            <h3 className="m-0 text-sm font-semibold text-foreground">{group.label}</h3>
            <Badge variant="secondary">{group.kind === 'commitment' ? 'Promise' : 'Decision'}</Badge>
          </div>
          {group.rows.map((fact) => <FactRow key={`${fact.object_id}.${fact.attribute}`} fact={fact} onOpen={(kind) => setOpen({ kind, fact })} />)}
          {group.kind === 'commitment' && !group.rows.some((f) => f.attribute === 'status')
            && findAttribute(data.registry, group.objectId, 'status') ? <OpenStatusRow /> : null}
        </Card>
      ))}
      {open?.kind === 'evidence' ? <EvidenceDialog fact={open.fact} valueText={valueText} onClose={close} /> : null}
      {open?.kind === 'history' ? <HistoryDialog fact={open.fact} onClose={close} /> : null}
      {open?.kind === 'fix' ? <FixDialog fact={open.fact} valueText={valueText} onClose={close} /> : null}
      {open?.kind === 'remove' ? <RemoveDialog fact={open.fact} valueText={valueText} onClose={close} /> : null}
    </div>
  )
}
