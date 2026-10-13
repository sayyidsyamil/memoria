import { useMemo, useState } from 'react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import type { VaultEntry } from '../../types'
import { formatDateTime } from '../../lib/ledgerFormat'
import { parseTranscriptNote } from '../../lib/transcriptNote'
import { ingestNote, isNote, isTranscriptCandidate, meetingIdForNote } from './ingestNote'
import { describeIngest, summariseIngest } from './ingestSummary'
import { useLedger } from './ledgerContext'
import { Busy, EmptyState, ErrorNotice, WarningNotice } from './ui'

export function MeetingsTab() {
  const { api, data, entries, vaultPath, refresh, readNote, notify, meetingLabel } = useLedger()
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ title: string; text: string; readCleanly: boolean } | null>(null)

  const added = useMemo(() => new Set(data.meetings.map((m) => m.meeting_id)), [data.meetings])
  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase()
    return entries
      .filter(showAll ? isNote : isTranscriptCandidate)
      .filter((e) => !term || e.title.toLowerCase().includes(term))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [entries, showAll, search])
  const isAdded = (e: VaultEntry) => added.has(meetingIdForNote(e.path, vaultPath))
  const fresh = candidates.filter((e) => !isAdded(e))

  const addOne = async (entry: VaultEntry): Promise<boolean> => {
    if (isAdded(entry)) return true
    setBusy(entry.path)
    setError(null)
    setSummary(null)
    try {
      const result = await ingestNote({ api, entry, vaultPath, readNote })
      const { readCleanly } = describeIngest(result)
      setSummary({ title: entry.title, text: summariseIngest(result), readCleanly })
      notify(readCleanly ? `Added "${entry.title}".` : `Added "${entry.title}", but some decisions may be missing.`)
      await refresh()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(null)
    }
  }

  // Later meetings can change earlier decisions, so add them oldest first.
  const addAll = async () => {
    setBusy('all')
    setError(null)
    let ordered: VaultEntry[] = fresh
    try {
      const dated = await Promise.all(fresh.map(async (entry) => ({ entry, at: parseTranscriptNote(await readNote(entry.path)).occurredAt ?? '' })))
      ordered = dated.sort((a, b) => a.at.localeCompare(b.at)).map((d) => d.entry)
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
      return
    }
    for (const entry of ordered) {
      if (!(await addOne(entry))) return
    }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <section aria-label="Meetings in the ledger" className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold text-foreground">Meetings added</h3>
        {data.meetings.length === 0 ? <p className="m-0 text-sm text-muted-foreground">No meetings added yet. Pick a transcript below.</p> : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {data.meetings.map((m) => (
              <li key={m.meeting_id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium text-foreground">{meetingLabel(m.meeting_id)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(m.occurred_at)} · {m.evidence_items} {m.evidence_items === 1 ? 'item' : 'items'} recorded</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Add meeting from a note" className="grid gap-3">
        <h3 className="m-0 text-sm font-semibold text-foreground">Add meeting from a note</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Input aria-label="Search notes" className="max-w-xs" placeholder="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all notes
          </label>
          {fresh.length > 1 ? <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void addAll()}>Add all {fresh.length} new, oldest first</Button> : null}
        </div>
        {busy ? <Busy label="Reading the meeting… this can take a few minutes the first time." /> : null}
        {error ? <ErrorNotice message={error} /> : null}
        {summary && !summary.readCleanly ? (
          <WarningNotice>{`${summary.title}: ${summary.text}`}</WarningNotice>
        ) : null}
        {summary?.readCleanly ? <div role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">{`${summary.title}: ${summary.text}`}</div> : null}
        {candidates.length === 0 ? (
          <EmptyState title={showAll ? 'No notes found' : 'No transcripts found'}>
            Record a meeting with &ldquo;Record meeting&rdquo; and save it, or tick &ldquo;Show all notes&rdquo; to pick any note that contains a conversation.
          </EmptyState>
        ) : (
          <ul className="m-0 grid max-h-[45vh] list-none gap-1 overflow-y-auto p-0">
            {candidates.map((e) => (
              <li key={e.path} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <span className="min-w-0 truncate text-sm text-foreground">{e.title}</span>
                {isAdded(e)
                  ? <Badge variant="secondary">Already added</Badge>
                  : <Button size="sm" aria-label={`Add ${e.title}`} disabled={busy !== null} onClick={() => void addOne(e)}>Add</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
