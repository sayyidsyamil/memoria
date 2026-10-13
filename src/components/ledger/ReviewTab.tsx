import { useState } from 'react'
import { ledgerErrorKind, type Proposal } from '../../lib/ledgerApi'
import { attributeLabel, findAttribute, formatValue, proposalReasonText } from '../../lib/ledgerFormat'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { useLedger } from './ledgerContext'
import { EmptyState, ErrorNotice, QuoteBlock } from './ui'
import { parseEditedValue, toInputText } from './valueEdit'
import { ValueInput } from './ValueInput'

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const { api, data, refresh, notify, meetingLabel } = useLedger()
  const spec = findAttribute(data.registry, proposal.object_id, proposal.attribute)
  const show = (v: Proposal['value']) => formatValue(v, spec, data.registry.people)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(toInputText(proposal.value))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const title = `${proposal.label} · ${attributeLabel(proposal.attribute)}`
  const idBase = `proposal-${proposal.proposal_id}`

  const act = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      notify(message)
      await refresh()
    } catch (e) {
      const kind = ledgerErrorKind(e)
      if (kind === 'AlreadyDone') {
        await refresh()
      } else if (kind === 'StaleProposal') {
        setStale(true)
        await refresh()
      } else {
        setError((e as Error).message)
      }
      setBusy(false)
    }
  }

  const accept = (edited: boolean) => {
    let edits: { value: Proposal['value'] } | undefined
    if (edited) {
      const parsed = parseEditedValue(spec, draft)
      if ('error' in parsed) return setError(parsed.error)
      edits = { value: parsed.value }
    }
    void act(() => api.acceptProposal(proposal.proposal_id, edits), `Recorded: ${title}.`)
  }

  return (
    <Card className="gap-3 p-4" aria-label={`Suggestion: ${title}`}>
      <div>
        <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
        <p className="m-0 mt-1 text-sm text-foreground">
          Memoria wants to record <strong>{show(proposal.value)}</strong>
          {proposal.current_value !== null && proposal.current_value !== undefined
            ? <>, but <strong>{show(proposal.current_value)}</strong> is recorded now.</>
            : '.'}
        </p>
        <p className="m-0 mt-1 text-xs text-muted-foreground">{proposalReasonText(proposal.reason)}</p>
      </div>
      {proposal.quote
        ? <QuoteBlock evidence={{ quote: proposal.quote, speaker: proposal.speaker ?? 'Unknown speaker', meeting: proposal.meeting ?? '' }} meetingLabel={proposal.meeting ? meetingLabel(proposal.meeting) : 'an unknown meeting'} />
        : <p className="m-0 text-xs text-muted-foreground">No quote is stored for this suggestion. Check the meeting before accepting.</p>}
      {editing ? (
        <div className="grid gap-1.5">
          <label htmlFor={`${idBase}-value`} className="text-xs font-medium text-muted-foreground">Value to record</label>
          <ValueInput id={`${idBase}-value`} spec={spec} people={data.registry.people} value={draft} onChange={setDraft} />
        </div>
      ) : null}
      {stale ? (
        <p role="status" className="m-0 rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
          This suggestion is out of date because something newer was recorded. It has been refreshed.
        </p>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
      <div className="flex flex-wrap gap-2">
        {editing
          ? <Button disabled={busy} onClick={() => accept(true)}>Save and accept</Button>
          : <Button disabled={busy} onClick={() => accept(false)}>Accept</Button>}
        <Button variant="outline" disabled={busy} onClick={() => setEditing((v) => !v)}>{editing ? 'Cancel edit' : 'Edit then accept'}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void act(() => api.rejectProposal(proposal.proposal_id), stale ? `Dismissed: ${title}.` : `Rejected: ${title}.`)}>{stale ? 'Dismiss' : 'Reject'}</Button>
      </div>
    </Card>
  )
}

export function ReviewTab() {
  const { data } = useLedger()
  if (data.proposals.length === 0) {
    return <EmptyState title="Nothing to review">When Memoria hears something that conflicts with what you already recorded, it waits here for you instead of changing anything on its own.</EmptyState>
  }
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm text-muted-foreground">Nothing below is recorded until you accept it.</p>
      {data.proposals.map((p) => <ProposalCard key={p.proposal_id} proposal={p} />)}
    </div>
  )
}
