import { useState } from 'react'
import type { LedgerFact } from '../../lib/ledgerApi'
import { attributeLabel, findAttribute } from '../../lib/ledgerFormat'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { useLedger } from './ledgerContext'
import { ErrorNotice, Field } from './ui'
import { parseEditedValue, toInputText } from './valueEdit'
import { ValueInput } from './ValueInput'

interface DialogProps {
  fact: LedgerFact
  valueText: string
  onClose: () => void
}

function useSubmit(onClose: () => void) {
  const { refresh } = useLedger()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

export function FixDialog({ fact, valueText, onClose }: DialogProps) {
  const { api, data, notify } = useLedger()
  const spec = findAttribute(data.registry, fact.object_id, fact.attribute)
  const [value, setValue] = useState(toInputText(fact.value))
  const [reason, setReason] = useState('')
  const { busy, error, setError, run } = useSubmit(onClose)
  const title = `${fact.label} · ${attributeLabel(fact.attribute)}`

  const save = () => {
    const parsed = parseEditedValue(spec, value)
    if ('error' in parsed) return setError(parsed.error)
    if (fact.fact_id === undefined) return setError('This value cannot be edited because it has no saved record.')
    const factId = fact.fact_id
    void run(async () => {
      await api.correctFact(factId, parsed.value, reason.trim())
      notify(`Saved: ${title} corrected.`)
    })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fix: {title}</DialogTitle>
          <DialogDescription>Currently recorded: {valueText}. The old value stays in the history.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Correct value" htmlFor="fix-value"><ValueInput id="fix-value" spec={spec} people={data.registry.people} value={value} onChange={setValue} /></Field>
          <Field label="Why are you changing it? (required)" htmlFor="fix-reason" hint="A short reason, for example: the chair said 20 December.">
            <Input id="fix-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error ? <ErrorNotice message={error} /> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || reason.trim().length < 3 || !value.trim()}>{busy ? 'Saving…' : 'Save correction'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveDialog({ fact, valueText, onClose }: DialogProps) {
  const { api, notify } = useLedger()
  const [reason, setReason] = useState('')
  const { busy, error, setError, run } = useSubmit(onClose)
  const title = `${fact.label} · ${attributeLabel(fact.attribute)}`

  const remove = () => {
    if (fact.fact_id === undefined) return setError('This value cannot be removed because it has no saved record.')
    const factId = fact.fact_id
    void run(async () => {
      await api.retractFact(factId, reason.trim())
      notify(`Removed: ${title}.`)
    })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove this value?</DialogTitle>
          <DialogDescription>{title} = {valueText}. It will no longer count as recorded. The history keeps a note that you removed it.</DialogDescription>
        </DialogHeader>
        <Field label="Why are you removing it? (required)" htmlFor="remove-reason">
          <Input id="remove-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error ? <ErrorNotice message={error} /> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep it</Button>
          <Button variant="destructive" onClick={remove} disabled={busy || reason.trim().length < 3}>{busy ? 'Removing…' : 'Remove'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
