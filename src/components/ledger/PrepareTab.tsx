import { useCallback, useEffect, useState } from 'react'
import type { Brief } from '../../lib/ledgerApi'
import { briefTitle, briefToMarkdown, briefToNoteMarkdown } from '../../lib/ledgerBrief'
import { attributeLabel, findAttribute, formatDate, formatValue } from '../../lib/ledgerFormat'
import { writeClipboardText } from '../../utils/clipboardText'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { useLedger } from './ledgerContext'
import { Busy, EmptyState, ErrorNotice } from './ui'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="gap-2 p-4"><h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>{children}</Card>
}

export function PrepareTab() {
  const { api, data, notify, saveNote } = useLedger()
  const [brief, setBrief] = useState<Brief | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setBrief(await api.brief())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [api])

  useEffect(() => { void load() }, [load, data.facts])

  if (busy && !brief) return <Busy label="Preparing your brief…" />
  if (error) return <ErrorNotice message={error} onRetry={() => void load()} />
  if (!brief) return null
  if (brief.meetings === 0) {
    return <EmptyState title="Nothing to prepare yet">Add at least one meeting. The brief lists what people promised and what changed, ready for the next meeting.</EmptyState>
  }

  const people = data.registry.people
  const show = (objectId: string, attribute: string, value: Brief['recent_changes'][number]['from']) =>
    formatValue(value, findAttribute(data.registry, objectId, attribute), people)
  const markdown = () => briefToMarkdown(brief, data.registry)

  const copy = async () => {
    try {
      await writeClipboardText(markdown())
      notify('Brief copied. Paste it anywhere.')
    } catch {
      setError('Could not copy to the clipboard.')
    }
  }
  const save = async () => {
    try {
      await saveNote(briefTitle(), briefToNoteMarkdown(markdown()))
      notify(`Saved as the note "${briefTitle()}".`)
    } catch (e) {
      setError((e as Error).message || 'Could not save the note.')
    }
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm text-muted-foreground">Everything you need to open the next meeting.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void copy()}>Copy as markdown</Button>
          <Button onClick={() => void save()}>Save as note</Button>
        </div>
      </div>
      <Section title="Open commitments">
        {brief.open_commitments.length === 0 ? <p className="m-0 text-sm text-muted-foreground">No open commitments. Everything promised so far is done or cancelled.</p> : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {brief.open_commitments.map((c) => (
              <li key={c.object_id} className="text-sm text-foreground">
                <strong>{c.label}</strong>: {c.owner ? show(c.object_id, 'owner', c.owner) : 'nobody named yet'}
                <span className="text-muted-foreground"> · due {c.deadline ? show(c.object_id, 'deadline', c.deadline) : 'no date set'}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="What changed recently">
        {brief.recent_changes.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Nothing has changed yet.</p> : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {brief.recent_changes.map((c, i) => {
              const object = data.registry.objects.find((o) => o.label === c.label)
              const objectId = object?.object_id ?? ''
              return (
                <li key={i} className="text-sm text-foreground">
                  <strong>{c.label}</strong> ({attributeLabel(c.attribute).toLowerCase()}): <span className="line-through text-muted-foreground">{show(objectId, c.attribute, c.from)}</span> &rarr; <strong>{show(objectId, c.attribute, c.to)}</strong>
                  {c.decided_at ? <span className="text-muted-foreground"> · {formatDate(c.decided_at)}</span> : null}
                  {c.quote ? <div className="mt-0.5 text-xs italic text-muted-foreground">&ldquo;{c.quote}&rdquo;</div> : null}
                </li>
              )
            })}
          </ul>
        )}
      </Section>
      {brief.waiting_for_review > 0 ? <p className="m-0 text-xs text-muted-foreground">{brief.waiting_for_review} suggested change{brief.waiting_for_review === 1 ? ' is' : 's are'} still waiting under &ldquo;To review&rdquo;.</p> : null}
    </div>
  )
}
