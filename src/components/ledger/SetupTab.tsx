import { useState } from 'react'
import { Plus, X } from '@phosphor-icons/react'
import type { AttributeType, ItemKind, RegistryAttribute, RegistryObject } from '../../lib/ledgerApi'
import { SAMPLE_REGISTRY } from '../../lib/ledgerSampleRegistry'
import { attributeLabel, slugify } from '../../lib/ledgerFormat'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { useLedger } from './ledgerContext'
import { ErrorNotice, Field, selectClass } from './ui'

const TYPE_NAMES: Record<AttributeType, string> = { text: 'Text', number: 'Number', date: 'Date', person: 'Person', enum: 'Choice' }

interface DraftAttribute { name: string; type: AttributeType; values: string }

function buildItem(label: string, kind: ItemKind, drafts: DraftAttribute[], existing: RegistryObject[]): RegistryObject | string {
  const objectId = slugify(label)
  if (!label.trim() || !objectId) return 'Give the item a name, for example "Go-live date".'
  if (existing.some((o) => o.object_id === objectId || o.label.trim().toLowerCase() === label.trim().toLowerCase())) return `There is already an item called "${label.trim()}". Existing items cannot be changed here.`
  const attributes: RegistryAttribute[] = []
  for (const draft of drafts) {
    const name = slugify(draft.name)
    if (!name) return 'Every detail needs a name, for example "Date" or "Owner".'
    const values = draft.values.split(',').map((v) => v.trim()).filter(Boolean)
    if (draft.type === 'enum' && values.length < 2) return `"${draft.name}" is a choice, so list at least two allowed values separated by commas.`
    attributes.push({ name, type: draft.type, values: draft.type === 'enum' ? values : [], change_kind: 'REVISE' })
  }
  if (attributes.length === 0) return 'Add at least one detail to track, for example a date or an owner.'
  return { object_id: objectId, kind, label: label.trim(), attributes }
}

function AddItemForm() {
  const { api, data, refresh, notify } = useLedger()
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<ItemKind>('decision')
  const [drafts, setDrafts] = useState<DraftAttribute[]>([{ name: '', type: 'text', values: '' }])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const patch = (index: number, change: Partial<DraftAttribute>) => setDrafts((all) => all.map((d, i) => (i === index ? { ...d, ...change } : d)))

  const submit = async () => {
    const item = buildItem(label, kind, drafts, data.registry.objects)
    if (typeof item === 'string') return setError(item)
    setBusy(true)
    setError(null)
    try {
      await api.setRegistry({ objects: [item], people: {} })
      notify(`Now tracking "${item.label}".`)
      setLabel('')
      setDrafts([{ name: '', type: 'text', values: '' }])
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="gap-3 p-4">
      <h3 className="m-0 text-sm font-semibold text-foreground">Add a tracked item</h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Field label="Name" htmlFor="item-label"><Input id="item-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Go-live date" /></Field>
        <Field label="Kind" htmlFor="item-kind">
          <select id="item-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as ItemKind)}>
            <option value="decision">Decision</option>
            <option value="commitment">Promise (has an owner)</option>
          </select>
        </Field>
      </div>
      {drafts.map((draft, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]">
          <Field label={i === 0 ? 'Detail to track' : ''} htmlFor={`attr-name-${i}`}><Input id={`attr-name-${i}`} aria-label={`Detail ${i + 1} name`} value={draft.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Date" /></Field>
          <Field label={i === 0 ? 'Type' : ''} htmlFor={`attr-type-${i}`}>
            <select id={`attr-type-${i}`} aria-label={`Detail ${i + 1} type`} className={selectClass} value={draft.type} onChange={(e) => patch(i, { type: e.target.value as AttributeType })}>
              {Object.entries(TYPE_NAMES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </Field>
          {draft.type === 'enum'
            ? <Field label={i === 0 ? 'Allowed values' : ''} htmlFor={`attr-values-${i}`}><Input id={`attr-values-${i}`} aria-label={`Detail ${i + 1} allowed values`} value={draft.values} onChange={(e) => patch(i, { values: e.target.value })} placeholder="Yes, No, Maybe" /></Field>
            : <span />}
          <Button variant="ghost" size="icon-sm" aria-label={`Remove detail ${i + 1}`} disabled={drafts.length === 1} onClick={() => setDrafts((all) => all.filter((_, n) => n !== i))}><X size={14} /></Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setDrafts((all) => [...all, { name: '', type: 'text', values: '' }])}><Plus size={14} /> Add another detail</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Saving…' : 'Add item'}</Button>
      </div>
      {error ? <ErrorNotice message={error} /> : null}
    </Card>
  )
}

function AddPersonForm() {
  const { api, data, refresh, notify } = useLedger()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    const id = slugify(name)
    if (!id) return setError('Enter the person\u2019s name exactly as it appears in your transcripts.')
    if (data.registry.people[id]) return setError(`${data.registry.people[id]} is already in the list.`)
    try {
      await api.setRegistry({ objects: [], people: { [id]: name.trim() } })
      notify(`Added ${name.trim()}.`)
      setName('')
      setError(null)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="grid gap-2">
      <div className="flex items-end gap-2">
        <Field label="Add a person" htmlFor="person-name"><Input id="person-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wei Ling" /></Field>
        <Button variant="outline" onClick={() => void submit()}>Add person</Button>
      </div>
      {error ? <ErrorNotice message={error} /> : null}
    </div>
  )
}

export function SetupTab() {
  const { api, data, refresh, notify } = useLedger()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const loadSample = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.setRegistry(SAMPLE_REGISTRY)
      notify('Sample setup loaded.')
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const people = Object.values(data.registry.people)

  return (
    <div className="grid max-w-3xl gap-5">
      <p className="m-0 text-sm text-muted-foreground">
        Tracked items are the things your team decides and promises, such as a date or an owner. Memoria only records what it can match to one of these, so you always know what it is listening for. Items cannot be changed once added; add a new one instead.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void loadSample()} disabled={busy}>{busy ? 'Loading…' : 'Load sample setup'}</Button>
        <span className="text-xs text-muted-foreground">A fictional procurement pilot: vendor, budget, go-live date and three owned tasks.</span>
      </div>
      {error ? <ErrorNotice message={error} /> : null}
      <section aria-label="Tracked items" className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold text-foreground">Tracked items ({data.registry.objects.length})</h3>
        {data.registry.objects.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Nothing is tracked yet. Load the sample setup or add your first item below.</p> : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {data.registry.objects.map((o) => (
              <li key={o.object_id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{o.label}</span>
                <Badge variant="secondary">{o.kind === 'commitment' ? 'Promise' : 'Decision'}</Badge>
                <span className="text-xs text-muted-foreground">{o.attributes.map((a) => `${attributeLabel(a.name)} (${TYPE_NAMES[a.type].toLowerCase()})`).join(', ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="People" className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold text-foreground">People ({people.length})</h3>
        <p className="m-0 text-sm text-muted-foreground">{people.length ? people.join(', ') : 'No people yet. Owners in your meetings are matched against this list.'}</p>
        <AddPersonForm />
      </section>
      <AddItemForm />
    </div>
  )
}
